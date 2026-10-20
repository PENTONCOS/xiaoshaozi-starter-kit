import { minutesApp } from './lib/config.mjs';
const app = minutesApp();
const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: app.appId, app_secret: app.appSecret }),
});
const j = await r.json();
console.log('tenant token:', j.code, j.msg);
if (j.code !== 0) process.exit(1);
const auth = 'Bearer ' + j.tenant_access_token;
const TK = 'obcnple29k1j7523zqf9jcbi';
const m = await fetch(`https://open.feishu.cn/open-apis/minutes/v1/minutes/${TK}/media`, {
  headers: { Authorization: auth },
});
const txt = await m.text();
console.log('\n=== media ->', m.status);
console.log(txt.slice(0, 800));
