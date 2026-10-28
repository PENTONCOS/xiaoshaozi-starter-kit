// verify-minutes.mjs —— 纪要保真校验：每条决议必须能回到逐字稿的对应时间窗
//
// 用法:
//   node verify-minutes.mjs <data.json>            # 校验并打印报告（失败退出码 1）
//   node verify-minutes.mjs <data.json> --json     # 只输出 JSON
//   node verify-minutes.mjs <data.json> --quiet    # 只输出结论行
//
// 校验规则（源自 2026-10-28 「结论塌缩」事故）：
//   1. 每条决议必须带时间戳；没有 → 失败
//   2. 时间戳必须落在逐字稿里；超出范围 → 失败
//   3. 时间窗 [t-20s, t+150s] 内必须出现决议里的原话片段：
//        · 命中 4 字以上连续片段 → 通过
//        · 否则命中 ≥2 个不同的 3 字片段 → 通过
//        · 都不满足 → 失败（说明这句话在原文里找不到依据，或被压缩得对不上）
//   4. 待办必须有责任人与截止；缺项 → 警告（不阻断）
//
// 退出码: 0 通过 / 1 有失败项 / 2 参数或文件错误

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const dataPath = argv.find((a) => !a.startsWith('--'));
const asJson = argv.includes('--json');
const quiet = argv.includes('--quiet');

if (!dataPath) {
  console.error('用法: node verify-minutes.mjs <data.json> [--json] [--quiet]');
  process.exit(2);
}

const HOME = os.homedir();
const abs = (p) => (p ? p.replace(/^~/, HOME) : p);

function loadTranscript(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const re = /^Speaker\s+\d+\s+(\d{1,2}):(\d{2}):(\d{2})/;
  const segs = [];
  let cur = null;
  for (const line of lines) {
    const m = line.trim().match(re);
    if (m) {
      cur = { t: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), lines: [] };
      segs.push(cur);
    } else if (cur && line.trim() && !/^\d{4}-\d{2}-\d{2}/.test(line)) {
      cur.lines.push(line.trim());
    }
  }
  for (const s of segs) s.text = s.lines.join('');
  return segs;
}

const parseStamp = (s) => {
  const p = s.split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return null;
};

const CJK = /[\u4e00-\u9fa5]/;
function grabNgrams(text, n) {
  const clean = text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const out = [];
  for (let i = 0; i + n <= clean.length; i++) {
    const g = clean.slice(i, i + n);
    if (CJK.test(g)) out.push(g);
  }
  return out;
}

function checkDecision(d, segs, idx) {
  const text = typeof d === 'string' ? d : d.text || '';
  const note = typeof d === 'string' ? '' : d.note || '';
  const stamps = (note.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || []).map(parseStamp).filter((x) => x !== null);
  const res = { idx: idx + 1, text, note, stamps: stamps.map((s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`), ok: false, reason: '', hit: '' };

  if (!/^\d+$/.test(String(idx + 1)) || !text) { res.reason = '决议为空'; return res; }
  if (!stamps.length) { res.reason = '缺少时间戳'; return res; }
  if (!segs.length) { res.reason = '逐字稿为空或格式不认识'; return res; }

  const maxT = segs[segs.length - 1].t;
  const bad = stamps.filter((s) => s > maxT + 5);
  if (bad.length === stamps.length) { res.reason = `时间戳全部超出逐字稿（最长 ${Math.floor(maxT / 60)}:${String(maxT % 60).padStart(2, '0')}）`; return res; }

  for (const s of stamps.filter((x) => x <= maxT + 5)) {
    const window = segs.filter((g) => g.t >= s - 20 && g.t <= s + 150).map((g) => g.text).join('');
    if (!window) continue;
    const n4 = grabNgrams(text, 4).filter((g, i, a) => a.indexOf(g) === i);
    const hit4 = n4.find((g) => window.includes(g));
    if (hit4) { res.ok = true; res.hit = hit4; res.reason = `命中「${hit4}」`; return res; }
    const n3 = grabNgrams(text, 3).filter((g, i, a) => a.indexOf(g) === i);
    const hits3 = n3.filter((g) => window.includes(g));
    if (hits3.length >= 2) { res.ok = true; res.hit = hits3.slice(0, 3).join('/'); res.reason = `命中 3 字片段 ${hits3.length} 个（${hits3.slice(0, 3).join('、')}）`; return res; }
  }
  res.reason = '时间窗内找不到决议原话片段（可能在压缩中改写了措辞，或时间戳不准）';
  return res;
}

function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.resolve(abs(dataPath)), 'utf8'));
  } catch (e) {
    console.error('读 data.json 失败:', e.message);
    process.exit(2);
  }

  const dataAbs = path.resolve(abs(dataPath));
  const base = path.basename(dataAbs).replace(/\.data\.json$/, '');
  const stem = base.replace(/^\d{8}-?/, ''); // 去掉日期前缀，兼容「双日期前缀」写法
  const dirs = [path.dirname(dataAbs)];
  const archRoot = path.join(HOME, 'sisyphus-output/meetings/archive');
  if (fs.existsSync(archRoot)) {
    for (const m of fs.readdirSync(archRoot)) {
      const md = path.join(archRoot, m);
      if (!fs.statSync(md).isDirectory()) continue;
      dirs.push(path.join(md, base), md);
    }
  }

  const candidates = [
    data.transcriptPath ? abs(data.transcriptPath) : '',
    path.join(path.dirname(dataAbs), base + '.transcript.txt'),
  ].filter(Boolean);

  // 目录里匹配：文件名包含该会议的 token 且以 .transcript.txt 结尾（兼容 20261028-20261028-xxx 双前缀）
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.transcript.txt')) continue;
      if (f.includes(stem) || stem.includes(f.replace(/\.transcript\.txt$/, ''))) candidates.push(path.join(d, f));
    }
    for (const sub of fs.readdirSync(d)) {
      const sd = path.join(d, sub);
      if (!fs.statSync(sd).isDirectory()) continue;
      for (const f of fs.readdirSync(sd)) {
        if (f.endsWith('.transcript.txt') && f.includes(stem)) candidates.push(path.join(sd, f));
      }
    }
  }

  const tPath = candidates.find((p) => fs.existsSync(p));
  if (!tPath) {
    console.error('找不到逐字稿，试过:');
    for (const c of candidates) console.error('  -', c);
    process.exit(2);
  }

  const segs = loadTranscript(tPath);
  const decisions = (data.decisions || []).map((d, i) => checkDecision(d, segs, i));

  const actions = (data.actions || []).map((a, i) => {
    const warn = [];
    if (!a.owner) warn.push('缺责任人');
    if (!a.due) warn.push('缺截止');
    return { idx: i + 1, action: a.action || '', owner: a.owner || '', due: a.due || '', warn };
  });
  const actionWarns = actions.filter((a) => a.warn.length);

  const failed = decisions.filter((d) => !d.ok);
  const report = {
    data: path.resolve(abs(dataPath)),
    transcript: tPath,
    segments: segs.length,
    decisions: { total: decisions.length, passed: decisions.length - failed.length, failed: failed.length, items: decisions },
    actions: { total: actions.length, warned: actionWarns.length, items: actions },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!quiet) {
    console.log(`\n逐字稿: ${tPath}  (${segs.length} 段)`);
    console.log(`决议 ${report.decisions.passed}/${report.decisions.total} 通过\n`);
    for (const d of decisions) {
      const mark = d.ok ? '✓' : '✗';
      console.log(`${mark} ${String(d.idx).padStart(2)}. ${d.stamps.join(' ') || '(无时间戳)'}  ${d.text.slice(0, 40)}`);
      if (!d.ok) console.log(`      ↳ ${d.reason}`);
    }
    if (actionWarns.length) {
      console.log(`\n待办警告 ${actionWarns.length}/${actions.length}:`);
      for (const a of actionWarns) console.log(`  ! ${a.idx}. ${a.action.slice(0, 30)} → ${a.warn.join('、')}`);
    }
  }

  const verdict = failed.length ? `FAIL ${failed.length}/${decisions.length} 条决议无法回原文` : `PASS ${decisions.length}/${decisions.length} 条决议可回原文`;
  console.log(verdict);
  fs.mkdirSync(path.join(HOME, 'sisyphus-output/evidence'), { recursive: true });
  const ev = path.join(HOME, 'sisyphus-output/evidence', `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-verify-minutes.json`);
  fs.writeFileSync(ev, JSON.stringify(report, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main();
