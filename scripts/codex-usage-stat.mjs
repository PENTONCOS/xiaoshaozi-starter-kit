#!/usr/bin/env node
/**
 * codex-usage-stat.mjs — zero-LLM model-usage breakdown for deploy cards.
 *
 * Source A: ~/.opencodex/usage.jsonl (Codex CLI traffic through the ocx proxy),
 *           MINUS background calls marked in ~/.opencodex/background-calls.jsonl
 *           (anchor probes, scheduled briefings — not deploy work).
 * Source B: `openclaw sessions --json` — OpenClaw's own orchestration/agent tokens,
 *           measured as the DELTA between two `mark` snapshots (session counters).
 * 口径：只统计「本批次」真实工作流量；补锚探针 / 定时摘要等后台调用会被剔除。
 *
 * Usage:
 *   node codex-usage-stat.mjs mark [label]         snapshot ledger position + OpenClaw sessions
 *   node codex-usage-stat.mjs report [--json]      aggregate since the last mark
 *   node codex-usage-stat.mjs report --all         aggregate the whole ledger
 *   node codex-usage-stat.mjs report --since <iso|epochMs>
 *   node codex-usage-stat.mjs card [--all|--since …]   lark_md block for a card
 *
 * Deploy-card convention: `mark` when a work batch starts, then embed the
 * `card` output in the deployment push card.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const LEDGER = process.env.OCX_USAGE_LEDGER || path.join(HOME, ".opencodex", "usage.jsonl");
const MARKS = process.env.OCX_USAGE_MARKS || path.join(HOME, ".opencodex", "usage-marks.jsonl");
// 后台调用标记（补锚探针 / 定时摘要等）：由调用方在发请求前追加一行；统计时按「模型 + 时间窗」剔除。
const BACKGROUND = process.env.OCX_USAGE_BACKGROUND || path.join(HOME, ".opencodex", "background-calls.jsonl");
const BACKGROUND_WINDOW_MS = Number(process.env.OCX_BACKGROUND_WINDOW_MS || 180000);

const fmtTs = (ms) => (ms ? new Date(Number(ms)).toISOString().replace("T", " ").slice(0, 19) + "Z" : "?");
const fmtNum = (n) => Math.round(n).toLocaleString("en-US");
const fmtTok = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));

function readLedger() {
    if (!fs.existsSync(LEDGER)) return [];
    return fs
        .readFileSync(LEDGER, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line, i) => {
            try {
                const row = JSON.parse(line);
                row.__line = i;
                return row;
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function readMarks() {
    if (!fs.existsSync(MARKS)) return [];
    return fs
        .readFileSync(MARKS, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function readBackground() {
    if (!fs.existsSync(BACKGROUND)) return [];
    return fs
        .readFileSync(BACKGROUND, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function rowIsBackground(row, markers) {
    const model = row.model || "";
    const requested = row.requestedModel || "";
    const prefixed = `${row.provider || "?"}/${model}`;
    for (const m of markers) {
        if (!m || !m.model) continue;
        if (m.model !== model && m.model !== requested && m.model !== prefixed) continue;
        const d = row.timestamp - m.ts;
        if (d >= -5000 && d <= BACKGROUND_WINDOW_MS) return true;
    }
    return false;
}

function findOpenclaw() {
    const candidates = [
        process.env.OPENCLAW_BIN,
        path.join(HOME, ".openclaw/tmp/agent-cli/openclaw"),
        "/usr/local/bin/openclaw",
        "/opt/homebrew/bin/openclaw",
    ].filter(Boolean);
    for (const c of candidates) {
        try {
            if (fs.existsSync(c)) return c;
        } catch {
            /* ignore */
        }
    }
    return "openclaw";
}

function snapshotOpenClaw() {
    // best-effort: missing CLI / gateway just yields no OpenClaw data (never throws).
    try {
        const raw = execFileSync(findOpenclaw(), ["sessions", "--json", "--limit", "all"], {
            encoding: "utf8",
            timeout: 60000,
            stdio: ["ignore", "pipe", "ignore"],
        });
        const parsed = JSON.parse(raw);
        const sessions = Array.isArray(parsed) ? parsed : parsed.sessions || [];
        const byKey = {};
        for (const s of sessions) {
            if (!s || !s.key) continue;
            byKey[s.key] = {
                t: (s.inputTokens || 0) + (s.outputTokens || 0),
                m: `${s.modelProvider || "?"}/${s.model || "?"}`,
            };
        }
        return { at: Date.now(), count: Object.keys(byKey).length, byKey };
    } catch {
        return null;
    }
}

function openclawDelta(markSnapshot, now) {
    if (!markSnapshot || !markSnapshot.byKey || !now) return null;
    const before = markSnapshot.byKey;
    const models = new Map();
    let tokens = 0;
    let sessions = 0;
    for (const [key, cur] of Object.entries(now.byKey)) {
        const prev = before[key];
        const delta = prev ? Math.max(0, cur.t - prev.t) : cur.t;
        if (delta <= 0) continue;
        tokens += delta;
        sessions += 1;
        const entry = models.get(cur.m) || { model: cur.m, tokens: 0, sessions: 0 };
        entry.tokens += delta;
        entry.sessions += 1;
        models.set(cur.m, entry);
    }
    return { tokens, sessions, models: [...models.values()].sort((a, b) => b.tokens - a.tokens) };
}

function rowTokens(row) {
    if (typeof row.totalTokens === "number") return row.totalTokens;
    const u = row.usage || {};
    return (u.inputTokens || 0) + (u.outputTokens || 0);
}

function aggregate(rows, startLine, startTs, markers = []) {
    const inWindow = rows.filter((r) => r.__line >= startLine && (!startTs || r.timestamp >= startTs));
    const slice = inWindow.filter((r) => !rowIsBackground(r, markers));
    const excluded = inWindow.length - slice.length;
    const byModel = new Map();
    let totalTokens = 0;
    for (const r of slice) {
        const key = `${r.provider || "?"}/${r.model || "?"}`;
        const entry = byModel.get(key) || { model: key, calls: 0, ok: 0, fail: 0, tokens: 0 };
        entry.calls += 1;
        if (r.status === 200) entry.ok += 1;
        else entry.fail += 1;
        entry.tokens += rowTokens(r);
        byModel.set(key, entry);
        totalTokens += rowTokens(r);
    }
    const models = [...byModel.values()].sort((a, b) => b.tokens - a.tokens);
    for (const m of models) m.share = totalTokens ? m.tokens / totalTokens : 0;
    return {
        models,
        calls: slice.length,
        totalTokens,
        first: slice[0]?.timestamp,
        last: slice[slice.length - 1]?.timestamp,
        excluded,
    };
}

function resolveWindow(rows, args) {
    if (args.includes("--all")) return { startLine: 0, startTs: 0, label: "全部", mark: null };
    const i = args.indexOf("--since");
    if (i !== -1) {
        const raw = args[i + 1];
        const ts = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
        if (!Number.isFinite(ts)) throw new Error(`bad --since value: ${raw}`);
        return { startLine: 0, startTs: ts, label: `自 ${fmtTs(ts)}`, mark: null };
    }
    const marks = readMarks();
    const last = marks[marks.length - 1];
    if (!last) return { startLine: 0, startTs: 0, label: "全部（无 mark）", mark: null };
    return { startLine: last.lines, startTs: 0, label: `自 mark「${last.label}」`, mark: last };
}

function textReport(result, windowLabel) {
    const lines = [];
    const oc = result.openclaw;
    lines.push(`窗口: ${windowLabel}`);
    lines.push(`区间: ${fmtTs(result.first)} → ${fmtTs(result.last)}`);
    if (oc && oc.tokens > 0) {
        lines.push(`编排/编码 (OpenClaw): ${fmtNum(oc.tokens)} tokens / ${oc.sessions} 会话`);
        for (const m of oc.models) lines.push(`  ${m.model.padEnd(28)}${fmtNum(m.tokens).padStart(12)}`);
    } else {
        lines.push("编排/编码 (OpenClaw): 无数据（缺少 mark 快照，或窗口内无变更）");
    }
    lines.push(`codex CLI: ${result.calls} 次   合计: ${fmtNum(result.totalTokens)} tokens`);
    if (result.excluded) lines.push(`已剔除后台调用: ${result.excluded} 条`);
    lines.push("");
    const wModel = Math.max(8, ...result.models.map((m) => m.model.length));
    lines.push(`${"模型".padEnd(wModel)}${"占比".padStart(7)}${"tokens".padStart(12)}${"调用".padStart(6)}`);
    for (const m of result.models) {
        const note = m.fail ? `  (${m.ok}✓${m.fail}✗)` : "";
        lines.push(`${m.model.padEnd(wModel)}${((m.share * 100).toFixed(1) + "%").padStart(7)}${fmtNum(m.tokens).padStart(12)}${String(m.calls).padStart(6)}${note}`);
    }
    return lines.join("\n");
}

function cardBlock(result, windowLabel) {
    // 2026-10-18 用户定案：只列「本批次消耗的模型 + token」，去掉其余说明。
    const merged = new Map();
    const add = (m, t) => merged.set(m, (merged.get(m) || 0) + t);
    const oc = result.openclaw;
    if (oc && oc.tokens > 0) for (const m of oc.models) add(m.model, m.tokens);
    for (const m of result.models) add(m.model, m.tokens);
    const rows = [...merged.entries()].sort((a, b) => b[1] - a[1]);
    const lines = ["**模型消耗**（本批次）"];
    for (const [m, t] of rows) lines.push(`· ${m} — ${fmtTok(t)} tok`);
    const total = rows.reduce((s, [, t]) => s + t, 0);
    lines.push(`· 合计 **${fmtTok(total)} tok**`);
    return lines.join("\n");
}

const [, , cmd = "report", ...args] = process.argv;
const rows = readLedger();

try {
    if (cmd === "mark") {
        const label = args.find((a) => !a.startsWith("-")) || `mark-${new Date().toISOString().slice(0, 16)}`;
        fs.mkdirSync(path.dirname(MARKS), { recursive: true });
        const snapshot = snapshotOpenClaw();
        const record = { label, ts: Date.now(), lines: rows.length };
        if (snapshot) record.openclaw = snapshot;
        fs.appendFileSync(MARKS, JSON.stringify(record) + "\n");
        console.log(`marked「${label}」at ledger line ${rows.length}${snapshot ? ` · openclaw ${snapshot.count} sessions` : " · openclaw unavailable"}`);
    } else if (cmd === "report" || cmd === "card") {
        const win = resolveWindow(rows, args);
        const markers = readBackground();
        const result = aggregate(rows, win.startLine, win.startTs, markers);
        result.openclaw = win.mark ? openclawDelta(win.mark.openclaw, snapshotOpenClaw()) : null;
        if (args.includes("--json")) console.log(JSON.stringify({ window: win.label, ...result }, null, 2));
        else if (cmd === "card") console.log(cardBlock(result, win.label));
        else console.log(textReport(result, win.label));
    } else {
        console.error(`unknown command: ${cmd}`);
        process.exit(2);
    }
} catch (error) {
    console.error(error?.message || error);
    process.exit(1);
}
