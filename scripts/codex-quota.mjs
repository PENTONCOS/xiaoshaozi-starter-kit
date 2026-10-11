#!/usr/bin/env node
// codex-quota — show Codex (ChatGPT pool) rate-limit & credit balance.
// Zero-dependency Node. Default mode: cached — mines the newest rate_limits
// snapshot already recorded in local session files (~/.codex/sessions/...),
// ZERO tokens spent. `--probe`: sends one minimal codex exec request
// (~18k tokens billed to the ChatGPT pool) to obtain a fresh snapshot.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const SESSIONS = join(homedir(), ".codex/sessions");
const PROBE = process.argv.includes("--probe");
const BEIJING = "Asia/Shanghai";
const fmt = (ts, withDate = false) => new Date(ts).toLocaleString("zh-CN", {
  timeZone: BEIJING, hour12: false,
  ...(withDate ? {} : { hour: "2-digit", minute: "2-digit" }),
});

function candidateFiles(maxDays = 2) {
  const out = [];
  // layout: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
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
        files.sort().reverse(); // filename embeds rollout timestamp
        for (const f of files) out.push(join(SESSIONS, y, m, d, f));
      }
    }
    if (out.length) break; // newest year with data is enough
  }
  return out;
}

function extractSnapshot(file) {
  let raw;
  try {
    if (statSync(file).size > 50e6) return null; // skip huge rollouts
    raw = readFileSync(file, "utf8");
  } catch { return null; }
  let best = null;
  for (const line of raw.split("\n")) {
    if (!line.includes('"rate_limits"') || !line.includes('"primary":{')) continue;
    try {
      const obj = JSON.parse(line);
      const found = findRl(obj);
      if (found) best = found; // keep the LAST occurrence in the file
    } catch { /* partial line, skip */ }
  }
  return best;
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

function fileTimeMs(file) {
  const m = file.match(/rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`).getTime() : statSync(file).mtimeMs;
}

function printQuota(rl, snapMs) {
  const ageMin = Math.max(0, Math.round((Date.now() - snapMs) / 6e4));
  const p = rl.primary, s = rl.secondary;
  console.log(`快照时间：${fmt(snapMs, true)}（${ageMin >= 60 ? `${Math.floor(ageMin / 60)} 小时` : `${ageMin} 分钟`}前）`);
  if (p) console.log(`短窗口（${p.window_minutes / 60}h）：已用 ${p.used_percent}%，重置于 ${fmt(p.resets_at * 1000)}`);
  if (s) console.log(`周窗口：已用 ${s.used_percent}%，重置于 ${fmt(s.resets_at * 1000, true)}`);
  const c = rl.credits;
  if (c && c.has_credits) console.log(`Credits 余额：$${Number(c.balance).toFixed(2)}${c.unlimited ? "（无限）" : ""}`);
  if (p && p.used_percent === 0 && (!s || s.used_percent === 0)) console.log("状态：额度充足 ✅");
  if (ageMin > 300) console.log("提示：快照已超过 5h 窗口时效，跑 `codex-quota --probe` 获取实时数据");
}

async function main() {
  if (PROBE) {
    console.error("探测中：发送最小请求到 ChatGPT 池（约 1.8 万 token）…");
    const r = spawnSync("codex", ["exec", "--skip-git-repo-check", "-s", "read-only", "-m", "openai/gpt-6.1-sol", "Reply with exactly: OK"], { timeout: 180000, encoding: "utf8" });
    if (r.error || (r.status !== 0 && !r.stdout)) {
      console.error(`探测失败：${r.error?.message ?? r.stderr?.slice(0, 200) ?? `exit ${r.status}`}`);
      process.exit(1);
    }
  }
  for (const f of candidateFiles()) {
    const rl = extractSnapshot(f);
    if (rl) {
      printQuota(rl, fileTimeMs(f));
      return;
    }
  }
  console.error("本地没有可用的额度快照。跑 `codex-quota --probe` 发一次探测请求即可。");
  process.exit(1);
}

main();
