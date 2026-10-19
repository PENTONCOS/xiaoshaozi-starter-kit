// 最小验证：给一条妙记链接，直接拉 AI 产物
// 用法: node probe.mjs "https://xxx.feishu.cn/minutes/obcnq3b9jl72l83w4f149w9c"
import { sendApp, readJson, OPENCLAW_CONFIG, HOME } from './lib/config.mjs';
import { tenantToken, http } from './lib/feishu.mjs';
import path from 'node:path';

const arg = process.argv[2];
if (!arg) {
  console.error('用法: node probe.mjs <妙记链接或 minute_token>');
  process.exit(1);
}

const m = arg.match(/minutes\/([A-Za-z0-9]{20,32})/);
const token = m ? m[1] : arg.trim();

const app = sendApp();
console.log('应用:', app.appId, app.name || '');
const t = await tenantToken(app);
console.log('tenant_token:', t.slice(0, 6) + '…');
console.log('minute_token:', token);

const { status, json } = await http('GET', `/minutes/v1/minutes/${token}/artifacts`, { token: t });
console.log('HTTP', status, 'code', json.code, json.msg);

if (json.code === 0) {
  const d = json.data || {};
  console.log('\n标题:', d.title || '(空)');
  console.log('摘要:', (d.summary || '').slice(0, 300));
  console.log('章节数:', (d.minute_chapters || []).length);
  console.log('待办数:', (d.minute_todos || []).length);
  console.log('\n原始 JSON 已存: ' + path.join(HOME, 'sisyphus-output', 'minutes-probe.json'));
  const fs = await import('node:fs');
  fs.mkdirSync(path.join(HOME, 'sisyphus-output'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'sisyphus-output', 'minutes-probe.json'), JSON.stringify(json, null, 2));
} else {
  console.log('失败详情:', JSON.stringify(json).slice(0, 800));
}
