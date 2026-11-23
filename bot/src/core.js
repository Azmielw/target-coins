// الوسيط بين المنصات (واتساب/تلجرام) ومنطق المحادثة.
import { handle, formatNotice } from './flow.js';

export class Core {
  /**
   * @param {{store: import('./store.js').Store, pauseHours: number, log?: Function}} opts
   */
  constructor({ store, pauseHours = 12, log = console.log }) {
    this.store = store;
    this.pauseMs = pauseHours * 3600 * 1000;
    this.log = log;
    this.channels = {}; // { tg: {send(ref, text)}, wa: {send(ref, text)} }
    this.ownerSinks = []; // كل وحدة: async notify(text, media[], key) => [noticeIds]
  }

  addChannel(name, ch) { this.channels[name] = ch; }
  addOwnerSink(sink) { this.ownerSinks.push(sink); }

  isPaused(key) {
    const c = this.store.chat(key);
    return !!(c && c.pausedUntil && c.pausedUntil > Date.now());
  }

  pause(key, ms = this.pauseMs) {
    const c = this.store.chat(key) || {};
    this.store.setChat(key, { ...c, pausedUntil: Date.now() + ms });
  }

  resume(key) {
    const c = this.store.chat(key) || {};
    this.store.setChat(key, { ...c, pausedUntil: 0, state: null });
  }

  /** انت كتبت للزبون بإيدك: البوت بيسكت بهاي المحادثة */
  ownerTookOver(key) {
    const c = this.store.chat(key) || {};
    this.store.setChat(key, { ...c, pausedUntil: Date.now() + this.pauseMs, ownerManual: true });
    this.log(`[pause] ${key} (رد صاحب المحل بإيده)`);
  }

  /**
   * رسالة من زبون.
   * @param {string} key  مثلاً "wa:9725...@s.whatsapp.net"
   * @param {object} ref  اللي بتحتاجه المنصة عشان ترد
   * @param {{name: string, contact: string, platformLabel: string}} who
   * @param {{text?: string, media?: object}} msg
   */
  async onCustomer(platform, key, ref, who, msg) {
    const saved = this.store.chat(key) || {};
    const paused = saved.pausedUntil && saved.pausedUntil > Date.now();

    if (paused) {
      // البوت ساكت، بس بنوصل الرسالة للإدارة إذا الزبون حكى بعد ما خلص طلبه
      if (!saved.ownerManual && (saved.state?.step === 'handed' || saved.relay)) {
        await this.notifyOwner({ kind: 'followup', data: { text: msg.text || '(ملف/صورة)', videos: msg.media ? [msg.media] : [] } }, who, key);
      }
      return;
    }

    // بعد ما انتهى وقت الإيقاف بنبلش من جديد
    const prevState = saved.pausedUntil ? null : saved.state || null;
    const { state, replies, notify } = handle(prevState, msg);

    this.store.setChat(key, { ...saved, ref, who, state, pausedUntil: 0, ownerManual: false, relay: false, updatedAt: Date.now() });

    const ch = this.channels[platform];
    for (const r of replies) {
      try { await ch.send(ref, r); } catch (e) { this.log(`[send-fail] ${key}: ${e.message}`); }
    }

    if (notify) {
      await this.notifyOwner(notify, who, key);
      if (notify.final) {
        // تحويل للإدارة: البوت بيسكت بس بيضل يوصّل رسائل الزبون إلك
        const c = this.store.chat(key);
        this.store.setChat(key, { ...c, pausedUntil: Date.now() + this.pauseMs, ownerManual: false });
      }
    }
  }

  async notifyOwner(notice, who, key) {
    const text = formatNotice(notice, who);
    const media = notice.data?.videos || [];
    for (const sink of this.ownerSinks) {
      try {
        const ids = await sink.notify(text, media, key);
        for (const id of ids || []) this.store.linkNotice(id, key);
      } catch (e) {
        this.log(`[notify-fail] ${e.message}`);
      }
    }
  }

  /** انت عملت Reply على إشعار: نبعت ردك للزبون */
  async ownerReply(noticeId, text) {
    const key = this.store.noticeKey(noticeId);
    if (!key) return { ok: false, reason: 'ما لقيت الزبون تبع هاي الرسالة' };
    const c = this.store.chat(key);
    const platform = key.split(':')[0];
    const ch = this.channels[platform];
    if (!c?.ref || !ch) return { ok: false, reason: 'المنصة مش شغالة هلأ' };
    await ch.send(c.ref, text);
    this.store.setChat(key, { ...c, pausedUntil: Date.now() + this.pauseMs, ownerManual: false, relay: true });
    return { ok: true, key, name: c.who?.name };
  }

  status() {
    const now = Date.now();
    const chats = Object.entries(this.store.db.chats);
    const paused = chats.filter(([, c]) => c.pausedUntil > now);
    return { total: chats.length, paused: paused.map(([k, c]) => ({ key: k, name: c.who?.name, until: c.pausedUntil })) };
  }
}
