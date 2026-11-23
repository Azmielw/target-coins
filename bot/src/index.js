import path from 'node:path';
import { Store } from './store.js';
import { Core } from './core.js';
import { Telegram } from './telegram.js';

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR || './data');
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

const store = new Store(dataDir);
const core = new Core({ store, pauseHours: Number(env.PAUSE_HOURS || 12), log });

let tg = null;
if (env.TELEGRAM_BOT_TOKEN) {
  tg = new Telegram({ token: env.TELEGRAM_BOT_TOKEN, ownerId: env.OWNER_TELEGRAM_ID, core, log });
  core.addChannel('tg', tg);
  core.addOwnerSink(tg);
  if (!env.OWNER_TELEGRAM_ID) log('[tg] لسى ما حطيت OWNER_TELEGRAM_ID. ابعت /myid للبوت وحط الرقم بملف .env');
  tg.start().catch((e) => log(`[tg] ما اشتغل: ${e.message}`));
} else {
  log('[tg] ما في TELEGRAM_BOT_TOKEN، تلجرام مطفي.');
}

if (env.ENABLE_WHATSAPP !== '0') {
  const { WhatsApp } = await import('./whatsapp.js');
  const wa = new WhatsApp({
    core, dataDir, log,
    notifySelf: env.NOTIFY_OWNER_ON_WHATSAPP !== '0',
    pairPhone: env.WA_PAIR_PHONE || '',
    onPairCode: (code) => tg?.ownerId && tg.api('sendMessage', { chat_id: tg.ownerId, text: `كود ربط الواتس: ${code}` }).catch(() => {}),
  });
  core.addChannel('wa', wa);
  core.addOwnerSink(wa);
  wa.start().catch((e) => log(`[wa] ما اشتغل: ${e.message}`));
}

process.on('unhandledRejection', (e) => log('[error]', e?.message || e));
