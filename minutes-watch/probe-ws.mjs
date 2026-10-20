// Long-connection probe: connect with the bot's app id/secret, register
// minutes.minute.generated_v1, dump every raw event for 120s.
import * as Lark from '@larksuiteoapi/node-sdk';
import * as c from './lib/config.mjs';
import fs from 'node:fs';

const app = c.sendApp();
console.log('[probe] appId:', app.appId);

const dispatcher = new Lark.EventDispatcher({
  encryptKey: app.encryptKey || '',
  verificationToken: app.verificationToken || '',
});
dispatcher.register({}, async (data) => {
  const line = `[${new Date().toISOString()}] RAW EVENT ${JSON.stringify(data)}\n`;
  fs.appendFileSync('logs/ws-probe.log', line);
  console.log(line.trim());
  return { code: 0 };
});
dispatcher.register({ 'minutes.minute.generated_v1': 'minutes.minute.generated_v1' }, async (data) => {
  const line = `[${new Date().toISOString()}] MINUTES EVENT ${JSON.stringify(data)}\n`;
  fs.appendFileSync('logs/ws-probe.log', line);
  console.log(line.trim());
});

const client = new Lark.WSClient({
  appId: app.appId,
  appSecret: app.appSecret,
  loggerLevel: Lark.LoggerLevel.info,
});
console.log('[probe] starting WSClient...');
await client.start({ eventDispatcher: dispatcher });
console.log('[probe] STARTED - connected, waiting for events (120s)');
await new Promise((r) => setTimeout(r, 120000));
console.log('[probe] timeout, exiting');
process.exit(0);
