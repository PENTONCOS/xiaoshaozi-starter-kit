// 用 tenant_access_token 下载妙记音频
// 用法: node dl-minutes.mjs <minute_token> <输出路径>
import fs from 'node:fs';
const [mt, out] = process.argv.slice(2);
if (!mt || !out) { console.error('用法: node dl-minutes.mjs <minute_token> <out>'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(process.env.HOME + '/.openclaw/openclaw.json', 'utf8'));
const app = cfg?.channels?.feishu?.accounts?.main;
const appId = app.appId || app.app_id, appSecret = app.appSecret || app.app_secret;
const t = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
});
const tok = (await t.json()).tenant_access_token;
if (!tok) { console.error('取 tenant token 失败'); process.exit(1); }

const infoR = await fetch(`https://open.feishu.cn/open-apis/minutes/v1/minutes/${mt}`, { headers: { Authorization: `Bearer ${tok}` } });
const info = await infoR.json();
if (info.code !== 0) { console.error('info 失败', JSON.stringify(info).slice(0, 300)); process.exit(1); }
const m = info.data.minute;
console.log(JSON.stringify({ title: m.title, duration_ms: m.duration, tokens: m.token }, null, 0));

const mr = await fetch(`https://open.feishu.cn/open-apis/minutes/v1/minutes/${mt}/media`, { headers: { Authorization: `Bearer ${tok}` } });
const mj = await mr.json();
if (mj.code !== 0 || !mj.data?.download_url) { console.error('media 失败', JSON.stringify(mj).slice(0, 300)); process.exit(1); }
const url = mj.data.download_url;
console.log('download_url 长度', url.length);

const r = await fetch(url);
if (!r.ok) { console.error('下载失败 HTTP', r.status); process.exit(1); }
const buf = Buffer.from(await r.arrayBuffer());
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, buf);
fs.chmodSync(out, 0o600);
console.log('saved', out, (buf.length / 1048576).toFixed(1), 'MB');
