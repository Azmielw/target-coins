import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handle, pickMenu, looksLikePassword } from '../src/flow.js';
import { Core } from '../src/core.js';
import { Store } from '../src/store.js';

const vid = { type: 'video', src: 'tg', fileId: 'X' };

test('menu picking', () => {
  assert.equal(pickMenu('1'), 'order');
  assert.equal(pickMenu('٣'), 'castle');
  assert.equal(pickMenu('بدي اعرض قلعة'), 'castle');
  assert.equal(pickMenu('بدي ابيع حساب ببجي'), 'pubg');
  assert.equal(pickMenu('بدي اشحن شدات'), 'order');
  assert.equal(pickMenu('مرحبا'), null);
});

test('passwords are refused', () => {
  assert.ok(looksLikePassword('الباسورد 12345'));
  assert.ok(looksLikePassword('ali@gmail.com 12345678'));
  assert.ok(!looksLikePassword('ali@gmail.com'));
  assert.ok(!looksLikePassword('50$'));
});

test('castle offer full flow', () => {
  let r = handle(null, { text: 'السلام عليكم' });
  assert.match(r.replies[0], /TARGET COINS/);
  r = handle(r.state, { text: '3' });
  assert.match(r.replies[0], /ABN GAZA x AZMI/);
  r = handle(r.state, { text: 'كم السعر' });
  assert.match(r.replies[0], /فيديو/);
  r = handle(r.state, { media: vid });
  assert.equal(r.state.step, 'details');
  r = handle(r.state, { text: 'قلعة لفل 25 فيها كل اشي' });
  assert.equal(r.state.step, 'price');
  r = handle(r.state, { text: 'غالي' });
  assert.equal(r.state.step, 'price');
  r = handle(r.state, { text: '300$' });
  assert.equal(r.notify.kind, 'castle');
  assert.equal(r.notify.data.price, '300$');
  assert.equal(r.notify.data.videos.length, 1);
  assert.equal(r.state.step, 'handed');
});

test('order is forwarded', () => {
  let r = handle(null, { text: 'بدي اشحن' });
  assert.equal(r.state.step, 'order_text');
  r = handle(r.state, { text: '660 شدة ببجي ID 5123' });
  assert.equal(r.notify.kind, 'order');
  assert.equal(r.notify.final, true);
});

test('core: pause, relay, owner takeover', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcbot-'));
  const store = new Store(dir);
  const core = new Core({ store, log: () => {} });
  const sent = []; const notices = [];
  core.addChannel('wa', { send: async (ref, t) => sent.push([ref.jid, t]) });
  let n = 0;
  core.addOwnerSink({ notify: async (t, media, key) => { notices.push({ t, media }); return [`tg:${++n}`]; } });
  const who = { name: 'Ali', contact: '+970', platformLabel: 'واتساب' };
  const k = 'wa:1@s.whatsapp.net'; const ref = { jid: '1@s.whatsapp.net' };

  await core.onCustomer('wa', k, ref, who, { text: 'هاي' });
  assert.equal(sent.length, 1);
  await core.onCustomer('wa', k, ref, who, { text: '1' });
  await core.onCustomer('wa', k, ref, who, { text: '100 شدة' });
  assert.equal(notices.length, 1);
  assert.match(notices[0].t, /100 شدة/);
  assert.ok(core.isPaused(k));
  const before = sent.length;
  await core.onCustomer('wa', k, ref, who, { text: 'وينكم؟' });
  assert.equal(sent.length, before); // البوت ساكت
  assert.equal(notices.length, 2); // بس الرسالة وصلت للإدارة

  const r = await core.ownerReply('tg:1', 'هلأ بشحنلك');
  assert.ok(r.ok);
  assert.deepEqual(sent.at(-1), ['1@s.whatsapp.net', 'هلأ بشحنلك']);

  const k2 = 'wa:2@s.whatsapp.net';
  core.ownerTookOver(k2);
  await core.onCustomer('wa', k2, { jid: '2@s.whatsapp.net' }, who, { text: 'هاي' });
  assert.ok(!sent.some(([j]) => j === '2@s.whatsapp.net'));
});
