#!/usr/bin/env node
/**
 * codex-usage-stat.mjs — zero-LLM model-usage breakdown for deploy cards.
 *
 * Source: ~/.opencodex/usage.jsonl (Codex CLI traffic through the ocx proxy).
 * Scope: covers `codex exec` work only. OpenClaw's own orchestration calls
 * (the agent model) are NOT routed through ocx and are NOT counted here.
 *
 * Usage:
 *   node codex-usage-stat.mjs mark [label]         snapshot the ledger position
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

const HOME = os.homedir();
const LEDGER = process.env.OCX_USAGE_LEDGER || path.join(HOME, ".opencodex", "usage.jsonl");
const MARKS = process.env.OCX_USAGE_MARKS || path.join(HOME, ".opencodex", "usage-marks.jsonl");

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

function rowTokens(row) {
    if (typeof row.totalTokens === "number") return row.totalTokens;
    const u = row.usage || {};
    return (u.inputTokens || 0) + (u.outputTokens || 0);
}

function aggregate(rows, startLine, startTs) {
    const slice = rows.filter((r) => r.__line >= startLine && (!startTs || r.timestamp >= startTs));
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
    };
}

function resolveWindow(rows, args) {
    if (args.includes("--all")) return { startLine: 0, startTs: 0, label: "全部" };
    const i = args.indexOf("--since");
    if (i !== -1) {
        const raw = args[i + 1];
        const ts = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
        if (!Number.isFinite(ts)) throw new Error(`bad --since value: ${raw}`);
        return { startLine: 0, startTs: ts, label: `自 ${fmtTs(ts)}` };
    }
    const marks = readMarks();
    const last = marks[marks.length - 1];
    if (!last) return { startLine: 0, startTs: 0, label: "全部（无 mark）" };
    return { startLine: last.lines, startTs: 0, label: `自 mark「${last.label}」` };
}

function textReport(result, windowLabel) {
    const lines = [];
    lines.push(`窗口: ${windowLabel}`);
    lines.push(`区间: ${fmtTs(result.first)} → ${fmtTs(result.last)}`);
    lines.push(`调用: ${result.calls} 次   合计: ${fmtNum(result.totalTokens)} tokens`);
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
    const lines = ["**模型消耗**" + (windowLabel ? `（${windowLabel}）` : "")];
    for (const m of result.models) {
        const fail = m.fail ? `，${m.fail} 失败` : "";
        lines.push(`- ${m.model} — **${(m.share * 100).toFixed(0)}%** · ${fmtTok(m.tokens)} tok · ${m.calls} 次${fail}`);
    }
    lines.push(`- 合计 **${fmtTok(result.totalTokens)} tokens / ${result.calls} 次调用**`);
    lines.push("");
    lines.push("_口径：ocx 账本（Codex CLI 侧），不含编排模型调用_");
    return lines.join("\n");
}

const [, , cmd = "report", ...args] = process.argv;
const rows = readLedger();

try {
    if (cmd === "mark") {
        const label = args.find((a) => !a.startsWith("-")) || `mark-${new Date().toISOString().slice(0, 16)}`;
        fs.mkdirSync(path.dirname(MARKS), { recursive: true });
        fs.appendFileSync(MARKS, JSON.stringify({ label, ts: Date.now(), lines: rows.length }) + "\n");
        console.log(`marked「${label}」at ledger line ${rows.length}`);
    } else if (cmd === "report" || cmd === "card") {
        const win = resolveWindow(rows, args);
        const result = aggregate(rows, win.startLine, win.startTs);
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
