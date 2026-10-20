import fs from 'node:fs';
import path from 'node:path';
import { minutesApp } from './lib/config.mjs';

const token = process.argv[2];
const out = process.argv[3];
if (!token || !out) { console.error('用法: node dl-media.mjs <minute_token> <输出路径>'); process.exit(1); }

const app = minutesApp();
const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: app.appId, app_secret: app.appSecret }),
});
const j = await r.json();
if (j.code !== 0) { console.error('tenant token 失败', j); process.exit(1); }

const m = await fetch(`https://open.feishu.cn/open-apis/minutes/v1/minutes/${token}/media`, {
  headers: { Authorization: 'Bearer ' + j.tenant_access_token },
});
const mj = await m.json();
if (mj.code !== 0) { console.error('media 接口失败', JSON.stringify(mj)); process.exit(1); }

const url = mj.data.download_url;
console.log('download_url 已获取，开始下载…');
const d = await fetch(url, { redirect: 'follow' });
if (!d.ok) { console.error('下载失败 HTTP', d.status); process.exit(1); }
const buf = Buffer.from(await d.arrayBuffer());
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`已保存 ${out}  ${(buf.length / 1048576).toFixed(1)} MB  content-type=${d.headers.get('content-type')}`);
