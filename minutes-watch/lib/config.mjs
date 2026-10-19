// 配置与路径解析
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
export const HOME = os.homedir();
export const STATE_DIR = path.join(HOME, '.openclaw', 'minutes-watch');
export const CONFIG_PATH = path.join(STATE_DIR, 'config.json');
export const CRED_PATH = path.join(STATE_DIR, 'credentials.json');
export const STATE_PATH = path.join(STATE_DIR, 'state.json');
export const LOG_DIR = path.join(STATE_DIR, 'logs');
export const OPENCLAW_CONFIG = path.join(HOME, '.openclaw', 'openclaw.json');

export function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(p, obj, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  if (mode) fs.chmodSync(p, mode);
}

export function log(line) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${line}`;
  console.log(msg);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'watch.log'), msg + '\n', 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}

export function loadConfig() {
  const cfg = readJson(CONFIG_PATH, null);
  if (!cfg) {
    throw new Error(
      `缺少配置文件 ${CONFIG_PATH}（可复制 config.example.json 后填写 minutesApp 凭证）`
    );
  }
  return cfg;
}

/** 妙记专用应用（只订阅 minutes.minute.generated_v1，不碰 IM，避免长连接抢事件） */
export function minutesApp() {
  const a = loadConfig().minutesApp || {};
  if (!a.appId || !a.appSecret) {
    throw new Error('config.json 的 minutesApp.appId / appSecret 未填写');
  }
  return a;
}

/** 发送用应用：默认复用 OpenClaw 里的 Sisyphus bot 凭证，消息以现有机器人身份出现在群里 */
export function sendApp() {
  const c = readJson(CONFIG_PATH, {}) || {};
  if (c.sendApp && c.sendApp.appId && c.sendApp.appSecret) return c.sendApp;
  const oc = readJson(OPENCLAW_CONFIG, {}) || {};
  const acct = oc?.channels?.feishu?.accounts?.main;
  if (!acct?.appId || !acct?.appSecret) {
    throw new Error('未能从 ~/.openclaw/openclaw.json 读到发送用应用凭证，请在 config.json 里显式配置 sendApp');
  }
  return { appId: acct.appId, appSecret: acct.appSecret, name: acct.name || 'Sisyphus' };
}

export function target() {
  const t = loadConfig().target || {};
  if (!t.chatId) throw new Error('config.json 缺 target.chatId');
  return t;
}
