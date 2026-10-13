#!/usr/bin/env node
// codex-anchor — Codex 5h 窗口锚定 + 余量监控. Zero-LLM (仅 spawn codex CLI 探测).
//
// morning  : 每天 09:00 / 14:05 发一次最小探测请求锚定 5h 窗口，
//            然后读最新快照，推日报卡到通知群（5h/周窗口、Credits、上一窗口峰值、ΔCredits）。
// monitor  : 每 10 分钟（24/7 全天候）缓存读最新 rollout 快照（零请求），
//            80%/95% 每窗口各告警一次；30 分钟内涨幅 ≥15pp 触发燃烧过快告警（45min 冷却）。
// 失败处理 : probe 失败自动重试 1 次，仍失败走告警路由（告警群），失败卡冷却 1h。
// 数据来源 : ~/.codex/sessions/**/*.jsonl 内的 rate_limits（每次真实 codex 运行免费写入）。
// 路由     : 日报卡 → 通知群（getSender "push"）；余量/燃烧过快/失败卡 → 告警群（getSender "alert"）。
//            重置卡被使用 / Credits 被消耗 → 通知群（零 LLM，读 quota API 的 resetCredits / credits.balance）。
// 调度     : 24/7，不区分工作日与时段（2026-10-12 定案）。

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { getSender } from "/Users/cospeyton/notify/feishu-notify.mjs";

const SESSIONS = join(homedir(), ".codex/sessions");
const STATE_PATH = join(homedir(), "my-assistant/state/codex-anchor-state.json");
const LOG_TAG = "[codex-anchor]";
const BURN_WINDOW_MIN = 30;     // 燃烧速率观察窗
const BURN_JUMP_PP = 15;        // 30min 内涨 25 个百分点 → 燃烧过快
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
async function sendPush(card) { // 日报卡 → 通知群
  const { send } = await getSender("codex-anchor", "push");
  return send(card);
}
async function sendAlert(card) { // 余量/燃烧过快 → 告警群
  const { send } = await getSender("codex-anchor", "alert");
  return send(card);
}
async function sendFailureCard(text) {
  try {
    await sendAlert({ header: { template: "red", title: { tag: "plain_text", content: "🚨 Codex 锚定脚本失败" } }, elements: [{ tag: "markdown", content: esc(text) }] });
  } catch (e) { log("failure card also failed:", e.message); }
}

// ---------- cards ----------
function remainStr(resetsSec) {
  const ms = resetsSec * 1000 - now();
  if (ms <= 0) return "已过期";
  const h = Math.floor(ms / 3.6e6), m = Math.round((ms % 3.6e6) / 6e4);
  return h > 0 ? `还剩 ${h}h${m}m` : `还剩 ${m}m`;
}
function buildDailyCard(rl, snapTs, st, anchored, resetCredits = null) {
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
    resetCredits != null ? `**重置卡**：${resetCredits} 张` : null,
    peak != null ? `**上一窗口峰值**：${peak}%` : null,
    `快照：${fmtT(snapTs)}（${ageMin} 分钟前）`,
  ].filter(Boolean);
  return { header: { template: p && p.used_percent >= 80 ? "orange" : "green", title: { tag: "plain_text", content: title } }, elements: [{ tag: "markdown", content: lines.join("\n") }] };
}

// ---------- opencodex real quota (zero-LLM API source) ----------
const OCX_QUOTA_URL = "http://127.0.0.1:10100/api/codex-auth/quota";
const OCX_REFRESH_URL = "http://127.0.0.1:10100/api/codex-auth/accounts/refresh";
const OCX_STALE_MS = 15 * 60 * 1000;
function ocxToken() { try { return readFileSync(join(homedir(), ".opencodex/admin-api-token"), "utf8").trim(); } catch { return ""; } }
function ocxSnap(j) {
  const qs = (j && j.quotas) || {};
  const key = qs.__main__ ? "__main__" : Object.keys(qs)[0];
  const q = key ? qs[key] : null;
  if (!q) return null;
  const bal = q.credits && q.credits.hasCredits ? Number(q.credits.balance) : null;
  const rl = {
    primary: q.shortPercent != null && q.shortResetAt ? { used_percent: q.shortPercent, resets_at: q.shortResetAt, window_minutes: Math.round((q.shortWindowSeconds || 18000) / 60) } : null,
    secondary: q.weeklyPercent != null && q.weeklyResetAt ? { used_percent: q.weeklyPercent, resets_at: q.weeklyResetAt } : null,
    credits: { has_credits: bal != null, balance: bal },
  };
  return { rl, ts: now(), updatedAt: q.updatedAt || null, resetCredits: q.resetCredits ?? null };
}
async function fetchOcxQuota(allowRefresh) {
  const token = ocxToken();
  if (!token) return null;
  const H = { Authorization: "Bearer " + token };
  try {
    const r = await fetch(OCX_QUOTA_URL, { headers: H, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    let snap = ocxSnap(await r.json());
    if (snap && allowRefresh && (!snap.updatedAt || now() - snap.updatedAt > OCX_STALE_MS)) {
      try {
        await fetch(OCX_REFRESH_URL, { method: "POST", headers: H, signal: AbortSignal.timeout(20000) });
        const r2 = await fetch(OCX_QUOTA_URL, { headers: H, signal: AbortSignal.timeout(8000) });
        if (r2.ok) { const s2 = ocxSnap(await r2.json()); if (s2) snap = s2; }
      } catch { /* refresh is best-effort, observational for raw admin */ }
    }
    return snap && snap.rl ? snap : null;
  } catch { return null; }
}

// ---------- usage-change notifications -> 通知群 (zero-LLM) ----------
function usageEvents(st, snap) {
  const out = [];
  const rc = snap.resetCredits;
  if (rc != null) {
    if (st.seenResetCredits == null) st.seenResetCredits = rc;
    else if (rc < st.seenResetCredits) {
      out.push({
        title: "🔄 Codex 重置卡被使用",
        body: `重置卡被使用 **${st.seenResetCredits - rc}** 张｜剩余 **${rc}** 张\n5h 窗口 ${snap.rl.primary?.used_percent ?? "?"}%｜周窗口 ${snap.rl.secondary?.used_percent ?? "?"}%`,
      });
      st.seenResetCredits = rc;
    } else if (rc > st.seenResetCredits) st.seenResetCredits = rc; // 新发卡：静默同步
  }
  const cr = snap.rl.credits?.has_credits ? Number(snap.rl.credits.balance) : null;
  if (cr != null) {
    if (st.seenCredits == null) st.seenCredits = cr;
    else {
      const d = st.seenCredits - cr;
      if (d >= 0.001) {
        out.push({ title: "💳 Codex Credits 被消耗", body: `Credits 被消耗 **$${d.toFixed(4)}**｜余额 **$${cr.toFixed(2)}**` });
        st.seenCredits = cr;
      } else if (d < 0) st.seenCredits = cr; // 充值/回补：静默同步
    }
  }
  return out;
}
function inQuietHours() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: BEIJING, hour: "2-digit", hour12: false }).format(new Date()));
  return h >= 23 || h < 8;
}
async function flushUsage(st, fresh) {
  const items = [...(st.pendingUsage || []), ...fresh];
  if (!items.length) return;
  if (inQuietHours()) { st.pendingUsage = items; log("usage notify queued (quiet hours):", items.length); return; }
  st.pendingUsage = [];
  const card = {
    header: { template: "blue", title: { tag: "plain_text", content: (process.env.USAGE_TEST === "1" ? "【测试】" : "") + (items.length > 1 ? `💳 Codex 额度变动（${items.length} 条）` : items[0].title) } },
    elements: items.map((it) => ({ tag: "markdown", content: `**${it.title}**\n${it.body}` })),
  };
  try { await sendPush(card); log("usage notify sent:", items.map((i) => i.title).join(" / ")); }
  catch (e) { st.pendingUsage = items; log("usage notify failed, requeued:", e.message); }
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
  const ocx = await fetchOcxQuota(true); // 账户重置卡余额（零额度消耗的观测读）
  recordSample(st, snap);
  await sendPush(buildDailyCard(snap.rl, snap.ts, st, anchored, ocx?.resetCredits ?? null));
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
  // 24/7：不区分工作日与时段，缓存读快照零请求
  let snap = await fetchOcxQuota(true);
  let src = "ocx";
  if (!snap) { snap = readSnapshot(); src = "rollout"; }
  if (!snap) { log("no snapshot yet"); return; }
  const snapAgeMin = Math.round((now() - snap.ts) / 6e4);
  if (src === "rollout" && snapAgeMin > 60) { log("stale rollout snapshot " + snapAgeMin + "m, skip"); return; }
  const st = loadState();
  recordSample(st, snap);
  const freshEvents = usageEvents(st, snap);
  if (process.env.USAGE_TEST === "1") freshEvents.push({ title: "🔄 Codex 重置卡被使用", body: "（自检）模拟消耗 1 张｜剩余 3 张" });
  await flushUsage(st, freshEvents);
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
  if (!card && p.used_percent >= 60 && !alerted.includes("60")) {
    alerted.push("60"); card = { header: { template: "yellow", title: { tag: "plain_text", content: "🟡 Codex 5h 窗口 60%" } }, elements: [{ tag: "markdown", content: base + "\n周窗口 " + (snap.rl.secondary?.used_percent ?? "?") + "%" }] };
  }

  if (!card && now() - st.burnLast > BURN_COOLDOWN_MS) {
    const recent = st.samples.filter((x) => x.t >= now() - BURN_WINDOW_MIN * 6e4 && x.p5 != null);
    if (recent.length >= 2) {
      const first = recent[0], last = recent[recent.length - 1];
      const jump = last.p5 - first.p5;
      if (jump >= BURN_JUMP_PP) {
        st.burnLast = now();
        const minsLeft = (p.resets_at * 1000 - now()) / 6e4;
        const proj = minsLeft > 0 ? Math.min(100, Math.round(last.p5 + (jump / BURN_WINDOW_MIN) * Math.min(minsLeft, 300))) : last.p5;
        const remainPp = 100 - last.p5;
        const exhaustMin = jump > 0 ? remainPp / (jump / BURN_WINDOW_MIN) : Infinity;
        let tail;
        if (minsLeft > 0 && exhaustMin < minsLeft) {
          const rec30 = Math.max(1, Math.floor((remainPp / minsLeft) * BURN_WINDOW_MIN));
          tail = `照此速度约 **${fmtT(now() + exhaustMin * 6e4)}** 就会用光（早于 ${fmtT(p.resets_at * 1000)} 刷新）\n想撑到刷新：把速度压到 ≤ **${rec30}pp/30min**（现在 ${Math.round(jump)}pp/30min）`;
        } else {
          tail = `按此速率到重置预计 **${proj}%**（不会用光）`;
        }
        card = { header: { template: "orange", title: { tag: "plain_text", content: "🔥 Codex 消耗过快" } }, elements: [{ tag: "markdown", content: `${base}\n近 ${BURN_WINDOW_MIN} 分钟涨 **${jump}pp**｜${tail}` }] };
      }
    }
  }

  // prune old window dedupe keys (keep 4)
  // weekly window alerts (2026-10-13): level gates one-shot per week + 3h burn projection
  const sw = snap.rl.secondary;
  if (!card && sw && sw.used_percent != null && sw.resets_at) {
    const wkey = "wk|" + sw.resets_at;
    const isFirst = !st.windowAlerts[wkey];
    const wAlerted = (st.windowAlerts[wkey] = st.windowAlerts[wkey] || []);
    for (const lv of [50, 75, 90]) if (isFirst && sw.used_percent >= lv && !wAlerted.includes(String(lv))) wAlerted.push(String(lv));
    const wBase = "周窗口已用 **" + sw.used_percent + "%**（" + fmtDT(sw.resets_at * 1000) + " 重置）";
    for (const gate of [[90, "red", "🔴"], [75, "orange", "🟠"], [50, "yellow", "🟡"]]) {
      if (sw.used_percent >= gate[0] && !wAlerted.includes(String(gate[0]))) {
        wAlerted.push(String(gate[0]));
        card = { header: { template: gate[1], title: { tag: "plain_text", content: gate[2] + " Codex 周窗口 " + gate[0] + "%" } }, elements: [{ tag: "markdown", content: wBase + "\n5h 窗口 " + p.used_percent + "%" }] };
        break;
      }
    }
    if (!card && now() - (st.wkBurnLast || 0) > 6 * 3.6e6) {
      const wRecent = st.samples.filter((x) => x.t >= now() - 3 * 3.6e6 && x.pw != null);
      if (wRecent.length >= 2) {
        const wJump = wRecent[wRecent.length - 1].pw - wRecent[0].pw;
        if (wJump >= 10) {
          st.wkBurnLast = now();
          const wDaysLeft = Math.max(0.01, (sw.resets_at * 1000 - now()) / 864e5);
          const wProj = Math.min(100, Math.round(sw.used_percent + wJump * 8 * wDaysLeft));
          const wPerDay = wJump * 8;
          const wRemain = 100 - sw.used_percent;
          const wExhaustDays = wPerDay > 0 ? wRemain / wPerDay : Infinity;
          let wTail;
          if (wExhaustDays < wDaysLeft) {
            const recDay = Math.max(1, Math.floor(wRemain / wDaysLeft));
            wTail = "照此速度约 **" + fmtDT(now() + wExhaustDays * 864e5) + "** 就会用光（早于 " + fmtDT(sw.resets_at * 1000) + " 刷新）\n想撑到刷新：把日耗压到 ≤ **" + recDay + "pp/天**（现在约 " + Math.round(wPerDay) + "pp/天）";
          } else {
            wTail = "按此速率到重置预计 **" + wProj + "%**（不会用光）";
          }
          card = { header: { template: "orange", title: { tag: "plain_text", content: "🔥 Codex 周额度消耗过快" } }, elements: [{ tag: "markdown", content: wBase + "\n近 3 小时涨 **" + wJump + "pp**｜" + wTail }] };
        }
      }
    }
  }

  const wk = Object.keys(st.windowAlerts);
  if (wk.length > 8) wk.sort((a, b) => Number(a.split("|")[1]) - Number(b.split("|")[1])).slice(0, wk.length - 8).forEach((k) => delete st.windowAlerts[k]);

  saveState(st);
  if (card) { await sendAlert(card); log("alert sent:", card.header.title.content); }
  else log(`monitor ok: ${p.used_percent}% [${src}]`);
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
