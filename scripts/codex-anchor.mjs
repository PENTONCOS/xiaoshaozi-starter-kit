#!/usr/bin/env node
// codex-anchor — Codex 5h 窗口锚定 + 余量监控. Zero-LLM (仅 spawn codex CLI 探测).
//
// 锚定     : 无固定定时探测。09:00–21:00 且 5h 窗口处于「空闲未认领」（relay 报 reset = 观测时刻 + 整窗长）时，
//            连续两次判空闲（≥8min）后自动探一次，把窗口锚在当下；90min 冷却 + 6 次/天上限兜成本。
//            依据：重置/自然到期只清零、不锚定，空闲窗口只有发请求才认领锚点（2026-10-13 实测）。
// 状态卡   : 每次自动补锚成功 → 推一张状态卡到通知群（5h/周窗口、Credits、上一窗口峰值、ΔCredits、重置卡余额）。
//            （原 09:00/14:05 固定日报卡已于 2026-10-13 退休，格式并入此卡——用户定案：固定探测逻辑改用自动补锚。）
// monitor  : 每 10 分钟（24/7 全天候）读 ocx quota（rollout 快照兜底，>60min 视为过期跳过），
//            60/80/95% 每窗口各告警一次；30min 涨 ≥15pp 触发燃烧过快告警（45min 冷却）；周窗口 50/75/90%。
// 失败处理 : probe 失败自动重试 1 次，仍失败走告警路由（告警群），失败卡冷却 1h。
// 数据来源 : opencodex quota API（127.0.0.1:10100，零额度观测）；rollout 快照兜底。
// 路由     : 状态卡 / 重置卡被使用 / Credits 被消耗 / 重置卡到期提醒 → 通知群（getSender "push"）；
//            余量/燃烧过快/失败卡 → 告警群（getSender "alert"）。
// 到期提醒 : 监控每轮读 reset-credits，最近一张卡 ≤7 天到期且未提醒过 → 单独推一条（按 expires_at 去重）。
// 调度     : monitor 24/7 每 10 分钟；不区分工作日与时段（2026-10-12 定案）。

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { getSender } from "/Users/cospeyton/notify/feishu-notify.mjs";

const SESSIONS = join(homedir(), ".codex/sessions");
const STATE_PATH = join(homedir(), "my-assistant/state/codex-anchor-state.json");
const LOG_TAG = "[codex-anchor]";
const BURN_WINDOW_MIN = 30;     // 燃烧速率观察窗
const BURN_JUMP_PP = 15;        // 30min 内涨 15 个百分点 → 燃烧过快
const SAFE_RESERVE_PP = 10;     // 安全余量：建议速度按「到重置留 10% 不用光」计算
const PRE_WARN_PP = 75;         // 5h 提前哨档位（2026-10-13 用户从 60 提到 75）
const BURN_COOLDOWN_MS = 45 * 60 * 1000;
const FAIL_COOLDOWN_MS = 60 * 60 * 1000;
const AUTO_PROBE_FROM = 9, AUTO_PROBE_TO = 21; // 自动补锚时段（北京时间）
const AUTO_PROBE_IDLE_MIN_MS = Number(process.env.AUTO_PROBE_IDLE_MS || 8 * 60 * 1000); // 连续空闲判定窗
const AUTO_PROBE_COOLDOWN_MS = 90 * 60 * 1000; // 两次自动补锚最短间隔
const AUTO_PROBE_MAX_PER_DAY = 6;              // 每日自动补锚上限（成为主力后放宽；真正的成本闸门是「仅在真空闲时探」）
const BEIJING = "Asia/Shanghai";

const mode = process.argv[2] || "";
const now = () => Date.now();
const log = (...a) => console.log(new Date().toISOString(), LOG_TAG, ...a);

const fmtT = (ts) => new Date(ts).toLocaleString("zh-CN", { timeZone: BEIJING, hour12: false, hour: "2-digit", minute: "2-digit" });
const fmtDT = (ts) => new Date(ts).toLocaleString("zh-CN", { timeZone: BEIJING, hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtD = (ts) => new Date(ts).toLocaleDateString("zh-CN", { timeZone: BEIJING, month: "2-digit", day: "2-digit" });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- state ----------
function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch { return { samples: [], windowAlerts: {}, peaks: {}, burnLast: 0, failLast: 0, dayCredits: {} }; }
}
function saveState(s) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s));
}

// 窗口去重键的稳定性（2026-10-13 修复）：API 报的 resets_at 会在同一窗口内小幅漂移
// （实测 5h 窗口内漂 1s〜11min），直接用 resets_at 当键→每次漂移都变成“新窗口”→闸门重新武装→重复告警。
const WINDOW_JITTER_SEC = 30 * 60; // 重置点差 ≤30min 视为同一窗口（真新窗口差 5h/数天）
function resolveWindow(st, field, prefix, resetSec, containers) {
  if (resetSec == null) return null;
  const cur = st[field];
  if (cur && Math.abs(cur.resetSec - resetSec) <= WINDOW_JITTER_SEC) { cur.resetSec = resetSec; return cur.key; }
  // 容错/迁移：已有同前缀 key 且重置点接近 → 沿用旧 key（升级当天不重报已报过的级别）
  for (const c of containers || []) {
    for (const k of Object.keys(c || {})) {
      if (!k.startsWith(prefix + "|")) continue;
      const v = Number(k.slice(prefix.length + 1));
      if (Number.isFinite(v) && Math.abs(v - resetSec) <= WINDOW_JITTER_SEC) { st[field] = { key: k, resetSec }; return k; }
    }
  }
  const key = prefix + "|" + resetSec;
  st[field] = { key, resetSec };
  return key;
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
  const totalMin = Math.max(0, Math.round(ms / 6e4)); // 先归整到分钟：锚定后 reset−now ≈ 5h−ε 会被误算成「4h60m」
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h > 0 ? `还剩 ${h}h${m}m` : `还剩 ${m}m`;
}
// 5h 燃烧外推：何时用光 + 建议压到多少（留 SAFE_RESERVE_PP% 余量）
function burnTail5h(usedPct, jump, minsLeft, resetTs) {
  const remainPp = 100 - usedPct;
  const perMin = jump / BURN_WINDOW_MIN;
  const exhaustMin = perMin > 0 ? remainPp / perMin : Infinity;
  if (minsLeft > 0 && exhaustMin < minsLeft) {
    const rec30 = Math.max(1, Math.floor(((remainPp - SAFE_RESERVE_PP) / minsLeft) * BURN_WINDOW_MIN));
    return `照此速度约 **${fmtT(now() + exhaustMin * 6e4)}** 就会用光（早于 ${fmtT(resetTs)} 刷新）\n想撑到刷新并留 ${SAFE_RESERVE_PP}% 余量：把速度压到 ≤ **${rec30}pp/30min**（现在 ${Math.round(jump)}pp/30min）`;
  }
  const proj = minsLeft > 0 ? Math.min(100, Math.round(usedPct + perMin * Math.min(minsLeft, 300))) : usedPct;
  return `按此速率到重置预计 **${proj}%**（不会用光）`;
}
// 周窗口燃烧外推：同逻辑，单位换成 pp/天
function burnTailWeekly(usedPct, jump, daysLeft, resetTs) {
  const wPerDay = jump * 8;
  const wRemain = 100 - usedPct;
  const exhaustDays = wPerDay > 0 ? wRemain / wPerDay : Infinity;
  if (exhaustDays < daysLeft) {
    const recDay = Math.max(1, Math.floor((wRemain - SAFE_RESERVE_PP) / daysLeft));
    return "照此速度约 **" + fmtDT(now() + exhaustDays * 864e5) + "** 就会用光（早于 " + fmtDT(resetTs) + " 刷新）\n想撑到刷新并留 " + SAFE_RESERVE_PP + "% 余量：把日耗压到 ≤ **" + recDay + "pp/天**（现在约 " + Math.round(wPerDay) + "pp/天）";
  }
  const wProj = Math.min(100, Math.round(usedPct + wPerDay * daysLeft));
  return "按此速率到重置预计 **" + wProj + "%**（不会用光）";
}
// 状态卡（原日报卡格式，2026-10-13 并入自动补锚卡；锚定/事件复用同一格式）
function buildStatusCard(rl, snapTs, st, anchored, resetCredits = null) {
  const p = rl.primary, s = rl.secondary;
  const ageMin = Math.max(0, Math.round((now() - snapTs) / 6e4));
  const credits = rl.credits?.has_credits ? Number(rl.credits.balance).toFixed(2) : null;
  const today = new Date().toLocaleDateString("zh-CN", { timeZone: BEIJING });
  const dayCred = st.dayCredits[today];
  const dCred = credits && dayCred != null ? (credits - dayCred) : null;
  const curKey = p ? (st.win5?.key || `w|${p.resets_at}`) : null; // 上一窗口峰值：排除当前（刚锚定）窗口，取其前一个
  const prevPeak = Object.entries(st.peaks).filter(([k]) => k !== curKey).sort((a, b) => Number(b[0].split("|")[1]) - Number(a[0].split("|")[1]))[0];
  const peak = prevPeak ? prevPeak[1] : null;
  const title = anchored ? "⚓ Codex 窗口已锚定（自动补锚）" : "⏱ Codex 窗口进行中";
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
const OCX_RESET_CREDITS_URL = "http://127.0.0.1:10100/api/codex-auth/reset-credits?accountId=__main__";
const OCX_STALE_MS = 5 * 60 * 1000; // 缓存超过 5 分钟就主动刷新（观测性、零额度）——15min 太松，阈值穿越会被漏报（2026-10-13 实测 78% vs 真实 91%）
const EXPIRY_WARN_DAYS = 7; // 重置卡到期提醒阈值（天）
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
  return { rl, ts: now(), updatedAt: q.updatedAt || null, resetCredits: q.resetCredits ?? null, observedAt: q.shortObservedAt ?? null, windowSeconds: q.shortWindowSeconds || 18000 };
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

// 读重置卡列表（含逐张 expires_at）——只读观测，零额度消耗
async function fetchResetCredits() {
  const token = ocxToken();
  if (!token) return null;
  try {
    const r = await fetch(OCX_RESET_CREDITS_URL, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.credits) ? j : null;
  } catch { return null; }
}
// 最早到期的一张卡（用于日报卡到期提醒）：无卡/无有效日期 → null
function expiringCredit(rc) {
  if (!rc || !Array.isArray(rc.credits) || !rc.credits.length) return null;
  let best = null;
  for (const c of rc.credits) {
    const exp = Date.parse(c && c.expires_at);
    if (!Number.isFinite(exp)) continue;
    if (!best || exp < best.exp) best = { exp };
  }
  return best ? { exp: best.exp, daysLeft: (best.exp - now()) / 864e5 } : null;
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
function beijingHour() { return Number(new Intl.DateTimeFormat("en-US", { timeZone: BEIJING, hour: "2-digit", hour12: false }).format(new Date())); }
function inQuietHours() { const h = beijingHour(); return h >= 23 || h < 8; }
// 空闲窗口判定：relay 对「无活动窗口」报 reset = 观测时刻 + 整窗长（2026-10-13 实测会随刷新滑动）；
// 真锚定后该差值 < 整窗长并持续缩小。rollout 快照无 observedAt → 不触发。
function windowIdle(snap) {
  const p = snap?.rl?.primary, obs = snap?.observedAt, win = snap?.windowSeconds || 18000;
  if (!p || !p.resets_at || obs == null) return false;
  return (p.resets_at - obs / 1000) >= win - 10;
}
// 自动补锚：09:00–21:00 且窗口空闲时，连续判闲 ≥8min 后探一次（探完锚点落下，条件自失效，天然不循环）
async function maybeAutoAnchor(st, snap) {
  const p = snap.rl?.primary;
  const idle = p && p.used_percent === 0 && windowIdle(snap);
  const h = beijingHour();
  if (!idle || h < AUTO_PROBE_FROM || h >= AUTO_PROBE_TO) { if (st.idleFirstSeen) { st.idleFirstSeen = null; saveState(st); } return false; }
  if (!st.idleFirstSeen) { st.idleFirstSeen = now(); saveState(st); log("auto-anchor: window idle, watching..."); return false; }
  if (now() - st.idleFirstSeen < AUTO_PROBE_IDLE_MIN_MS) return false;
  const today = new Date().toLocaleDateString("zh-CN", { timeZone: BEIJING });
  const cnt = st.autoProbeDay && st.autoProbeDay.date === today ? st.autoProbeDay.count : 0;
  if (cnt >= AUTO_PROBE_MAX_PER_DAY) { log("auto-anchor: daily cap reached, skip"); return false; }
  if (now() - (st.lastAutoProbe || 0) < AUTO_PROBE_COOLDOWN_MS) { log("auto-anchor: cooldown, skip"); return false; }
  if (process.env.AUTO_PROBE_DRYRUN === "1") { log("[dryrun] auto-anchor would probe now"); return false; }
  st.lastAutoProbe = now(); st.autoProbeDay = { date: today, count: cnt + 1 }; st.idleFirstSeen = null; saveState(st);
  log(`auto-anchor: idle confirmed, probing (${cnt + 1}/${AUTO_PROBE_MAX_PER_DAY})...`);
  const ok = await probeWithRetry();
  log(ok ? "auto-anchor: probe done, window claimed" : "auto-anchor: probe failed");
  return ok;
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

// 重置卡到期提醒卡（独立推送，不含在状态卡里——用户定案 2026-10-13）
function buildExpiryCard(ec, n) {
  const d = Math.max(0, Math.ceil(ec.daysLeft));
  return {
    header: { template: "yellow", title: { tag: "plain_text", content: "🎫 Codex 重置卡即将过期" } },
    elements: [{ tag: "markdown", content: `最近一张重置卡 **${fmtD(ec.exp)} 到期**（${d > 0 ? `还剩 ${d} 天` : "不足 1 天"}）${n != null ? `｜当前剩 ${n} 张` : ""}\n趁没过期先用掉，否则作废。` }],
  };
}
// 监控每轮调用：最近一张卡 ≤EXPIRY_WARN_DAYS 天到期且未提醒过 → 推一条（按 expires_at 去重；静默时段顺延）
async function maybeExpiryReminder(st) {
  const rcs = await fetchResetCredits();
  const ec = expiringCredit(rcs);
  if (!ec || ec.daysLeft > EXPIRY_WARN_DAYS) return false;
  const key = String(ec.exp);
  if (st.expiryWarned && st.expiryWarned[key]) return false;
  if (inQuietHours()) { log("expiry reminder deferred (quiet hours)"); return false; }
  const n = rcs && typeof rcs.available_count === "number" ? rcs.available_count : null;
  try {
    await sendPush(buildExpiryCard(ec, n));
    st.expiryWarned = st.expiryWarned || {};
    st.expiryWarned[key] = now();
    const ks = Object.keys(st.expiryWarned);
    if (ks.length > 10) ks.sort((a, b) => Number(a) - Number(b)).slice(0, ks.length - 10).forEach((k) => delete st.expiryWarned[k]);
    log(`expiry reminder sent: ${fmtD(ec.exp)} (${ec.daysLeft.toFixed(2)}d), ${n} 张`);
    return true;
  } catch (e) { log("expiry reminder failed:", e.message); return false; }
}

// ---------- morning（2026-10-13 退休：固定日报取消，锚定交给 monitor 的自动补锚）----------

// ---------- sampling & alerts ----------
function recordSample(st, snap) {
  const p = snap.rl.primary, s = snap.rl.secondary;
  const k5 = p ? resolveWindow(st, "win5", "w", p.resets_at, [st.windowAlerts, st.peaks]) : null;
  const kw = s ? resolveWindow(st, "winwk", "wk", s.resets_at, [st.windowAlerts]) : null;
  st.samples.push({ t: snap.ts, p5: p?.used_percent ?? null, w5: p?.resets_at ?? null, k: k5, pw: s?.used_percent ?? null, ww: s?.resets_at ?? null, kw, cr: snap.rl.credits?.has_credits ? Number(snap.rl.credits.balance) : null });
  // per-window peak tracking (key: resolved window key, drift-proof)
  if (p && k5) {
    const winKey = k5;
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
  // 迁移（2026-10-13）：提前哨 60%→75%；已报过更高级别时低级别一并标记，避免升级/跳档后重报一条
  for (const k of Object.keys(st.windowAlerts || {})) {
    const a = st.windowAlerts[k];
    if (!Array.isArray(a) || !a.length) continue;
    const s = new Set(a.map((x) => (x === "60" ? String(PRE_WARN_PP) : x)));
    const nums = [...s].map(Number).filter(Number.isFinite);
    const top = nums.length ? Math.max(...nums) : -1;
    for (const v of [PRE_WARN_PP, 80, 95]) if (v <= top) s.add(String(v));
    st.windowAlerts[k] = [...s];
  }
  // 空闲窗口自动补锚（09:00–21:00）：重置/到期只清零不锚定，补一次请求把窗口锚在当下
  const anchored = await maybeAutoAnchor(st, snap);
  if (anchored) {
    const fresh = await fetchOcxQuota(true);
    if (fresh) { snap = fresh; src = "ocx"; }
  }
  recordSample(st, snap);
  // 补锚成功 → 推状态卡（原日报卡格式）到通知群
  if (anchored) {
    await sendPush(buildStatusCard(snap.rl, snap.ts, st, true, snap.resetCredits ?? null));
    log("anchor status card sent");
  }
  const freshEvents = usageEvents(st, snap);
  if (process.env.USAGE_TEST === "1") freshEvents.push({ title: "🔄 Codex 重置卡被使用", body: "（自检）模拟消耗 1 张｜剩余 3 张" });
  await flushUsage(st, freshEvents);
  const p = snap.rl.primary;
  if (!p) { saveState(st); return; }
  const winKey = st.win5?.key || `w|${p.resets_at}`;
  st.windowAlerts[winKey] = st.windowAlerts[winKey] || [];
  const alerted = st.windowAlerts[winKey];
  const lines = [];
  let card = null;

  const base = `5h 窗口已用 **${p.used_percent}%**（${fmtT(p.resets_at * 1000)} 重置，${remainStr(p.resets_at)}）`;
  const mark5h = (lv) => { for (const v of [PRE_WARN_PP, 80, 95]) if (v <= lv && !alerted.includes(String(v))) alerted.push(String(v)); }; // 报高级别时把更低的闸一并标记，避免跳档后补报一条
  if (p.used_percent >= 95 && !alerted.includes("95")) {
    mark5h(95); card = { header: { template: "red", title: { tag: "plain_text", content: "🔴 Codex 5h 窗口 95%" } }, elements: [{ tag: "markdown", content: `${base}\n周窗口 ${snap.rl.secondary?.used_percent ?? "?"}%` }] };
  } else if (p.used_percent >= 80 && !alerted.includes("80")) {
    mark5h(80); card = { header: { template: "orange", title: { tag: "plain_text", content: "🟠 Codex 5h 窗口 80%" } }, elements: [{ tag: "markdown", content: `${base}\n周窗口 ${snap.rl.secondary?.used_percent ?? "?"}%` }] };
  }

  // 提前哨：5h 用量越 PRE_WARN_PP（默认 75%）先报一条，每窗口一次
  if (!card && p.used_percent >= PRE_WARN_PP && !alerted.includes(String(PRE_WARN_PP))) {
    mark5h(PRE_WARN_PP); card = { header: { template: "yellow", title: { tag: "plain_text", content: `🟡 Codex 5h 窗口 ${PRE_WARN_PP}%` } }, elements: [{ tag: "markdown", content: base + "\n周窗口 " + (snap.rl.secondary?.used_percent ?? "?") + "%" }] };
  }

  if (!card && now() - st.burnLast > BURN_COOLDOWN_MS) {
    const recent = st.samples.filter((x) => x.t >= now() - BURN_WINDOW_MIN * 6e4 && x.p5 != null && (x.k ? x.k === winKey : x.w5 === p.resets_at)); // 仅同窗口：跨重置取样本会把真实爬升稀释（重置后 first 可能拿到重置前高值）
    if (recent.length >= 2) {
      const first = recent[0], last = recent[recent.length - 1];
      const jump = last.p5 - first.p5;
      if (jump >= BURN_JUMP_PP) {
        st.burnLast = now();
        const minsLeft = (p.resets_at * 1000 - now()) / 6e4;
        const tail = burnTail5h(last.p5, jump, minsLeft, p.resets_at * 1000);
        card = { header: { template: "orange", title: { tag: "plain_text", content: "🔥 Codex 消耗过快" } }, elements: [{ tag: "markdown", content: `${base}\n近 ${BURN_WINDOW_MIN} 分钟涨 **${jump}pp**｜${tail}` }] };
      }
    }
  }

  // prune old window dedupe keys (keep 4)
  // weekly window alerts (2026-10-13): level gates one-shot per week + 3h burn projection
  const sw = snap.rl.secondary;
  if (!card && sw && sw.used_percent != null && sw.resets_at) {
    const wkey = st.winwk?.key || "wk|" + sw.resets_at;
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
      const wRecent = st.samples.filter((x) => x.t >= now() - 3 * 3.6e6 && x.pw != null && (x.kw ? x.kw === wkey : x.ww === sw.resets_at)); // 仅同周窗口
      if (wRecent.length >= 2) {
        const wJump = wRecent[wRecent.length - 1].pw - wRecent[0].pw;
        if (wJump >= 10) {
          st.wkBurnLast = now();
          const wDaysLeft = Math.max(0.01, (sw.resets_at * 1000 - now()) / 864e5);
          const wTail = burnTailWeekly(sw.used_percent, wJump, wDaysLeft, sw.resets_at * 1000);
          card = { header: { template: "orange", title: { tag: "plain_text", content: "🔥 Codex 周额度消耗过快" } }, elements: [{ tag: "markdown", content: wBase + "\n近 3 小时涨 **" + wJump + "pp**｜" + wTail }] };
        }
      }
    }
  }

  const wk = Object.keys(st.windowAlerts);
  if (wk.length > 8) wk.sort((a, b) => Number(a.split("|")[1]) - Number(b.split("|")[1])).slice(0, wk.length - 8).forEach((k) => delete st.windowAlerts[k]);

  await maybeExpiryReminder(st); // 重置卡 7 天到期提醒（独立推送，按 expires_at 去重）
  saveState(st);
  if (card) { await sendAlert(card); log("alert sent:", card.header.title.content); }
  else log(`monitor ok: ${p.used_percent}% [${src}]`);
}

// ---------- self-test: 往告警群推一张模拟燃烧卡（不读真实数据、不改 state）----------
async function burnedTest() {
  const u5 = Number(process.env.BURN_TEST_USED || 28);
  const j5 = Number(process.env.BURN_TEST_JUMP || 21);
  const ml = Number(process.env.BURN_TEST_MINSLEFT || 200);
  const reset5 = now() + ml * 6e4;
  const base5 = `5h 窗口已用 **${u5}%**（${fmtT(reset5)} 重置，${remainStr(Math.floor(reset5 / 1000))}）`;
  const c5 = { header: { template: "orange", title: { tag: "plain_text", content: "【测试】🔥 Codex 消耗过快" } }, elements: [{ tag: "markdown", content: `${base5}\n近 ${BURN_WINDOW_MIN} 分钟涨 **${j5}pp**｜${burnTail5h(u5, j5, ml, reset5)}` }] };
  await sendAlert(c5); log("alert sent(test):", c5.header.title.content);

  const uw = Number(process.env.BURN_TEST_WUSED || 21);
  const jw = Number(process.env.BURN_TEST_WJUMP || 12);
  const dl = Number(process.env.BURN_TEST_WDAYSLEFT || 5.27);
  const resetw = now() + dl * 864e5;
  const cw = { header: { template: "orange", title: { tag: "plain_text", content: "【测试】🔥 Codex 周额度消耗过快" } }, elements: [{ tag: "markdown", content: `周窗口已用 **${uw}%**（${fmtDT(resetw)} 重置）\n近 3 小时涨 **${jw}pp**｜${burnTailWeekly(uw, jw, dl, resetw)}` }] };
  await sendAlert(cw); log("alert sent(test):", cw.header.title.content);
}

// ---------- self-test: 打印状态卡 + 到期提醒卡（不发卡；另做真实路径只读校验）----------
async function cardTest() {
  const real = await fetchResetCredits();
  const realEc = expiringCredit(real);
  console.log("real reset-credits:", real ? `${real.available_count} 张` : "读取失败");
  console.log("real earliest expiry:", realEc ? `${new Date(realEc.exp).toISOString()} (${realEc.daysLeft.toFixed(2)} 天，提醒=${realEc.daysLeft <= EXPIRY_WARN_DAYS})` : "-");
  const rl = {
    primary: { used_percent: 1, resets_at: Math.floor((now() + 5 * 3.6e6) / 1000) },
    secondary: { used_percent: 30, resets_at: Math.floor((now() + 4 * 864e5) / 1000) },
    credits: { has_credits: true, balance: 2955.17 },
  };
  const st = { dayCredits: {}, peaks: { "w|1000000000": 53 }, samples: [] };
  console.log("--- status card (auto-anchor) ---");
  console.log(JSON.stringify(buildStatusCard(rl, now(), st, true, 3), null, 2));
  const days = Number(process.env.CREDIT_TEST_DAYS || 5.2);
  console.log("--- expiry reminder card (synthetic " + days + "d) ---");
  console.log(JSON.stringify(buildExpiryCard({ exp: now() + days * 864e5, daysLeft: days }, 3), null, 2));
}

// ---------- self-test: 窗口键漂移鲁棒性 ----------
function windowTest() {
  const st = {};
  const seq = [1791886824, 1791887504, 1791887725, 1791887724, 1791887724];
  for (const r of seq) console.log("reset", r, "->", resolveWindow(st, "win5", "w", r, []));
  const nw = 1791887724 + 18000;
  console.log("reset", nw, "(真·新窗口 +5h) ->", resolveWindow(st, "win5", "w", nw, []));
  const st2 = { windowAlerts: { "w|1791887504": ["60"], "wk|1792474524": ["50"] } };
  const k1 = resolveWindow(st2, "win5", "w", 1791887724, [st2.windowAlerts]);
  const k2 = resolveWindow(st2, "winwk", "wk", 1792474524, [st2.windowAlerts]);
  console.log("迁移 5h ->", k1, "| 已报级别:", st2.windowAlerts[k1]);
  console.log("迁移 wk ->", k2, "| 已报级别:", st2.windowAlerts[k2]);
}

// ---------- main ----------
try {
  if (process.env.WINDOW_TEST === "1") windowTest();
  else if (process.env.CARD_TEST === "1") await cardTest();
  else if (process.env.BURN_TEST === "1") await burnedTest();
  else if (mode === "monitor") await monitor();
  else { console.error("usage: codex-anchor.mjs monitor"); process.exit(2); }
} catch (e) {
  console.error("FATAL", e);
  if (now() - loadState().failLast > FAIL_COOLDOWN_MS) await sendFailureCard(`未捕获异常: ${e.message}`);
  process.exit(1);
}
