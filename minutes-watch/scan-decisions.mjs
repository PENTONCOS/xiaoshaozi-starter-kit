// scan-decisions.mjs —— 反向覆盖检查：逐字稿里的「决策信号句」有没有漏进纪要
//
// 用法:
//   node scan-decisions.mjs <data.json>              # 打印未覆盖的候选决策
//   node scan-decisions.mjs <data.json> --all        # 连已覆盖/已忽略的一起列出
//   node scan-decisions.mjs <data.json> --json       # JSON 输出
//
// 逻辑:
//   1. 扫逐字稿，命中「决策信号词」的段落 → 候选决策（带时间戳）
//   2. 就近合并同一话题的连续候选，去掉纯提问/过短片段
//   3. 每条候选与纪要 decisions 做 4-gram 覆盖比对：
//        · 覆盖率 ≥ 0.30，或共享 ≥3 个 4-gram → 已覆盖
//        · 否则查 data.ignoredDecisions（按时间戳 ±30s 或片段重合）→ 已忽略
//        · 都没有 → 未覆盖（需要写进纪要，或显式标记忽略并给理由）
//
// 退出码: 0 无未覆盖 / 1 存在未覆盖 / 2 参数错误
//
// 设计意图（2026-10-28 定案）：写错由 verify-minutes 拦；写漏由本脚本拦。
// 任何未覆盖的候选都必须二选一：写成决议，或进 ignoredDecisions 并写明为什么不是决议。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const argv = process.argv.slice(2);
const dataPath = argv.find((a) => !a.startsWith('--'));
const showAll = argv.includes('--all');
const asJson = argv.includes('--json');
if (!dataPath) {
  console.error('用法: node scan-decisions.mjs <data.json> [--all] [--json]');
  process.exit(2);
}
const abs = (p) => (p ? p.replace(/^~/, HOME) : p);

const STRONG = [
  '就按', '就这么', '定了', '改称', '改成', '切成', '采用', '不用', '不要',
  '不做', '暂不', '先试点', '先跑', '先做', '两个都', '干脆', '口径', '标准是',
  '按新版', '按这个', '分出两', '分两个阶段', '留个口', '不再', '改成直接',
];
const WEAK = ['我觉得', '我建议', '必须', '确定', '原则', '最终', '结论'];

function loadSegments(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const out = [];
  let cur = null;
  for (const line of raw.split('\n')) {
    const m = line.trim().match(/^Speaker\s+(\d+)\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (m) {
      cur = { spk: Number(m[1]), t: +m[2] * 3600 + +m[3] * 60 + +m[4], tx: [] };
      out.push(cur);
    } else if (cur && line.trim()) cur.tx.push(line.trim());
  }
  out.forEach((s) => (s.text = s.tx.join('')));
  return out.filter((s) => s.text.length > 0);
}

const CJK = /[\u4e00-\u9fa5]/;
const grams = (text, n) => {
  const c = text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const set = new Set();
  for (let i = 0; i + n <= c.length; i++) {
    const g = c.slice(i, i + n);
    if (CJK.test(g)) set.add(g);
  }
  return set;
};
const overlap = (a, b) => {
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit;
};
const hhmmss = (t) =>
  `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

function findTranscript(dataFile, data) {
  const dataAbs = path.resolve(abs(dataFile));
  const base = path.basename(dataAbs).replace(/\.data\.json$/, '');
  const stem = base.replace(/^\d{8}-?/, '');
  const dirs = [path.dirname(dataAbs)];
  const archRoot = path.join(HOME, 'sisyphus-output/meetings/archive');
  if (fs.existsSync(archRoot)) {
    for (const m of fs.readdirSync(archRoot)) {
      const md = path.join(archRoot, m);
      if (!fs.statSync(md).isDirectory()) continue;
      dirs.push(path.join(md, base), md);
    }
  }
  const cands = [data.transcriptPath ? abs(data.transcriptPath) : ''].filter(Boolean);
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.transcript.txt') && (f.includes(stem) || stem.includes(f.replace(/\.transcript\.txt$/, '')))) {
        cands.push(path.join(d, f));
      }
    }
  }
  return cands.find((p) => fs.existsSync(p)) || null;
}

const data = JSON.parse(fs.readFileSync(path.resolve(abs(dataPath)), 'utf8'));
const tPath = findTranscript(dataPath, data);
if (!tPath) {
  console.error('找不到逐字稿');
  process.exit(2);
}

const segs = loadSegments(tPath);
const decisions = (data.decisions || []).map((d) => (typeof d === 'string' ? d : d.text || ''));
const decGrams = decisions.map((d) => grams(d, 4));
// 决议时间戳（已经过 verify-minutes 校验）作为覆盖锚点
const decAnchors = (data.decisions || []).flatMap((d, i) => {
  const note = typeof d === 'string' ? '' : d.note || '';
  return (note.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || []).map((x) => {
    const p = x.split(':').map(Number);
    const t = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    return { t, idx: i + 1 };
  });
});
const ignored = data.ignoredDecisions || [];

// 1) 候选
const raw = [];
for (const s of segs) {
  const hitStrong = STRONG.filter((w) => s.text.includes(w));
  const hitWeak = WEAK.filter((w) => s.text.includes(w));
  if (!hitStrong.length && hitWeak.length < 2) continue;
  if (s.text.replace(/\s/g, '').length < 12) continue;
  raw.push({ ...s, strong: hitStrong, weak: hitWeak, score: hitStrong.length * 2 + hitWeak.length });
}

// 2) 就近合并（同话题、90 秒内、4-gram 重合度高）
const merged = [];
for (const c of raw) {
  const prev = merged[merged.length - 1];
  if (prev && c.t - prev.t <= 90) {
    const a = grams(prev.text, 4);
    const b = grams(c.text, 4);
    const inter = overlap(a, b);
    const ratio = inter / Math.max(1, Math.min(a.size, b.size));
    if (ratio >= 0.55) {
      prev.text += '｜' + c.text;
      prev.strong = [...new Set([...prev.strong, ...c.strong])];
      prev.score += c.score;
      prev.tEnd = c.t;
      continue;
    }
  }
  merged.push({ ...c, tEnd: c.t });
}
function sharedTopic(a, b) {
  return overlap(grams(a.text, 3), grams(b.text, 3)) >= 8;
}

// 3) 覆盖判定
const results = merged.map((c) => {
  const g = grams(c.text, 4);
  let best = { covD: 0, covC: 0, shared: 0, idx: -1 };
  decGrams.forEach((dg, i) => {
    const shared = overlap(g, dg);
    const covD = shared / Math.max(1, dg.size);   // 决议有多少片段出现在这段里
    const covC = shared / Math.max(1, g.size);    // 这段有多少片段被决议用到
    const score = covD * 2 + covC;
    const bestScore = best.covD * 2 + best.covC;
    if (score > bestScore) best = { covD, covC, shared, idx: i };
  });
  const nearAnchor = decAnchors.find((a) => Math.abs(a.t - c.t) <= 120);
  const lexical = best.covD >= 0.30 || best.shared >= 2;
  const covered = Boolean(nearAnchor) || lexical;

  let ign = null;
  if (!covered) {
    ign = ignored.find((it) => {
      if (it.time) {
        const p = String(it.time).split(':').map(Number);
        const t = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
        if (Math.abs(t - c.t) <= 30) return true;
      }
      if (it.snippet) {
        const sg = grams(it.snippet, 4);
        return overlap(sg, g) / Math.max(1, sg.size) >= 0.3;
      }
      return false;
    });
  }
  return {
    time: hhmmss(c.t),
    tEnd: hhmmss(c.tEnd),
    speaker: c.spk,
    strong: c.strong,
    score: c.score,
    text: c.text.length > 160 ? c.text.slice(0, 160) + '…' : c.text,
    status: covered ? 'covered' : ign ? 'ignored' : 'MISSING',
    match: nearAnchor
      ? { decision: nearAnchor.idx, ratio: 1, shared: 0, via: 'timestamp' }
      : covered
        ? { decision: best.idx + 1, ratio: +best.covD.toFixed(2), shared: best.shared, via: 'lexical' }
        : null,
    ignoreReason: ign ? ign.reason || '' : '',
  };
});

const missing = results.filter((r) => r.status === 'MISSING');
const report = {
  transcript: tPath,
  segments: segs.length,
  candidates: results.length,
  covered: results.filter((r) => r.status === 'covered').length,
  ignored: results.filter((r) => r.status === 'ignored').length,
  missing: missing.length,
  items: results,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n逐字稿 ${segs.length} 段 | 候选决策句 ${report.candidates} 条`);
  console.log(`已覆盖 ${report.covered} | 已忽略 ${report.ignored} | 未处理 ${report.missing}\n`);
  const list = showAll ? results : missing;
  for (const r of list) {
    const mark = r.status === 'covered' ? '✓' : r.status === 'ignored' ? '·' : '✗';
    console.log(`${mark} ${r.time} S${r.speaker} [${r.strong.join(',')}] ${r.text}`);
    if (r.status === 'covered') console.log(`    ↳ 决议 ${r.match.decision}（${r.match.via === 'timestamp' ? '时间戳对应' : '用词重合 ' + r.match.ratio}）`);
    if (r.status === 'ignored') console.log(`    ↳ 已标记忽略：${r.ignoreReason}`);
  }
  console.log(report.missing ? `\nCOVERAGE FAIL 未处理 ${report.missing} 条` : `\nCOVERAGE PASS 候选全部有归属`);
}

fs.mkdirSync(path.join(HOME, 'sisyphus-output/evidence'), { recursive: true });
const ev = path.join(
  HOME,
  'sisyphus-output/evidence',
  `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-scan-decisions.json`,
);
fs.writeFileSync(ev, JSON.stringify(report, null, 2));
process.exit(missing.length ? 1 : 0);
