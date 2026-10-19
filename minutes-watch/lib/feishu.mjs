// 飞书 HTTP 客户端：tenant token 缓存 / user token 刷新 / 统一请求封装
import { CRED_PATH, readJson, writeJson, log } from './config.mjs';

const BASE = 'https://open.feishu.cn/open-apis';
const tenantCache = new Map();

export async function http(method, pathOrUrl, { token, body, query } = {}) {
  const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : BASE + pathOrUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { code: -1, msg: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

/** 自建应用 tenant_access_token（带缓存，提前 5 分钟续） */
export async function tenantToken(app) {
  const key = app.appId;
  const hit = tenantCache.get(key);
  if (hit && hit.expiresAt - Date.now() > 5 * 60 * 1000) return hit.token;
  const { status, json } = await http('POST', '/auth/v3/tenant_access_token/internal', {
    body: { app_id: app.appId, app_secret: app.appSecret },
  });
  if (status !== 200 || json.code !== 0) {
    throw new Error(`tenant_access_token 获取失败: ${status} ${JSON.stringify(json)}`);
  }
  tenantCache.set(key, {
    token: json.tenant_access_token,
    expiresAt: Date.now() + (json.expire || 7200) * 1000,
  });
  return json.tenant_access_token;
}

function saveCredentials(cred) {
  writeJson(CRED_PATH, cred, 0o600);
}

export function loadCredentials() {
  return readJson(CRED_PATH, null);
}

/** 用 authorization_code 换 user_access_token（OAuth v2） */
export async function exchangeCode(app, code, redirectUri) {
  const { status, json } = await http('POST', '/authen/v2/oauth/token', {
    body: {
      grant_type: 'authorization_code',
      client_id: app.appId,
      client_secret: app.appSecret,
      code,
      redirect_uri: redirectUri,
    },
  });
  if (json?.code !== 0 || !json?.access_token) {
    throw new Error(`换取 user_access_token 失败: ${status} ${JSON.stringify(json)}`);
  }
  const cred = {
    appId: app.appId,
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in || 7200) * 1000,
    refresh_expires_at: Date.now() + (json.refresh_token_expires_in || 30 * 86400) * 1000,
    scope: json.scope,
    obtained_at: new Date().toISOString(),
  };
  saveCredentials(cred);
  return cred;
}

/** 取 user_access_token（自动刷新；过期且无法刷新时报错提示重新授权） */
export async function userToken(app) {
  let cred = loadCredentials();
  if (!cred || cred.appId !== app.appId) {
    throw new Error('尚未用户授权，请先执行: node auth.mjs login');
  }
  if (cred.expires_at - Date.now() > 5 * 60 * 1000) return cred.access_token;
  if (cred.refresh_expires_at && cred.refresh_expires_at < Date.now()) {
    throw new Error('refresh_token 已过期，请重新执行: node auth.mjs login');
  }
  const { status, json } = await http('POST', '/authen/v2/oauth/token', {
    body: {
      grant_type: 'refresh_token',
      client_id: app.appId,
      client_secret: app.appSecret,
      refresh_token: cred.refresh_token,
    },
  });
  if (json?.code !== 0 || !json?.access_token) {
    log(`refresh_token 刷新失败: ${status} ${JSON.stringify(json)}`);
    throw new Error('refresh_token 刷新失败，请重新执行: node auth.mjs login');
  }
  cred = {
    ...cred,
    access_token: json.access_token,
    refresh_token: json.refresh_token || cred.refresh_token,
    expires_at: Date.now() + (json.expires_in || 7200) * 1000,
    refresh_expires_at: Date.now() + (json.refresh_token_expires_in || 30 * 86400) * 1000,
    refreshed_at: new Date().toISOString(),
  };
  saveCredentials(cred);
  log('user_access_token 已自动刷新');
  return cred.access_token;
}

export function authorizeUrl(app, redirectUri, state, scope) {
  const u = new URL('https://open.feishu.cn/open-apis/authen/v1/authorize');
  u.searchParams.set('app_id', app.appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  if (scope) u.searchParams.set('scope', scope);
  return u.toString();
}
