// 一次性用户授权：本地回调自动收 code（推荐），或打印链接手动粘贴 code
// 用法:
//   node auth.mjs login                  # 起本地回调服务，等浏览器跳回
//   node auth.mjs login --manual         # 只打印授权链接
//   node auth.mjs paste <code>           # 手动粘贴 code 换 token
//   node auth.mjs status                 # 查看当前 token 状态
import http from 'node:http';
import { minutesApp, loadConfig, readJson, CRED_PATH, writeJson } from './lib/config.mjs';
import { authorizeUrl, exchangeCode, loadCredentials, userToken } from './lib/feishu.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'login';
const app = minutesApp();
const cfg = loadConfig();

function redirectUri() {
  const r = cfg.oauth?.redirectUri;
  if (!r) throw new Error('config.json 缺 oauth.redirectUri（飞书后台安全设置里登记的那个地址）');
  return r;
}

function state() {
  return Math.random().toString(36).slice(2, 10);
}

async function doLogin() {
  const ru = redirectUri();
  const st = state();
  const url = authorizeUrl(app, ru, st, cfg.oauth?.scope);

  if (args.includes('--manual')) {
    console.log('\n打开下面链接授权，授权后浏览器会跳到：');
    console.log(ru + '?code=...&state=' + st);
    console.log('\n把地址栏里的 code 复制出来，执行：node auth.mjs paste <code>\n');
    console.log(url);
    return;
  }

  // 本地回调：要求 redirectUri 指向本机端口（直连或用 cloudflared 隧道映射到本机）
  const port = Number(cfg.oauth?.localPort || 8965);
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') {
      res.writeHead(404).end('not found');
      return;
    }
    const code = u.searchParams.get('code');
    const err = u.searchParams.get('error');
    if (err || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>授权失败</h1><pre>${err || 'no code'}</pre>`);
      console.error('授权失败:', err || 'no code');
      return;
    }
    if (u.searchParams.get('state') !== st) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>state 不匹配，已拒绝</h1>');
      console.error('state 不匹配，丢弃该 code');
      return;
    }
    try {
      const cred = await exchangeCode(app, code, ru);
      console.log('授权成功, scope:', cred.scope, 'expires_at:', new Date(cred.expires_at).toISOString());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">' +
          '<h2>✅ 授权成功</h2><p>可以关掉这个页面了，纪要机器人已经拿到权限。</p></body></html>'
      );
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 800);
    } catch (e) {
      console.error('换 token 失败:', e.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>换 token 失败</h1><pre>${e.message}</pre>`);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`\n本地回调已就绪: http://127.0.0.1:${port}/callback`);
    console.log(`飞书后台登记的重定向地址: ${ru}`);
    console.log('\n点这里授权：\n' + url + '\n');
  });
}

async function paste(code) {
  if (!code) throw new Error('用法: node auth.mjs paste <code>');
  const cred = await exchangeCode(app, code, redirectUri());
  console.log('授权成功, scope:', cred.scope);
  console.log('expires_at:', new Date(cred.expires_at).toISOString());
  console.log('已写入', CRED_PATH);
}

async function status() {
  const cred = loadCredentials();
  if (!cred) {
    console.log('未授权。执行: node auth.mjs login');
    return;
  }
  console.log('appId:', cred.appId);
  console.log('access_token 到期:', new Date(cred.expires_at).toISOString());
  console.log('refresh_token 到期:', new Date(cred.refresh_expires_at).toISOString());
  console.log('scope:', cred.scope);
  try {
    const t = await userToken(app);
    console.log('当前 token 可用:', t.slice(0, 8) + '…');
  } catch (e) {
    console.log('token 不可用:', e.message);
  }
}

switch (cmd) {
  case 'login':
    await doLogin();
    break;
  case 'paste':
    await paste(args[1]);
    break;
  case 'status':
    await status();
    break;
  default:
    console.log('用法: node auth.mjs [login [--manual] | paste <code> | status]');
}
