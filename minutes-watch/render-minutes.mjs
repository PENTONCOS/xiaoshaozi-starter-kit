// 把「结构化纪要 JSON」渲染成 Markdown 存档 + 飞书卡片，并可推送
// 用法:
//   node render-minutes.mjs <data.json>                # 只生成 .md
//   node render-minutes.mjs <data.json> --card         # 同时生成 .card.json
//   node render-minutes.mjs <data.json> --send <chat_id>  # 生成并推送卡片
import fs from 'node:fs';
import path from 'node:path';
import { toMarkdown, toCard } from './lib/render.mjs';
import { sendApp } from './lib/config.mjs';
import { tenantToken, http } from './lib/feishu.mjs';

const [dataPath, ...rest] = process.argv.slice(2);
if (!dataPath) {
  console.error('用法: node render-minutes.mjs <data.json> [--card] [--send <chat_id>]');
  process.exit(1);
}
const doCard = rest.includes('--card') || rest.includes('--send');
const sendIdx = rest.indexOf('--send');
const chatId = sendIdx >= 0 ? rest[sendIdx + 1] : null;

const m = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const dir = path.dirname(path.resolve(dataPath));
const base = path.basename(dataPath).replace(/\.json$/, '');

const mdPath = path.join(dir, `${base}.md`);
fs.writeFileSync(mdPath, toMarkdown(m), 'utf8');
console.log('markdown:', mdPath, fs.statSync(mdPath).size, 'bytes');

if (!doCard) process.exit(0);

const card = toCard(m);
const cardPath = path.join(dir, `${base}.card.json`);
fs.writeFileSync(cardPath, JSON.stringify(card, null, 2), 'utf8');
console.log('card:', cardPath, fs.statSync(cardPath).size, 'bytes');

if (!chatId) process.exit(0);

const app = sendApp();
const token = await tenantToken(app);
const { status, json } = await http('POST', '/im/v1/messages', {
  token,
  query: { receive_id_type: 'chat_id' },
  body: { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
});
console.log('send:', status, 'code', json.code, json.msg || '');
if (json.code !== 0) {
  console.error(JSON.stringify(json).slice(0, 800));
  process.exit(2);
}
console.log('message_id:', json.data?.message_id);
