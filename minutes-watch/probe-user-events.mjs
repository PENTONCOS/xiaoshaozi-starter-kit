// 用 user_access_token 看看能不能列出「用户身份可订阅的事件」
import { minutesApp } from './lib/config.mjs';
import { http, userToken } from './lib/feishu.mjs';
const app = minutesApp();
const token = ***
for (const p of ['/event/v1/outbound_ip', '/application/v6/applications/cli_a9087e063bb85bb4/app_versions']) {
  const r = await http('GET', p, { token });
  console.log(p, '->', r.status, 'code', r.json.code);
}
