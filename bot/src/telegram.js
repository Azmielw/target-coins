// تلجرام: بوت عادي، وكمان Telegram Business (البوت بيرد من حسابك الشخصي إذا معك بريميوم).
import fs from 'node:fs';
import path from 'node:path';

const TG_UPLOAD_LIMIT = 49 * 1024 * 1024;

export class Telegram {
  constructor({ token, ownerId, core, log = console.log }) {
    this.token = token;
    this.ownerId = ownerId ? String(ownerId) : '';
    this.core = core;
    this.log = log;
    this.offset = 0;
    this.base = `https://api.telegram.org/bot${token}`;
  }

  async api(method, body, isForm = false) {
    const res = await fetch(`${this.base}/${method}`, isForm
      ? { method: 'POST', body }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await res.json();
    if (!j.ok) throw new Error(`${method}: ${j.description}`);
    return j.result;
  }

  /** الرد على الزبون */
  async send(ref, text) {
    const body = { chat_id: ref.chatId, text };
    if (ref.bc) body.business_connection_id = ref.bc;
    return this.api('sendMessage', body);
  }

  /** يبعت إشعار لصاحب المحل، ويرجّع أرقام الرسائل عشان الـ Reply */
  async notify(text, media = []) {
    if (!this.ownerId) return [];
    const ids = [];
    const m = await this.api('sendMessage', { chat_id: this.ownerId, text });
    ids.push(`tg:${m.message_id}`);
    for (const item of media) {
      try {
        const sent = await this.sendMediaToOwner(item);
        if (sent) ids.push(`tg:${sent.message_id}`);
      } catch (e) {
        this.log(`[tg-media-fail] ${e.message}`);
        const n = await this.api('sendMessage', { chat_id: this.ownerId, text: `⚠️ ما قدرت أبعت الفيديو هون (${e.message}). شوفه بالمحادثة نفسها.` });
        ids.push(`tg:${n.message_id}`);
      }
    }
    return ids;
  }

  async sendMediaToOwner(item) {
    const method = item.type === 'photo' ? 'sendPhoto' : item.type === 'video' ? 'sendVideo' : 'sendDocument';
    const field = method === 'sendPhoto' ? 'photo' : method === 'sendVideo' ? 'video' : 'document';
    if (item.src === 'tg') return this.api(method, { chat_id: this.ownerId, [field]: item.fileId });
    if (item.src === 'wa' && item.path) {
      const size = fs.statSync(item.path).size;
      if (size > TG_UPLOAD_LIMIT) throw new Error('الفيديو أكبر من 50MB');
      const form = new FormData();
      form.append('chat_id', this.ownerId);
      form.append(field, new Blob([fs.readFileSync(item.path)], { type: item.mime || 'video/mp4' }), path.basename(item.path));
      return this.api(method, form, true);
    }
    return null;
  }

  mediaOf(msg) {
    if (msg.video) return { type: 'video', src: 'tg', fileId: msg.video.file_id };
    if (msg.video_note) return { type: 'video', src: 'tg', fileId: msg.video_note.file_id };
    if (msg.animation) return { type: 'video', src: 'tg', fileId: msg.animation.file_id };
    if (msg.document) {
      const isVid = (msg.document.mime_type || '').startsWith('video/');
      return { type: isVid ? 'document_video' : 'document', src: 'tg', fileId: msg.document.file_id };
    }
    if (msg.photo?.length) return { type: 'photo', src: 'tg', fileId: msg.photo.at(-1).file_id };
    return null;
  }

  who(msg) {
    const u = msg.from || msg.chat;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id);
    return {
      name,
      contact: u.username ? `@${u.username}` : `tg://user?id=${u.id}`,
      platformLabel: 'تلجرام',
    };
  }

  async onUpdate(u) {
    // رسائل حسابك الشخصي (Telegram Business)
    if (u.business_message) {
      const msg = u.business_message;
      const key = `tg:${msg.chat.id}`;
      if (msg.sender_business_bot) return; // رسالة البوت نفسه
      if (msg.from && msg.from.id !== msg.chat.id) return this.core.ownerTookOver(key); // انت اللي كتبت
      return this.core.onCustomer('tg', key, { chatId: msg.chat.id, bc: msg.business_connection_id }, this.who(msg),
        { text: msg.text || msg.caption || '', media: this.mediaOf(msg) });
    }

    const msg = u.message;
    if (!msg || msg.chat.type !== 'private') return;
    const text = msg.text || msg.caption || '';

    if (text === '/myid') return this.send({ chatId: msg.chat.id }, `رقمك على تلجرام: ${msg.from.id}`);

    if (this.ownerId && String(msg.from.id) === this.ownerId) return this.onOwner(msg, text);

    return this.core.onCustomer('tg', `tg:${msg.chat.id}`, { chatId: msg.chat.id }, this.who(msg),
      { text, media: this.mediaOf(msg) });
  }

  async onOwner(msg, text) {
    const me = { chatId: msg.chat.id };
    if (msg.reply_to_message) {
      if (!text) return this.send(me, 'بقدر أوصّل كتابة بس. اكتب ردك كنص.');
      const r = await this.core.ownerReply(`tg:${msg.reply_to_message.message_id}`, text);
      return this.send(me, r.ok ? `✅ وصلت لـ ${r.name || 'الزبون'}` : `❌ ${r.reason}`);
    }
    if (text === '/status') {
      const s = this.core.status();
      const lines = [`المحادثات: ${s.total}`, `البوت ساكت فيها هلأ: ${s.paused.length}`];
      for (const p of s.paused.slice(0, 30)) lines.push(`• ${p.name || '-'}  →  /resume ${p.key}`);
      return this.send(me, lines.join('\n'));
    }
    const m = text.match(/^\/(resume|pause)\s+(\S+)/);
    if (m) {
      if (m[1] === 'resume') this.core.resume(m[2]); else this.core.pause(m[2]);
      return this.send(me, m[1] === 'resume' ? '✅ البوت رجع يرد بهاي المحادثة' : '⏸️ البوت سكت بهاي المحادثة');
    }
    return this.send(me,
      'أهلين 👋 هون بتوصلك طلبات الزباين.\n' +
      '• اعمل Reply على أي إشعار عشان ترد على الزبون.\n' +
      '• /status تشوف المحادثات اللي البوت ساكت فيها.\n' +
      '• /resume <رقم المحادثة> يرجع البوت يرد.');
  }

  async start() {
    let me;
    for (;;) {
      try { me = await this.api('getMe'); break; } catch (e) {
        this.log(`[tg] ما قدرت أوصل لتلجرام (${e.message})، بجرب كمان 10 ثواني...`);
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
    this.log(`[tg] شغال: @${me.username}`);
    await this.api('setMyCommands', { commands: [{ command: 'start', description: 'القائمة' }] }).catch(() => {});
    for (;;) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset, timeout: 50,
          allowed_updates: ['message', 'business_message', 'business_connection'],
        });
        for (const u of updates) {
          this.offset = u.update_id + 1;
          try { await this.onUpdate(u); } catch (e) { this.log(`[tg-update-fail] ${e.message}`); }
        }
      } catch (e) {
        this.log(`[tg-poll] ${e.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}
