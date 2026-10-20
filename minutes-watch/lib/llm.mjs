// 结构化 LLM 调用：把逐字稿/说话人分离结果压成结构化纪要 JSON
// 走 OpenAI 兼容 /v1/chat/completions，凭证从 ~/.openclaw/openclaw.json 读（不改主配置）
import fs from 'node:fs';
import { OPENCLAW_CONFIG, readJson } from './config.mjs';

const DEFAULT_PROVIDER = 'aistarfish';
const DEFAULT_MODEL = 'deepseek-v4.1-flash-1017';

export function resolveModel(name) {
  const oc = readJson(OPENCLAW_CONFIG, {}) || {};
  const providers = oc?.models?.providers || {};
  const spec = name || `${DEFAULT_PROVIDER}/${DEFAULT_MODEL}`;
  const [pid, ...rest] = spec.split('/');
  const mid = rest.join('/');
  const p = providers[pid];
  if (!p) throw new Error(`provider 不存在: ${pid}`);
  const model = (p.models || []).find((m) => m.id === mid);
  if (!model) throw new Error(`模型不存在: ${pid}/${mid}`);
  return {
    baseUrl: (p.baseUrl || '').replace(/\/+$/, ''),
    apiKey: p.apiKey,
    model: model.id,
    maxTokens: Math.min(model.maxTokens || 8192, 16384),
    contextWindow: model.contextWindow || 131072,
  };
}

export async function chat({ system, user, model, temperature = 0.2, maxRetries = 2 }) {
  const m = resolveModel(model);
  const url = `${m.baseUrl}/chat/completions`;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${m.apiKey}` },
        body: JSON.stringify({
          model: m.model,
          temperature,
          max_tokens: m.maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(180000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
      const json = JSON.parse(text);
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error(`空响应: ${text.slice(0, 300)}`);
      return {
        content,
        usage: json.usage || {},
        model: m.model,
        provider: m.baseUrl,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`LLM 调用失败(${m.model}): ${lastErr?.message || lastErr}`);
}

/** 从模型输出里抠出第一个完整 JSON 对象（容忍 ```json 包裹与前后废话） */
export function extractJson(text) {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : s;
  const start = body.indexOf('{');
  if (start < 0) throw new Error('模型输出不含 JSON');
  let depth = 0, inStr = false, escp = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (escp) escp = false;
      else if (c === '\\') escp = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error('JSON 不完整');
}

/** 按段落切逐字稿，保证单次输入不超预算；返回 [{startSec, text}] */
export function chunkSegments(segments, maxChars = 24000) {
  const chunks = [];
  let cur = [], len = 0, start = null;
  for (const s of segments) {
    const line = `[${fmtTs(s.start)}] ${s.speaker || s.speaker_zh || 'S?'}: ${s.text}`;
    if (len + line.length > maxChars && cur.length) {
      chunks.push({ startSec: start, lines: cur });
      cur = []; len = 0; start = null;
    }
    if (start === null) start = s.start;
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) chunks.push({ startSec: start, lines: cur });
  return chunks;
}

export function fmtTs(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
