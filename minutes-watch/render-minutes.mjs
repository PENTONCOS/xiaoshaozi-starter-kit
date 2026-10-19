// 把「结构化纪要 JSON」渲染成 Markdown 存档 + 飞书卡片，并可推送
// 用法:
//   node render-minutes.mjs <data.json>                # 只生成 .md
//   node render-minutes.mjs <data.json> --card         # 同时生成 .card.json
//   node render-minutes.mjs <data.json> --send <chat_id>  # 生成并推送卡片
//   node render-minutes.mjs <data.json> --no-archive   # 不归档（默认归档）
// 归档行为：渲染完成后自动调用 archive.mjs，把该会议全部产物移进
//          ~/sisyphus-output/meetings/archive/YYYY-MM/<YYYYMMDD-slug>/ 并重建 INDEX.md
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toMarkdown, toCard } from './lib/render.mjs';
import { sendApp } from './lib/config.mjs';
import { tenantToken, http } from './lib/feishu.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

const [dataPath, ...rest] = process.argv.slice(2);
if (!dataPath) {
  console.error('用法: node render-minutes.mjs <data.json> [--card] [--send <chat_id>]');
  process.exit(1);
}
const doCard = rest.includes('--card') || rest.includes('--send');
const doArchive = !rest.includes('--no-archive');
const sendIdx = rest.indexOf('--send');
const chatId = sendIdx >= 0 ? rest[sendIdx + 1] : null;

const m = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const dir = path.dirname(path.resolve(dataPath));
const base = path.basename(dataPath).replace(/\.json$/, '');

const mdPath = path.join(dir, `${base}.md`);
fs.writeFileSync(mdPath, toMarkdown(m), 'utf8');
console.log('markdown:', mdPath, fs.statSync(mdPath).size, 'bytes');

const card = doCard ? toCard(m) : null;
if (card) {
  const cardPath = path.join(dir, `${base}.card.json`);
  fs.writeFileSync(cardPath, JSON.stringify(card, null, 2), 'utf8');
  console.log('card:', cardPath, fs.statSync(cardPath).size, 'bytes');
}

let sent = true;
if (card && chatId) {
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
    sent = false;
  } else {
    console.log('message_id:', json.data?.message_id);
  }
}

// ---------------------------------------------------------------- archive
// 归档无条件执行（只在推送失败时跳过）：即使推送失败，本地产物也不会丢
if (doArchive && sent) {
  const m2 = base.match(/^(\d{8})-(.+?)(\.data)?$/);
  const slug = m2 ? `${m2[1]}-${m2[2]}` : base;
  try {
    const out = execFileSync(process.execPath, [path.join(here, 'archive.mjs'), slug], {
      encoding: 'utf8',
      cwd: here,
    });
    process.stdout.write(out);
  } catch (e) {
    console.error('[archive] 失败，产物保留在原位：', e.message);
  }
}

if (!sent) process.exit(2);
