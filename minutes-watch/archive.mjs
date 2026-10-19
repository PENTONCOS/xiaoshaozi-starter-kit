// 会议纪要归档：把一次会议的产物收进 archive/YYYY-MM/<YYYYMMDD>-<slug>/，并维护 INDEX.md
// 用法:
//   node archive.mjs <slug>                 # 归档 meetings/ 下所有 <slug>.* 产物
//   node archive.mjs --all                  # 归档 meetings/ 下全部会议
//   node archive.mjs --index                # 只重建 INDEX.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MEETINGS = path.join(os.homedir(), 'sisyphus-output', 'meetings');
const ARCHIVE = path.join(MEETINGS, 'archive');

// 哪些后缀算「一次会议的产物」
const KEEP = [
  '.data.md',        // 结构化纪要（Markdown 存档，主文件）
  '.minutes.md',     // 早期手写纪要
  '.data.json',      // 结构化数据源
  '.data.card.json', // 飞书卡片快照
  '.artifacts.json', // 妙记原始 AI 产物
  '.transcript.txt',
  '.transcript.json',
  '.transcript.aligned.json', // 逐字稿 + 每段说话人
  '.speakers.txt',   // 说话人分离逐字稿
  '.diar.json',      // 说话人分离原始结果
];

function listMeetings() {
  if (!fs.existsSync(MEETINGS)) return [];
  return fs
    .readdirSync(MEETINGS)
    .filter((f) => !f.startsWith('.') && f !== 'archive')
    .map((f) => ({ f, full: path.join(MEETINGS, f) }))
    .filter((x) => fs.statSync(x.full).isFile());
}

/** 从文件名拆出 <YYYYMMDD>-<slug>，忽略后缀 */
function splitName(file) {
  const m = file.match(/^(\d{8})-(.+?)(\.[a-z].*)$/i);
  if (!m) return null;
  return { date: m[1], slug: `${m[1]}-${m[2]}`, ext: m[3], base: `${m[1]}-${m[2]}` };
}

function groups() {
  const map = new Map();
  for (const { f } of listMeetings()) {
    const p = splitName(f);
    if (!p) continue;
    if (!KEEP.some((e) => f.endsWith(e))) continue;
    if (!map.has(p.base)) map.set(p.base, { date: p.date, files: [] });
    map.get(p.base).files.push(f);
  }
  return map;
}

function titleOf(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.data.md') && !name.endsWith('.minutes.md')) continue;
    const head = fs.readFileSync(path.join(dir, name), 'utf8').split('\n')[0] || '';
    const t = head.replace(/^#\s*/, '').replace(/^会议纪要\s*·\s*/, '').trim();
    if (t) return t;
  }
  return '';
}

function archiveOne(base) {
  const g = groups().get(base);
  if (!g) {
    console.error(`未找到 ${base} 的产物`);
    return null;
  }
  const ym = `${g.date.slice(0, 4)}-${g.date.slice(4, 6)}`;
  const dest = path.join(ARCHIVE, ym, base);
  fs.mkdirSync(dest, { recursive: true });

  const moved = [];
  for (const f of g.files) {
    const target = path.join(dest, f);
    if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(path.join(MEETINGS, f)).size) {
      // 已归档且大小一致：删掉工作副本，保持 meetings/ 干净
      fs.unlinkSync(path.join(MEETINGS, f));
      moved.push(`${f} (已存在，清理工作副本)`);
      continue;
    }
    fs.copyFileSync(path.join(MEETINGS, f), target);
    fs.unlinkSync(path.join(MEETINGS, f));
    moved.push(f);
  }

  const title = titleOf(dest);
  const meta = {
    base,
    date: `${g.date.slice(0, 4)}-${g.date.slice(4, 6)}-${g.date.slice(6, 8)}`,
    title,
    archivedAt: new Date().toISOString(),
    files: fs.readdirSync(dest),
  };
  fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  console.log(`archived ${base} -> ${path.relative(os.homedir(), dest)}  (${moved.length} files)`);
  return meta;
}

function buildIndex() {
  const rows = [];
  if (fs.existsSync(ARCHIVE)) {
    for (const ym of fs.readdirSync(ARCHIVE).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort().reverse()) {
      const ymDir = path.join(ARCHIVE, ym);
      for (const base of fs.readdirSync(ymDir).sort().reverse()) {
        const dir = path.join(ymDir, base);
        if (!fs.statSync(dir).isDirectory()) continue;
        const metaPath = path.join(dir, 'meta.json');
        let meta = {};
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch {
          /* 缺 meta 也要能进索引 */
        }
        const files = fs.readdirSync(dir);
        const pick = (suffix) => files.find((f) => f.endsWith(suffix)) || '';
        rows.push({
          date: meta.date || `${base.slice(0, 4)}-${base.slice(4, 6)}-${base.slice(6, 8)}`,
          title: meta.title || titleOf(dir) || base,
          rel: path.join(ym, base),
          md: pick('.data.md') || pick('.minutes.md'),
          transcript: !!pick('.transcript.txt'),
        });
      }
    }
  }

  const out = ['# 会议纪要归档索引', '', `共 ${rows.length} 场会议。按日期倒序。`, ''];
  if (!rows.length) {
    out.push('_暂无归档。_');
  } else {
    out.push('| 日期 | 主题 | 纪要 | 逐字稿 | 归档目录 |');
    out.push('|---|---|---|---|---|');
    for (const r of rows) {
      const md = r.md ? `[${r.md}](${r.rel}/${r.md})` : '—';
      out.push(`| ${r.date} | ${r.title} | ${md} | ${r.transcript ? '✓' : '—'} | \`${r.rel}/\` |`);
    }
  }
  out.push('');
  fs.mkdirSync(ARCHIVE, { recursive: true });
  const idx = path.join(ARCHIVE, 'INDEX.md');
  fs.writeFileSync(idx, out.join('\n'), 'utf8');
  console.log(`index: ${idx}  (${rows.length} meetings)`);
}

const args = process.argv.slice(2);
if (args.includes('--index')) {
  buildIndex();
} else if (args.includes('--all')) {
  const bases = [...groups().keys()];
  for (const b of bases) archiveOne(b);
  buildIndex();
} else {
  const base = args[0];
  if (!base) {
    console.error('用法: node archive.mjs <YYYYMMDD-slug> | --all | --index');
    process.exit(1);
  }
  archiveOne(base.replace(/\.(data\.md|minutes\.md|data\.json|transcript\.txt|transcript\.json)$/, ''));
  buildIndex();
}
