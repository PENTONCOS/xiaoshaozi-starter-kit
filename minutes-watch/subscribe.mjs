// 订阅妙记生成事件（必须有 user_access_token）
import { minutesApp } from './lib/config.mjs';
import { http, userToken } from './lib/feishu.mjs';

const app = minutesApp();
const token = await userToken(app);

const sub = await http('POST', '/minutes/v1/minutes/subscription', {
  token,
  body: { event_type: 'minutes.minute.generated_v1' },
});
console.log('[subscribe] HTTP', sub.status, 'code', sub.json.code, 'msg', sub.json.msg || '');
if (sub.json.code === 0) console.log('[subscribe] OK 已订阅 minutes.minute.generated_v1');
else console.log('[subscribe] FAIL', JSON.stringify(sub.json).slice(0, 400));

// 用一条已知妙记验证 user token 真的能读到内容
const probe = await http('GET', '/minutes/v1/minutes/obcnple29k1j7523zqf9jcbi', { token });
console.log('[user-token GET minute] HTTP', probe.status, 'code', probe.json.code, 'msg', probe.json.msg || '');
if (probe.json.code === 0) {
  const d = probe.json.data?.minute || {};
  console.log('[user-token] title:', d.title, '| owner:', d.owner_id, '| duration:', d.duration);
}
