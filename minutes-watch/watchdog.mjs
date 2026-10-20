// watchdog.mjs — 通用长任务看门狗：进程死掉/卡住/超时 → 主动报警，不用人来问
//
// 两种用法
//  1) 托管运行（推荐）：看门狗自己起进程，拿得到退出码
//     node watchdog.mjs run --title "妙记声纹流水线" --log /path/run.log [--chat oc_xxx] [--timeout-min 90] [--stall-min 15] [--notify-done] -- <cmd> [args...]
//  2) 盯已有进程（进程不是我起的，比如 screen 里的）
//     node watchdog.mjs watch --screen vprint --log /path/run.log [--chat oc_xxx] [--title T] [--done-marker "=== 完成 ==="]
//
// 通用参数
//   --chat <id>          报警目标，chat_id 或 open_id（省略则用 ~/.openclaw/watchdog.json 的 defaultChat，再没有就主 DM）
//   --dry                只打印将要发的卡片，不真的发（自测用）
//   --selftest           发一条测试卡片，验证通道
//   --timeout-min N      总时限，默认 120
//   --stall-min N        日志多少分钟不增长算卡住，默认 15
//
// 退出码：0=正常完成；1=已报警（失败/卡住/超时）；2=参数错误
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';

const HOME = os.homedir();
const MAIN_DM = 'ou_93d7f79abd93ec4c91602d86de65be08';
const CFG = path.join(HOME, '.openclaw/watchdog.json');

const argv = process.argv.slice(2);
const mode = argv[0];
const has = (k) => argv.includes('--' + k);
const arg = (k, d = '') => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const DRY = has('dry');
const SELFTEST = has('selftest');
const TIMEOUT_MIN = Number(arg('timeout-min', '120'));
const STALL_MIN = Number(arg('stall-min', '15'));
const TITLE = arg('title', '后台任务');
const DONE_MARKER = arg('done-marker', '=== 完成 ===');
const NOTIFY_DONE = !has('quiet-done');   // 2026-10-20: 成功也发卡片，默认开，--quiet-done 关闭

function target() {
  const c = arg('chat');
  if (c) return { id: c, type: c.startsWith('ou_') ? 'open_id' : 'chat_id' };
  try {
    const j = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    if (j.defaultChat) return { id: j.defaultChat, type: j.defaultChat.startsWith('ou_') ? 'open_id' : 'chat_id' };
  } catch {}
  return { id: MAIN_DM, type: 'open_id' };
}

function creds() {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOME, '.openclaw/openclaw.json'), 'utf8'));
  const m = cfg?.channels?.feishu?.accounts?.main;
  if (!m?.appId || !m?.appSecret) throw new Error('openclaw.json 缺 feishu main 凭证');
  return m;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function send(text, template = 'red', title = TITLE) {
  const t = target();
  if (DRY) {
    console.log(`[dry] -> ${t.type}:${t.id} [${template}] ${title}\n${text}`);
    return 'dry-run';
  }
  const { appId, appSecret } = creds();
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error('tenant token 失败 ' + j.code + ' ' + j.msg);
  const tok = j.tenant_access_token;
  const card = {
    config: { wide_screen_mode: true, update_multi: true },
    header: { template, title: { tag: 'plain_text', content: String(title).slice(0, 100) } },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: String(text).slice(0, 26000) } }],
  };
  const s = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=' + t.type, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: JSON.stringify({ receive_id: t.id, msg_type: 'interactive', content: JSON.stringify(card) }),
  });
  const d = await s.json();
  const LOGF = path.join(HOME, '.openclaw/logs/watchdog.log');
  fs.mkdirSync(path.dirname(LOGF), { recursive: true });
  fs.appendFileSync(LOGF, `${new Date().toISOString()}\t${title}\t${template}\t${t.type}:${t.id}\tcode=${d.code}\tmsg_id=${d.data?.message_id || '-'}\n`);
  if (d.code !== 0) throw new Error(`send 失败 ${d.code} ${d.msg}`);
  return d.data?.message_id;
}

const tailLines = (file, n = 20) => {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-n).join('\n'); }
  catch (e) { return `(读不到日志: ${e.message})`; }
};

if (SELFTEST) {
  const id = await send(
    `看门狗自检：这条能收到，说明报警通道是通的。\n目标: ${target().type}:${target().id}\n后续进程崩溃、日志 ${STALL_MIN} 分钟不动、或超过 ${TIMEOUT_MIN} 分钟未完成，都会自动报警。`,
    'orange', '看门狗自检'
  );
  console.log('selftest sent:', id);
  process.exit(0);
}

if (mode === 'run') {
  const sep = argv.indexOf('--');
  const cmd = sep >= 0 ? argv.slice(sep + 1) : [];
  const LOG = arg('log');
  if (!cmd.length || !LOG) { console.error('用法: watchdog.mjs run --log <log> -- <cmd...>'); process.exit(2); }
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const out = fs.createWriteStream(LOG, { flags: 'a' });
  out.write(`\n[watchdog] ${new Date().toISOString()} 启动: ${cmd.join(' ')}\n`);
  const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
  let lastSize = 0, lastGrow = Date.now(), done = false, alerted = false;
  const t0 = Date.now();

  const pump = (stream) => stream.on('data', (b) => {
    out.write(b);
    lastSize += b.length; lastGrow = Date.now();
  });
  pump(child.stdout); pump(child.stderr);

  const alert = async (reason, tmpl = 'red') => {
    if (alerted) return;
    alerted = true;
    const mins = Math.round((Date.now() - t0) / 60000);
    try {
      await send(
        `**${esc(reason)}**\n任务: ${esc(TITLE)}\n命令: ${esc(cmd.join(' ').slice(0, 300))}\n已运行: ${mins} 分钟\n日志: ${esc(LOG)}\n\n**最后 20 行**\n${'`'.repeat(0)}${esc(tailLines(LOG))}`,
        tmpl
      );
    } catch (e) { console.error('报警发送失败:', e.message); }
  };

  const timer = setInterval(async () => {
    if (done) return;
    const mins = (Date.now() - t0) / 60000;
    if ((Date.now() - lastGrow) / 60000 > STALL_MIN) await alert(`日志 ${STALL_MIN} 分钟没增长，疑似卡住`);
    else if (mins > TIMEOUT_MIN) await alert(`超过 ${TIMEOUT_MIN} 分钟仍未完成`);
  }, 60000);

  child.on('exit', async (code, sig) => {
    done = true;
    clearInterval(timer);
    out.end();
    const mins = Math.round((Date.now() - t0) / 60000);
    if (code === 0) {
      if (NOTIFY_DONE) {
        try { await send(`**完成**\n任务: ${esc(TITLE)}\n耗时: ${mins} 分钟\n日志: ${esc(LOG)}\n\n**最后 10 行**\n${esc(tailLines(LOG, 10))}`, 'green', TITLE + ' 完成'); } catch (e) { console.error(e.message); }
      }
      process.exit(0);
    }
    await alert(`进程退出，退出码 ${code}${sig ? ' 信号 ' + sig : ''}`);
    process.exit(1);
  });
} else if (mode === 'watch') {
  const SCREEN = arg('screen');
  const LOG = arg('log');
  if (!SCREEN || !LOG) { console.error('用法: watchdog.mjs watch --screen <name> --log <log>'); process.exit(2); }
  const screenAlive = () => {
    try {
      const o = execFileSync('screen', ['-ls'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return new RegExp('\\.' + SCREEN + '[\\t ]').test(o);
    } catch (e) { return new RegExp('\\.' + SCREEN + '[\\t ]').test(String(e.stdout || '')); }
  };
  const t0 = Date.now();
  let lastSize = -1, lastGrow = Date.now(), alerted = false;
  const alert = async (reason) => {
    if (alerted) return; alerted = true;
    try {
      await send(`**${esc(reason)}**\n任务: ${esc(TITLE)}\n已运行: ${Math.round((Date.now() - t0) / 60000)} 分钟\n日志: ${esc(LOG)}\n\n**最后 20 行**\n${esc(tailLines(LOG))}`, 'red');
    } catch (e) { console.error('报警发送失败:', e.message); }
  };
  while (true) {
    let body = '';
    try { body = fs.readFileSync(LOG, 'utf8'); } catch {}
    if (body.includes(DONE_MARKER)) { console.log('completed'); process.exit(0); }
    if (!screenAlive()) { await alert('进程已退出，但没有打完成标记'); process.exit(1); }
    if (body.length !== lastSize) { lastSize = body.length; lastGrow = Date.now(); }
    else if ((Date.now() - lastGrow) / 60000 > STALL_MIN) { await alert(`日志 ${STALL_MIN} 分钟没增长，疑似卡住`); process.exit(1); }
    if ((Date.now() - t0) / 60000 > TIMEOUT_MIN) { await alert(`超过 ${TIMEOUT_MIN} 分钟仍未完成`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 60000));
  }
} else {
  console.error('用法: watchdog.mjs <run|watch> ... 或 --selftest');
  process.exit(2);
}
