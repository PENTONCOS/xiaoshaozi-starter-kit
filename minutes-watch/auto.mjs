#!/usr/bin/env node
// auto.mjs —— 一条命令跑完全链路：链接/音频 → 转录 → 分离 → LLM 结构化 → 卡片 → 推送 → 归档
//
// 用法:
//   node auto.mjs <妙记链接|音频路径> [--slug 名] [--speakers N] [--dry] [--chat <chat_id>] [--model provider/model]
//
// 设计约束：
// - 推送目标默认取 config.json 的 target.chatId（会议纪要群），--chat 可覆盖
// - --dry 不推送、不归档，产物留在 meetings/ 下供检查
// - 任一步失败都以非零退出并打印原因；不会静默失败
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, HOME, target, log } from './lib/config.mjs';
import { structureMinutes, readSegments } from './lib/structure.mjs';

const argv = process.argv.slice(2);
const take = (name, def = null) => {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const slug = take('--slug');
const speakers = take('--speakers');
const chatOverride = take('--chat');
const model = take('--model');
const dry = argv.includes('--dry');
const input = argv.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('用法: node auto.mjs <妙记链接|音频路径> [--slug 名] [--speakers N] [--dry] [--model provider/model]');
  process.exit(1);
}

const VOICE_PY = path.join(HOME, '.local/venvs/diar/bin/python');
const t0 = Date.now();
const stage = (s) => log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

// ---------------------------------------------------------------- 1. 转录 + 分离
stage(`第一步：${/^https?:|^[A-Za-z0-9]{20,32}$/.test(input) ? '拉妙记产物' : '本地转录 + 说话人分离'}`);
const args = [path.join(ROOT, 'minutes.mjs'), input];
if (slug) args.push('--slug', slug);
if (speakers) args.push('--speakers', String(speakers));
const raw = execFileSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
const digest = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
const { base, dir } = digest;
stage(`产物就绪: ${dir}/${base}（${digest.segments} 段 / ${digest.speakers ?? '?'} 人）`);

// ---------------------------------------------------------------- 2. LLM 结构化
const { segments, from } = readSegments(dir, base);

// 声纹识别：音频路线才有 diar.json，用声纹库把 S0/S1 换成真名
let speakersNamed = [];
if (digest.mode === 'audio') {
  try {
    const diarPath = path.join(dir, `${base}.diar.json`);
    if (fs.existsSync(diarPath)) {
      const out = execFileSync(VOICE_PY, [path.join(ROOT, 'voiceprint.py'), 'identify', input, '--diar', diarPath], { encoding: 'utf8' });
      const map = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
      const nameOf = {};
      for (const [label, info] of Object.entries(map)) {
        if (info.name) nameOf[label] = info.name;
        stage(`  声纹 ${label} → ${info.name || '未识别'}（${info.score ?? '-'}）`);
      }
      for (const s of segments) if (nameOf[s.speaker]) s.speaker = nameOf[s.speaker];
      speakersNamed = Object.values(nameOf);
      if (Object.keys(nameOf).length) {
        fs.writeFileSync(path.join(dir, `${base}.speakers.named.txt`),
          `# 声纹识别后逐字稿\n\n` + segments.map((s) => {
            const m = Math.floor(s.start / 60), sec = Math.round(s.start % 60);
            return `[${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}] ${s.speaker}: ${s.text}`;
          }).join('\n') + '\n', 'utf8');
      }
    }
  } catch (e) {
    stage(`  声纹识别跳过：${e.message.slice(0, 120)}`);
  }
}
stage(`第二步：结构化 ${segments.length} 段（来源 ${from}，模型 ${model || '默认'}）`);
const data = await structureMinutes({
  segments,
  meta: {
    title: digest.title || '',
    date: base.slice(0, 4) + '-' + base.slice(4, 6) + '-' + base.slice(6, 8),
    duration: digest.duration ? `${Math.round(digest.duration / 60)} 分钟` : '',
    sourceUrl: digest.token ? `https://meetings.feishu.cn/minutes/${digest.token}` : '',
    minuteToken: digest.token || '',
    transcriptPath: `${base}.transcript.txt`,
    artifactsPath: digest.mode === 'link' ? `${base}.artifacts.json` : '',
    model,
    attendees: speakersNamed,
  },
  onProgress: (m) => stage(m),
});

const dataPath = path.join(dir, `${base}.data.json`);
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
stage(`结构化完成: 决议 ${data.decisions?.length || 0} / 待办 ${data.actions?.length || 0} / 议题 ${data.topics?.length || 0} / 风险 ${data.risks?.length || 0}`);
if (data._stats?.tokens) {
  stage(`token: prompt ${data._stats.tokens.prompt} + completion ${data._stats.tokens.completion}`);
}

// ---------------------------------------------------------------- 3. 渲染 + 推送 + 归档
if (dry) {
  console.log('\n[dry] 跳过推送与归档');
  console.log(JSON.stringify({ base, dir, dataPath, title: data.title }, null, 2));
  process.exit(0);
}

const chatId = chatOverride || target().chatId;
stage(`第三步：渲染卡片并推送到 ${chatId}`);
const rargs = [path.join(ROOT, 'render-minutes.mjs'), dataPath, '--send', chatId];
const out = execFileSync(process.execPath, rargs, { encoding: 'utf8', cwd: ROOT });
process.stdout.write(out);
stage('完成');
