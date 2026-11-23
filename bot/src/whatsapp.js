// واتساب: بنربط رقمك كجهاز مرتبط (زي واتس ويب) عن طريق Baileys.
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage,
  fetchLatestBaileysVersion, jidNormalizedUser,
} from '@whiskeysockets/baileys';

const SKIP_JID = /(@g\.us|@broadcast|@newsletter)$/;

function unwrap(m) {
  let msg = m || {};
  for (let i = 0; i < 4; i++) {
    const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message || msg.editedMessage?.message;
    if (!inner) break;
    msg = inner;
  }
  return msg;
}

function textOf(msg) {
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption ||
    msg.videoMessage?.caption || msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedDisplayText || msg.listResponseMessage?.title || '';
}

export class WhatsApp {
  constructor({ core, dataDir, notifySelf = true, pairPhone = '', onPairCode, log = console.log }) {
    this.core = core;
    this.dataDir = dataDir;
    this.authDir = path.join(dataDir, 'wa-auth');
    this.mediaDir = path.join(dataDir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.notifySelf = notifySelf;
    this.pairPhone = pairPhone.replace(/\D/g, '');
    this.onPairCode = onPairCode;
    this.log = log;
    this.sentIds = new Set();
    this.startedAt = Math.floor(Date.now() / 1000);
    this.sock = null;
  }

  remember(id) {
    this.sentIds.add(id);
    if (this.sentIds.size > 5000) this.sentIds.delete(this.sentIds.values().next().value);
  }

  async send(ref, text) {
    const r = await this.sock.sendMessage(ref.jid, { text });
    if (r?.key?.id) this.remember(r.key.id);
    return r;
  }

  selfJid() { return this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : null; }

  /** ملخص لنفسك على الواتس (محادثة "أنا") */
  async notify(text, media = []) {
    if (!this.notifySelf || !this.sock?.user) return [];
    const me = this.selfJid();
    const ids = [];
    const r = await this.sock.sendMessage(me, { text });
    if (r?.key?.id) { this.remember(r.key.id); ids.push(`wa:${r.key.id}`); }
    for (const item of media) {
      if (item.src !== 'wa' || !item.path) continue;
      const v = await this.sock.sendMessage(me, item.type === 'photo'
        ? { image: { url: item.path } }
        : { video: { url: item.path }, mimetype: item.mime || 'video/mp4' });
      if (v?.key?.id) { this.remember(v.key.id); ids.push(`wa:${v.key.id}`); }
    }
    return ids;
  }

  async saveMedia(m, msg) {
    const kind = msg.videoMessage ? 'video' : msg.imageMessage ? 'photo'
      : msg.documentMessage ? ((msg.documentMessage.mimetype || '').startsWith('video/') ? 'document_video' : 'document') : null;
    if (!kind) return null;
    const mime = (msg.videoMessage || msg.imageMessage || msg.documentMessage).mimetype || '';
    const ext = kind === 'photo' ? 'jpg' : (mime.split('/')[1] || 'mp4').split(';')[0];
    const file = path.join(this.mediaDir, `${m.key.id}.${ext}`);
    try {
      const buf = await downloadMediaMessage(m, 'buffer', {}, { reuploadRequest: this.sock.updateMediaMessage });
      fs.writeFileSync(file, buf);
      return { type: kind, src: 'wa', path: file, mime };
    } catch (e) {
      this.log(`[wa-media-fail] ${e.message}`);
      return { type: kind, src: 'wa', path: null, mime };
    }
  }

  async onMessage(m) {
    const jid = m.key.remoteJid;
    if (!jid || SKIP_JID.test(jid) || !m.message) return;
    if (Number(m.messageTimestamp || 0) < this.startedAt - 60) return; // رسائل قديمة
    if (this.sentIds.has(m.key.id)) return; // رسالة البوت نفسه

    const msg = unwrap(m.message);
    if (msg.protocolMessage || msg.reactionMessage) return;
    const text = textOf(msg);
    const me = this.selfJid();

    if (m.key.fromMe) {
      if (jid === me || jidNormalizedUser(jid) === me) {
        // انت عملت Reply بمحادثة "أنا" على إشعار
        const quoted = msg.extendedTextMessage?.contextInfo?.stanzaId;
        if (quoted && text) {
          const r = await this.core.ownerReply(`wa:${quoted}`, text);
          await this.send({ jid: me }, r.ok ? `✅ وصلت لـ ${r.name || 'الزبون'}` : `❌ ${r.reason}`);
        }
        return;
      }
      return this.core.ownerTookOver(`wa:${jid}`); // انت رديت بإيدك
    }

    const media = await this.saveMedia(m, msg);
    const phoneJid = m.key.senderPn || m.key.remoteJidAlt || (jid.endsWith('@s.whatsapp.net') ? jid : null);
    const who = {
      name: m.pushName || '',
      contact: phoneJid ? `+${phoneJid.split('@')[0]}  wa.me/${phoneJid.split('@')[0]}` : 'شوفه بالواتس (الرقم مخفي)',
      platformLabel: 'واتساب',
    };
    await this.core.onCustomer('wa', `wa:${jid}`, { jid }, who, { text, media });
  }

  async start() {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
    const sock = makeWASocket({
      auth: state, version, logger: pino({ level: 'warn' }),
      browser: ['TARGET COINS Bot', 'Chrome', '1.0'], markOnlineOnConnect: false, syncFullHistory: false,
    });
    this.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    let askedPair = false;
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        if (this.pairPhone && !askedPair && !sock.authState.creds.registered) {
          askedPair = true;
          try {
            const code = await sock.requestPairingCode(this.pairPhone);
            this.log(`[wa] كود الربط: ${code}  (واتساب ← الأجهزة المرتبطة ← ربط جهاز ← الربط برقم الهاتف)`);
            this.onPairCode?.(code);
          } catch (e) { this.log(`[wa-pair-fail] ${e.message}`); }
        } else if (!this.pairPhone) {
          this.log('[wa] امسح الكود من واتساب ← الأجهزة المرتبطة ← ربط جهاز:');
          qrcode.generate(qr, { small: true });
        }
      }
      if (connection === 'open') this.log(`[wa] شغال على ${this.selfJid()}`);
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          this.log('[wa] انفصل الربط. امسح مجلد data/wa-auth وشغّل من جديد عشان تربط مرة ثانية.');
          return;
        }
        this.log(`[wa] انقطع (${code ?? '?'})، برجع أوصل...`);
        setTimeout(() => this.start().catch((e) => this.log(`[wa-start-fail] ${e.message}`)), 3000);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const m of messages) {
        try { await this.onMessage(m); } catch (e) { this.log(`[wa-msg-fail] ${e.message}`); }
      }
    });
  }
}
