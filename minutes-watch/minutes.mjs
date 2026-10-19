// minutes.mjs —— 会议纪要流水线「第一步」统一入口（纯机械步骤，零 LLM）
//
// 用法:
//   node minutes.mjs <妙记链接|音频路径> [--slug <名>] [--dir <目录>] [--speakers N]
//   node minutes.mjs link <妙记链接> [...]
//   node minutes.mjs audio <音频路径> [...]
//
// 做三件事：
//   1. 拿逐字稿   妙记链接 → artifacts API；音频 → 本地 faster-whisper
//   2. 说话人分离 妙记 → 自带 Speaker 标签；音频 → sherpa-onnx 声纹聚类
//   3. 把产物落到工作目录，打印 digest 供下一步（LLM 结构化）使用
//
// 之后：写 <base>.data.json → node render-minutes.mjs <base>.data.json --send <chat_id>
//       （render 会在推送成功后自动归档并重建 INDEX.md）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, HOME, sendApp, readJson } from './lib/config.mjs';
import { tenantToken, http } from './lib/feishu.mjs';

const OUT_ROOT = path.join(HOME, 'sisyphus-output', 'meetings');
const ASR = path.join(HOME, '.openclaw/agents/main/agent/workshop-skills/meeting-audio-transcription/scripts/transcribe.py');
const ASR_PY = path.join(HOME, '.local/venvs/asr/bin/python');

const argv = process.argv.slice(2);
if (!argv.length) {
  console.error('用法: node minutes.mjs <妙记链接|音频路径> [--slug <名>] [--dir <目录>] [--speakers N]');
  process.exit(1);
}

function takeOpt(name, def = null) {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
const slugOpt = takeOpt('--slug');
const dirOpt = takeOpt('--dir');
const speakersOpt = takeOpt('--speakers');

let mode = null;
let input = null;
if (argv[0] === 'link' || argv[0] === 'audio') {
  mode = argv[0];
  input = argv[1];
} else {
  input = argv[0];
  mode = /^https?:\/\//.test(input || '') || /^[A-Za-z0-9]{20,32}$/.test(input || '') ? 'link' : 'audio';
}
if (!input) {
  console.error('缺少输入：妙记链接或音频路径');
  process.exit(1);
}
input = input.replace(/^~/, HOME);

const today = new Date();
const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

function slugify(s) {
  return (s || 'meeting')
    .replace(/\.(m4a|mp3|wav|aac|mp4|mov)$/i, '')
    .split('---')[0]                       // 丢掉上传 UUID
    .replace(/[\s_/\\]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'meeting';
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

// ------------------------------------------------------------------ 妙记
async function fromLink(url) {
  const mt = url.match(/minutes\/([A-Za-z0-9]{20,32})/);
  const token = mt ? mt[1] : url.trim();
  const app = sendApp();
  const t = await tenantToken(app);
  const { status, json } = await http('GET', `/minutes/v1/minutes/${token}/artifacts`, { token: t });
  if (json.code !== 0) {
    throw new Error(`artifacts 拉取失败: HTTP ${status} code ${json.code} ${json.msg}`);
  }
  const d = json.data || {};
  const title = (d.title || '').trim();
  const base = `${ymd}-${slugOpt || slugify(title)}`;
  const dir = dirOpt ? dirOpt.replace(/^~/, HOME) : OUT_ROOT;
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, `${base}.artifacts.json`), JSON.stringify(json, null, 2), 'utf8');

  const txt = d.transcript || '';
  fs.writeFileSync(path.join(dir, `${base}.transcript.txt`), txt, 'utf8');

  // 从妙记 transcript 抽 [speaker, start, text] → transcript.json（与音频路线同构）
  const segs = [];
  for (const block of txt.split(/\n(?=Speaker\s+\d+\s+\d)/)) {
    const m = block.match(/^Speaker\s+(\d+)\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m || !block.includes('\n')) continue;
    const body = block.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
    if (!body) continue;
    segs.push({
      start: +m[2] * 3600 + +m[3] * 60 + +m[4],
      speaker_zh: `Speaker ${m[1]}`,
      text: body,
    });
  }
  fs.writeFileSync(
    path.join(dir, `${base}.transcript.json`),
    JSON.stringify({ source: 'minutes', minute_token: token, title, segments: segs }, null, 2),
    'utf8'
  );

  // 说话人分离：直接用妙记自带标签
  sh(path.join(ROOT, 'diarize.sh'), [
    '--from-artifacts', path.join(dir, `${base}.artifacts.json`), '--dir', dir, '--base', base,
  ]);

  return {
    mode: 'link', base, dir,
    title, token,
    duration: d.duration ? Math.round(d.duration / 1000) : null,
    segments: segs.length,
    speakers: [...new Set(segs.map((s) => s.speaker_zh))].length,
    files: {
      artifacts: `${base}.artifacts.json`,
      transcript_txt: `${base}.transcript.txt`,
      transcript_json: `${base}.transcript.json`,
      speakers_txt: `${base}.speakers.txt`,
      data_json: `${base}.data.json（待生成）`,
    },
  };
}

// ------------------------------------------------------------------ 音频
function fromAudio(file) {
  if (!fs.existsSync(file)) throw new Error(`音频不存在: ${file}`);
  const base = `${ymd}-${slugOpt || slugify(path.basename(file))}`;
  const dir = dirOpt ? dirOpt.replace(/^~/, HOME) : OUT_ROOT;
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(ASR_PY)) throw new Error(`缺少 ASR 环境: ${ASR_PY}`);
  sh(ASR_PY, [ASR, file, '--out-txt', path.join(dir, `${base}.transcript.txt`), '--out-json', path.join(dir, `${base}.transcript.json`)], {
    stdio: 'inherit',
  });

  // 说话人分离（自动定人数；--speakers N 可指定）
  const dargs = [file, '--dir', dir, '--base', base];
  if (speakersOpt) dargs.push('--speakers', String(speakersOpt));
  sh(path.join(ROOT, 'diarize.sh'), dargs, { stdio: 'inherit' });

  const tj = readJson(path.join(dir, `${base}.transcript.json`), {});
  return {
    mode: 'audio', base, dir,
    duration: tj.duration ? Math.round(tj.duration) : null,
    segments: (tj.segments || []).length,
    files: {
      transcript_txt: `${base}.transcript.txt`,
      transcript_json: `${base}.transcript.json`,
      speakers_txt: `${base}.speakers.txt`,
      diar_json: `${base}.diar.json`,
      aligned_json: `${base}.transcript.aligned.json`,
      data_json: `${base}.data.json（待生成）`,
    },
  };
}

const out = mode === 'link' ? await fromLink(input) : fromAudio(input);
console.log('\n===== minutes.mjs digest =====');
console.log(JSON.stringify(out, null, 2));
console.log(`\n下一步: 读 ${out.dir}/${out.base}.speakers.txt 写 ${out.base}.data.json，`);
console.log(`再 node render-minutes.mjs ${out.base}.data.json --send <chat_id>（自动归档）`);
