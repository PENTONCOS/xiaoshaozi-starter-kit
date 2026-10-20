// 结构化：逐字稿 → 结构化纪要 JSON（分块抽取 + 合并）
import fs from 'node:fs';
import path from 'node:path';
import { chat, extractJson, chunkSegments, fmtTs } from './llm.mjs';

export const SCHEMA_HINT = `{
  "title": "会议主题（不超过30字）",
  "tldr": ["一句话结论1", "一句话结论2（最多3条，每条≤60字）"],
  "keywords": ["关键词，最多8个"],
  "decisions": [{"text":"已达成的明确决议","owner":"负责方或空字符串","note":"补充或空字符串"}],
  "actions": [{"action":"具体要做的事","owner":"负责人，听不出来就写空字符串","due":"时间约定，没有就写空字符串"}],
  "topics": [{"title":"议题名","points":["该议题下的关键论点、数据、结论，每条≤80字"]}],
  "risks": ["风险、未决问题、遗留卡点"],
  "audioQuality": "clear | noisy | partial（对转录质量的判断）"
}`;

const SYSTEM = `你是会议纪要结构化引擎。任务：从一份会议逐字稿中抽取结构化信息。

铁律：
1. 只输出 JSON，不要任何解释、不要 Markdown 代码块之外的文字。
2. 只写逐字稿里真实出现过的内容。**严禁推测、补全、编造**任何人名、数字、日期、承诺。
3. 听不出负责人就留空字符串，不要写"待定""TBD"之类填充词。
4. 说话人只有 S0/S1 这样的编号时，owner 字段写编号（如 "S3"），不要编造真人姓名。
5. 逐字稿是语音识别产物，可能有错别字（如专有名词识别错误）。遇到明显识别错误，按上下文纠正；不确定就保留原词。
6. 如果这一段没有决议/待办/风险，对应数组给空数组 []，不要硬凑。

JSON 结构：
${SCHEMA_HINT}`;

function segLines(segments) {
  return segments.map((s) => `[${fmtTs(s.start)}] ${s.speaker || 'S?'}: ${s.text}`);
}

/** 单块抽取 */
async function extractChunk(lines, idx, total, meta) {
  const user = [
    `会议标题：${meta.title || '(未知)'}`,
    meta.date ? `时间：${meta.date}` : '',
    meta.duration ? `时长：${meta.duration}` : '',
    `这是逐字稿的第 ${idx + 1}/${total} 段。只抽取本段内容。`,
    '',
    '--- 逐字稿 ---',
    ...lines,
  ].filter(Boolean).join('\n');

  const r = await chat({ system: SYSTEM, user, model: meta.model, temperature: 0.1 });
  const j = extractJson(r.content);
  return { json: j, usage: r.usage };
}

/** 合并多块结果 */
function mergeParts(parts, meta) {
  const uniq = (arr, key) => {
    const seen = new Set(), out = [];
    for (const x of arr) {
      const k = String(key(x)).replace(/\s+/g, '').slice(0, 40);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  };
  const decisions = uniq(parts.flatMap((p) => p.decisions || []), (d) => (typeof d === 'string' ? d : d.text));
  const actions = uniq(parts.flatMap((p) => p.actions || []), (a) => a.action);
  const risks = uniq(parts.flatMap((p) => p.risks || []), (r) => r);
  const keywords = uniq(parts.flatMap((p) => p.keywords || []), (k) => k).slice(0, 10);
  const topics = uniq(parts.flatMap((p) => p.topics || []), (t) => t.title);
  const tldr = parts.find((p) => p.tldr?.length)?.tldr?.slice(0, 3) || [];
  const title = parts.map((p) => p.title).filter(Boolean).sort((a, b) => b.length - a.length)[0] || meta.title || '会议纪要';
  return { title, tldr, keywords, decisions, actions, topics, risks };
}

/** 主入口：segments → data.json 内容 */
export async function structureMinutes({ segments, meta = {}, onProgress }) {
  const lines = segLines(segments);
  const chunks = chunkSegments(segments, 24000);
  const parts = [];
  let tokens = { prompt: 0, completion: 0 };
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`  分块 ${i + 1}/${chunks.length}（${chunks[i].lines.length} 行，${chunks[i].lines.join('\n').length} 字）→ LLM`);
    const { json, usage } = await extractChunk(chunks[i].lines, i, chunks.length, meta);
    tokens.prompt += usage.prompt_tokens || 0;
    tokens.completion += usage.completion_tokens || 0;
    parts.push(json);
    if (chunks.length > 1) await new Promise((r) => setTimeout(r, 400));
  }

  const merged = chunks.length === 1 ? { ...parts[0] } : mergeParts(parts, meta);
  return {
    ...merged,
    title: meta.title || merged.title,
    date: meta.date || '',
    duration: meta.duration || '',
    attendees: meta.attendees || [],
    sourceUrl: meta.sourceUrl || '',
    minuteToken: meta.minuteToken || '',
    transcriptPath: meta.transcriptPath || '',
    artifactsPath: meta.artifactsPath || '',
    caveat: '本纪要由 LLM 依据逐字稿自动结构化，未经人工校对；负责人、时间若有出入以现场为准。',
    _stats: { chunks: chunks.length, chars: lines.join('\n').length, tokens, model: meta.model },
  };
}

/** 从 .speakers.txt 解析出 segments（[mm:ss] S0: text 或 [h:mm:ss] Speaker 1: text） */
export function parseSpeakersTxt(txt) {
  const segs = [];
  for (const line of String(txt || '').split('\n')) {
    // [mm:ss] 或 [h:mm:ss]，后接「说话人标签:」
    const m = line.match(/^\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]\s*([^:：]{1,24})[:：]\s*(.*)$/);
    if (!m) continue;
    const h = m[1] ? +m[1] : 0;
    const start = h * 3600 + +m[2] * 60 + +m[3];
    const speaker = m[4].trim();
    const text = m[5].trim();
    if (text) segs.push({ start, speaker, text });
  }
  return segs;
}

export function readSegments(dir, base) {
  for (const [name, fn] of [
    [`${base}.transcript.aligned.json`, (j) => j.segments?.map((s) => ({ start: s.start, speaker: s.speaker, text: s.text }))],
    [`${base}.transcript.json`, (j) => j.segments?.map((s) => ({ start: s.start, speaker: s.speaker || s.speaker_zh, text: s.text }))],
  ]) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const segs = (fn(JSON.parse(fs.readFileSync(p, 'utf8'))) || []).filter((s) => s.text);
      if (segs.length) return { segments: segs, from: name };
    } catch { /* 试下一个 */ }
  }
  const sp = path.join(dir, `${base}.speakers.txt`);
  if (fs.existsSync(sp)) {
    const segs = parseSpeakersTxt(fs.readFileSync(sp, 'utf8'));
    if (segs.length) return { segments: segs, from: `${base}.speakers.txt` };
  }
  throw new Error(`找不到可用逐字稿（${base}.transcript.aligned.json / .transcript.json / .speakers.txt）`);
}
