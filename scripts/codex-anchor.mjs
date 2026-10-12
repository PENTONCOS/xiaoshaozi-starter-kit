#!/usr/bin/env node
// codex-anchor — Codex 5h 窗口锚定 + 余量监控. Zero-LLM (仅 spawn codex CLI 探测).
//
// morning  : 工作日 09:00 / 14:00 发一次最小探测请求锚定 5h 窗口，
//            然后读最新快照，推私聊日报卡（5h/周窗口、Credits、上一窗口峰值、ΔCredits）。
// monitor  : 每 10 分钟（工作日 09-20 点内）缓存读最新 rollout 快照（零请求），
//            80%/95% 每窗口各告警一次；30 分钟内涨幅 ≥25pp 触发燃烧过快告警（45min 冷却）。
// 失败处理 : probe 失败自动重试 1 次，仍失败走告警路由（告警群），失败卡冷却 1h。
// 数据来源 : ~/.codex/sessions/**/*.jsonl 内的 rate_limits（每次真实 codex 运行免费写入）。
// 路由     : 额度属个人数据 → 日报/余量告警一律私聊（主 bot 直发 MAIN_DM）；
//            脚本失败卡 → 共享告警路由（getSender "alert"）。

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { getTenantToken, sendCard, getSender } from "/Users/cospeyton/notify/feishu-notify.mjs";

const SESSIONS = join(homedir(), ".codex/sessions");
const STATE_PATH = join(homedir(), "my-assistant/state/codex-anchor-state.json");
const LOG_TAG = "[codex-anchor]";
const MAIN_DM = "ou_93d7f79abd93ec4c91602d86de65be08";
const OPENCLAW_CFG = join(homedir(), ".openclaw/openclaw.json");
const BURN_WINDOW_MIN = 30;     // 燃烧速率观察窗
const BURN_JUMP_PP = 25;        // 30min 内涨 25 个百分点 → 燃烧过快
const BURN_COOLDOWN_MS = 45 * 60 * 1000;
const FAIL_COOLDOWN_MS = 60 * 60 * 1000;
const BEIJING = "Asia/Shanghai";

const mode = process.argv[2] || "";
const now = () => Date.now();
const log = (...a) => console.log(new Date().toISOString(), LOG_TAG, ...a);

const fmtT = (ts) => new Date(ts).toLocaleString("zh-CN", { timeZone: BEIJING, hour12: false, hour: "2-digit", minute: "2-digit" });
const fmtDT = (ts) => new Date(ts).toLocaleString("zh-CN", { timeZone: BEIJING, hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- state ----------
function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch { return { samples: [], windowAlerts: {}, peaks: {}, burnLast: 0, failLast: 0, dayCredits: {} }; }
}
function saveState(s) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s));
}

// ---------- snapshot mining (same source as codex-quota.mjs) ----------
function candidateFiles(maxDays = 2) {
  const out = [];
  let years;
  try { years = readdirSync(SESSIONS).filter((d) => /^\d{4}$/.test(d)).sort().reverse(); } catch { return out; }
  for (const y of years.slice(0, 2)) {
    let months;
    try { months = readdirSync(join(SESSIONS, y)).filter((d) => /^\d{2}$/.test(d)).sort().reverse(); } catch { continue; }
    for (const m of months.slice(0, 2)) {
      let days;
      try { days = readdirSync(join(SESSIONS, y, m)).filter((d) => /^\d{2}$/.test(d)).sort().reverse(); } catch { continue; }
      for (const d of days.slice(0, maxDays)) {
        let files;
        try { files = readdirSync(join(SESSIONS, y, m, d)).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
        files.sort().reverse();
        for (const f of files) out.push(join(SESSIONS, y, m, d, f));
      }
    }
    if (out.length) break;
  }
  return out;
}
function findRl(o) {
  if (!o || typeof o !== "object") return null;
  if (o.rate_limits && typeof o.rate_limits === "object" && o.rate_limits.primary) return o.rate_limits;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === "object") {
      const r = Array.isArray(v) ? v.map(findRl).find(Boolean) : findRl(v);
      if (r) return r;
    }
  }
  return null;
}
function readSnapshot() {
  for (const f of candidateFiles()) {
    let raw;
    try { if (statSync(f).size > 50e6) continue; raw = readFileSync(f, "utf8"); } catch { continue; }
    let best = null;
    for (const line of raw.split("\n")) {
      if (!line.includes('"rate_limits"') || !line.includes('"primary":{')) continue;
      try { const found = findRl(JSON.parse(line)); if (found) best = found; } catch { /* partial line */ }
    }
    if (best) {
      const m = f.match(/rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
      const ts = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`).getTime() : statSync(f).mtimeMs;
      return { rl: best, ts };
    }
  }
  return null;
}

// ---------- probe ----------
function probeOnce() {
  const r = spawnSync("codex", ["exec", "--skip-git-repo-check", "-s", "read-only", "-m", "openai/gpt-6.1-sol", "Reply with exactly: OK"], { timeout: 180000, encoding: "utf8" });
  return !r.error && (r.status === 0 || r.stdout);
}
async function probeWithRetry() {
  if (probeOnce()) return true;
  log("probe failed once, retrying...");
  await new Promise((r) => setTimeout(r, 15_000));
  return probeOnce();
}

// ---------- feishu ----------
async function mainBotCreds() {
  const cfg = JSON.parse(readFileSync(OPENCLAW_CFG, "utf8"));
  const main = cfg?.channels?.feishu?.accounts?.main;
  if (!main?.appId || !main?.appSecret) throw new Error("feishu appId/appSecret missing");
  return { appId: main.appId, appSecret: main.appSecret };
}
async function sendDm(card) {
  const creds = await mainBotCreds();
  const token = await getTenantToken(creds);
  return sendCard(token, card, { targetId: MAIN_DM, targetType: "open_id" });
}
async function sendFailureCard(text) {
  try {
    const { send } = await getSender("codex-anchor", "alert");
    await send({ header: { template: "red", title: { tag: "plain_text", content: "🚨 Codex 锚定脚本失败" } }, elements: [{ tag: "markdown", content: esc(text) }] });
  } catch (e) { log("failure card also failed:", e.message); }
}

// ---------- cards ----------
function remainStr(resetsSec) {
  const ms = resetsSec * 1000 - now();
  if (ms <= 0) return "已过期";
  const h = Math.floor(ms / 3.6e6), m = Math.round((ms % 3.6e6) / 6e4);
  return h > 0 ? `还剩 ${h}h${m}m` : `还剩 ${m}m`;
}
function buildDailyCard(rl, snapTs, st, anchored) {
  const p = rl.primary, s = rl.secondary;
  const ageMin = Math.max(0, Math.round((now() - snapTs) / 6e4));
  const credits = rl.credits?.has_credits ? Number(rl.credits.balance).toFixed(2) : null;
  const today = new Date().toLocaleDateString("zh-CN", { timeZone: BEIJING });
  const dayCred = st.dayCredits[today];
  const dCred = credits && dayCred != null ? (credits - dayCred) : null;
  const peakEntry = Object.entries(st.peaks).sort((a, b) => Number(b[0].split("|")[1]) - Number(a[0].split("|")[1]))[0];
  const peak = peakEntry ? peakEntry[1] : null;
  const title = anchored ? "⚓ Codex 窗口已锚定" : "⏱ Codex 窗口进行中";
  const lines = [
    `**5h 窗口**：已用 ${p ? p.used_percent : "?"}%｜${p ? `${fmtT(p.resets_at * 1000)} 重置（${remainStr(p.resets_at)}）` : "无数据"}`,
    `**周窗口**：已用 ${s ? s.used_percent : "?"}%｜${s ? `${fmtDT(s.resets_at * 1000)} 重置` : "无数据"}`,
    credits ? `**Credits**：$${credits}${dCred != null ? `（今日 ${dCred >= 0 ? "+" : ""}$${dCred.toFixed(2)}）` : ""}` : null,
    peak != null ? `**上一窗口峰值**：${peak}%` : null,
    `快照：${fmtT(snapTs)}（${ageMin} 分钟前）`,
  ].filter(Boolean);
  return { header: { template: p && p.used_percent >= 80 ? "orange" : "green", title: { tag: "plain_text", content: title } }, elements: [{ tag: "markdown", content: lines.join("\n") }] };
}

// ---------- morning ----------
async function morning() {
  const st = loadState();
  const ok = await probeWithRetry();
  if (!ok) {
    if (now() - st.failLast > FAIL_COOLDOWN_MS) { st.failLast = now(); saveState(st); await sendFailureCard("morning probe 两次尝试均失败（codex exec 超时/非零退出）"); }
    else log("probe failed, failure card on cooldown");
    process.exitCode = 1;
    return;
  }
  const snap = readSnapshot();
  if (!snap) { await sendFailureCard("probe 成功但本地未找到 rate_limits 快照"); process.exitCode = 1; return; }
  const p = snap.rl.primary;
  const anchored = p ? (p.used_percent === 0 || p.resets_at * 1000 - snap.ts >= 4.8 * 3.6e6) : false; // 新鲜锚定：0% 或重置点距快照≈满 5h
  recordSample(st, snap);
  await sendDm(buildDailyCard(snap.rl, snap.ts, st, anchored));
  saveState(st);
  log("morning card sent", anchored ? "(anchored)" : "(in-window)");
}

// ---------- sampling & alerts ----------
function recordSample(st, snap) {
  const p = snap.rl.primary, s = snap.rl.secondary;
  st.samples.push({ t: snap.ts, p5: p?.used_percent ?? null, pw: s?.used_percent ?? null, cr: snap.rl.credits?.has_credits ? Number(snap.rl.credits.balance) : null });
  // per-window peak tracking (key: resets_at of the window the sample belongs to)
  if (p) {
    const winKey = `w|${p.resets_at}`;
    st.peaks[winKey] = Math.max(st.peaks[winKey] ?? 0, p.used_percent);
    const keys = Object.keys(st.peaks);
    if (keys.length > 4) keys.sort((a, b) => Number(a.split("|")[1]) - Number(b.split("|")[1])).slice(0, keys.length - 4).forEach((k) => delete st.peaks[k]);
  }
  // prune >6h and cap
  const cutoff = now() - 6 * 3.6e6;
  st.samples = st.samples.filter((x) => x.t >= cutoff).slice(-200);
  // daily credits baseline
  const today = new Date().toLocaleDateString("zh-CN", { timeZone: BEIJING });
  if (snap.rl.credits?.has_credits && st.dayCredits[today] == null) st.dayCredits[today] = Number(snap.rl.credits.balance);
  const days = Object.keys(st.dayCredits);
  if (days.length > 7) days.sort().slice(0, days.length - 7).forEach((d) => delete st.dayCredits[d]);
}

async function monitor() {
  // weekday/time guard: Mon-Fri 09:00-20:00 CST
  const parts = new Date().toLocaleString("en-US", { timeZone: BEIJING, weekday: "short", hour: "numeric", hour12: false }).split(", ");
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts[0]);
  const hr = Number(parts[1]);
  if (wd <= 0 || wd >= 6 || hr < 9 || hr >= 20) { log("outside guard window, skip"); return; }

  const snap = readSnapshot();
  if (!snap) { log("no snapshot yet"); return; }
  const st = loadState();
  recordSample(st, snap);
  const p = snap.rl.primary;
  if (!p) { saveState(st); return; }
  const winKey = `w|${p.resets_at}`;
  st.windowAlerts[winKey] = st.windowAlerts[winKey] || [];
  const alerted = st.windowAlerts[winKey];
  const lines = [];
  let card = null;

  const base = `5h 窗口已用 **${p.used_percent}%**（${fmtT(p.resets_at * 1000)} 重置，${remainStr(p.resets_at)}）`;
  if (p.used_percent >= 95 && !alerted.includes("95")) {
    alerted.push("95"); card = { header: { template: "red", title: { tag: "plain_text", content: "🔴 Codex 5h 窗口 95%" } }, elements: [{ tag: "markdown", content: `${base}\n周窗口 ${snap.rl.secondary?.used_percent ?? "?"}%` }] };
  } else if (p.used_percent >= 80 && !alerted.includes("80")) {
    alerted.push("80"); card = { header: { template: "orange", title: { tag: "plain_text", content: "🟠 Codex 5h 窗口 80%" } }, elements: [{ tag: "markdown", content: `${base}\n周窗口 ${snap.rl.secondary?.used_percent ?? "?"}%` }] };
  }

  // burn rate: Δpct within last 30min ≥ 25pp
  if (!card && now() - st.burnLast > BURN_COOLDOWN_MS) {
    const recent = st.samples.filter((x) => x.t >= now() - BURN_WINDOW_MIN * 6e4 && x.p5 != null);
    if (recent.length >= 2) {
      const first = recent[0], last = recent[recent.length - 1];
      const jump = last.p5 - first.p5;
      if (jump >= BURN_JUMP_PP) {
        st.burnLast = now();
        const minsLeft = (p.resets_at * 1000 - now()) / 6e4;
        const proj = minsLeft > 0 ? Math.min(100, Math.round(last.p5 + (jump / BURN_WINDOW_MIN) * Math.min(minsLeft, 300))) : last.p5;
        card = { header: { template: "orange", title: { tag: "plain_text", content: "🔥 Codex 消耗过快" } }, elements: [{ tag: "markdown", content: `${base}\n近 ${BURN_WINDOW_MIN} 分钟涨 **${jump}pp**｜按此速率到重置预计 **${proj}%**` }] };
      }
    }
  }

  // prune old window dedupe keys (keep 4)
  const wk = Object.keys(st.windowAlerts);
  if (wk.length > 4) wk.sort((a, b) => Number(a.split("|")[1]) - Number(b.split("|")[1])).slice(0, wk.length - 4).forEach((k) => delete st.windowAlerts[k]);

  saveState(st);
  if (card) { await sendDm(card); log("alert sent:", card.header.title.content); }
  else log(`monitor ok: ${p.used_percent}%`);
}

// ---------- main ----------
try {
  if (mode === "morning") await morning();
  else if (mode === "monitor") await monitor();
  else { console.error("usage: codex-anchor.mjs morning|monitor"); process.exit(2); }
} catch (e) {
  console.error("FATAL", e);
  if (now() - loadState().failLast > FAIL_COOLDOWN_MS) await sendFailureCard(`未捕获异常: ${e.message}`);
  process.exit(1);
}
