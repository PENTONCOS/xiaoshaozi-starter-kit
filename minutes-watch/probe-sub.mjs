import { minutesApp } from './lib/config.mjs';
import { http, userToken } from './lib/feishu.mjs';
const app = minutesApp();
const token = *** userToken(app);
// 订阅后再查一次，看订阅状态是否真的记在服务端
for (const p of ['/minutes/v1/minutes/subscription', '/minutes/v1/minutes/subscriptions']) {
  const r = await http('GET', p, { token });
  console.log('GET', p, '->', r.status, 'code', r.json.code, String(r.json.msg||'').slice(0,80));
}
// 再订阅一次，看是否幂等（重复订阅应返回同样的成功）
const again = await http('POST', '/minutes/v1/minutes/subscription', { token, body: { event_type: 'minutes.minute.generated_v1' } });
console.log('re-POST subscription ->', again.status, 'code', again.json.code, JSON.stringify(again.json).slice(0,200));
// 检查应用基本信息，确认事件权限所需的租户能力
const info = await http('GET', '/minutes/v1/minutes/obcnple29k1j7523zqf9jcbi/statistics', { token });
console.log('statistics ->', info.status, 'code', info.json.code, String(info.json.msg||'').slice(0,80));
