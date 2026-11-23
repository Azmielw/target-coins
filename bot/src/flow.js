// منطق المحادثة. ما بيعرف إشي عن واتساب أو تلجرام:
// بياخد رسالة الزبون، وبيرجّع الردود وأي إشعار لازم يوصل لصاحب المحل.

import { T, KIND_LABEL } from './texts.js';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalize(text = '') {
  return String(text)
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[إأآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim()
    .toLowerCase();
}

export function pickMenu(text) {
  const t = normalize(text);
  if (/^[1١]\b|^1️⃣/.test(t)) return 'order';
  if (/^[2]\b|^2️⃣/.test(t)) return 'pubg';
  if (/^[3]\b|^3️⃣/.test(t)) return 'castle';
  if (/^[4]\b|^4️⃣/.test(t)) return 'human';
  if (/قلع/.test(t)) return 'castle';
  if (/ببجي|pubg/.test(t) && /(عرض|بيع|ابيع|بدي ابيع)/.test(t)) return 'pubg';
  if (/(عرض|ابيع|بيع).*(حساب)|(حساب).*(للبيع|ابيع)/.test(t)) return 'pubg';
  if (/(شحن|اشحن|اشتري|شراء|شدات|جواهر|كوينز|uc\b)/.test(t)) return 'order';
  if (/(اداره|ادمن|مسؤول|ازمي|موظف)/.test(t)) return 'human';
  return null;
}

export function isMenuRequest(text) {
  const t = normalize(text);
  return t === '0' || /^(القائمه|قائمه|منيو|menu|start|\/start|رجوع|ابدا)$/.test(t);
}

export function looksLikePassword(text) {
  const t = normalize(text);
  if (/(باسورد|باس|كلمه السر|كلمه المرور|password|pass\b|pwd)/.test(t)) return true;
  // إيميل وبعده كلمة ثانية بنفس الرسالة (غالباً إيميل وباسورد)
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text) && text.trim().split(/\s+/).length >= 2 &&
      /[^\s@]+@[^\s@]+\.[a-z]{2,}[\s\n:/|-]+\S{4,}/i.test(text)) return true;
  return false;
}

export function parsePrice(text) {
  const t = normalize(text);
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  return m ? text.trim() : null;
}

function fresh() {
  return { step: 'menu', kind: null, data: { videos: [], details: '', price: '', text: '' } };
}

/**
 * @param {object} state  حالة المحادثة (أو null إذا جديدة)
 * @param {{text?: string, media?: {type: string}}} msg
 * @returns {{state: object, replies: string[], notify: null | {kind, data, final: boolean}}}
 */
export function handle(state, msg) {
  const text = (msg.text || '').trim();
  const media = msg.media || null;
  const isVideo = media && (media.type === 'video' || media.type === 'document_video');
  const replies = [];
  let notify = null;
  let s = state && state.step ? structuredClone(state) : null;

  // محادثة جديدة: رحّب وإذا اختار من أول رسالة كمّل معه
  if (!s) {
    s = fresh();
    const kind = text ? pickMenu(text) : null;
    if (!kind) {
      replies.push(T.menu);
      return { state: s, replies, notify };
    }
    return startKind(s, kind, replies);
  }

  if (text && isMenuRequest(text)) {
    s = fresh();
    replies.push(T.menu);
    return { state: s, replies, notify };
  }

  if (text && looksLikePassword(text)) {
    replies.push(T.noPasswords);
    notify = { kind: 'password', data: { note: 'الزبون حاول يبعت إيميل/باسورد بالشات. تواصل معه بنفسك.' }, final: false };
    return { state: s, replies, notify };
  }

  switch (s.step) {
    case 'menu': {
      const kind = text ? pickMenu(text) : null;
      if (!kind) {
        replies.push(T.notUnderstood);
        return { state: s, replies, notify };
      }
      return startKind(s, kind, replies);
    }

    case 'order_text':
    case 'human_text': {
      if (!text && !media) { replies.push(T.notUnderstood); break; }
      s.data.text = text || '(بعت ملف/صورة)';
      if (media) s.data.videos.push(media);
      replies.push(s.kind === 'order' ? T.orderDone : T.humanDone);
      notify = { kind: s.kind, data: s.data, final: true };
      s = { ...fresh(), step: 'handed' };
      break;
    }

    case 'video': {
      if (!isVideo) {
        // إذا كتب التفاصيل قبل الفيديو، خزّنها وذكّره بالفيديو
        if (text && !s.data.details && text.length > 15) s.data.details = text;
        replies.push(T.needVideo);
        break;
      }
      s.data.videos.push(media);
      replies.push(s.kind === 'castle' ? T.castleVideoReminder : T.videoReceived);
      if (s.data.details) { s.step = 'price'; replies.push(T.askPrice); }
      else { s.step = 'details'; replies.push(T.askDetails); }
      break;
    }

    case 'details': {
      if (isVideo) { s.data.videos.push(media); replies.push(T.extraVideo); break; }
      if (!text) { replies.push(T.askDetails); break; }
      s.data.details = s.data.details ? `${s.data.details}\n${text}` : text;
      s.step = 'price';
      replies.push(T.askPrice);
      break;
    }

    case 'price': {
      if (isVideo) { s.data.videos.push(media); replies.push(T.extraVideo); break; }
      if (!text || !parsePrice(text)) { replies.push(T.priceInvalid); break; }
      s.data.price = text;
      replies.push(T.offerDone);
      notify = { kind: s.kind, data: s.data, final: true };
      s = { ...fresh(), step: 'handed' };
      break;
    }

    case 'handed':
    default: {
      // خلص الطلب والإدارة ماسكة الزبون. أي رسالة جديدة بتنبعت للإدارة.
      const kind = text ? pickMenu(text) : null;
      if (kind && /^[1-4]$/.test(normalize(text))) return startKind(fresh(), kind, replies);
      notify = { kind: 'followup', data: { text: text || '(ملف/صورة)', videos: media ? [media] : [] }, final: false };
      break;
    }
  }
  return { state: s, replies, notify };
}

function startKind(s, kind, replies) {
  s.kind = kind;
  if (kind === 'order') { s.step = 'order_text'; replies.push(T.orderAsk); }
  else if (kind === 'human') { s.step = 'human_text'; replies.push(T.humanAsk); }
  else { s.step = 'video'; replies.push(kind === 'castle' ? T.castleVideo : T.pubgVideo); }
  return { state: s, replies, notify: null };
}

/** نص الإشعار اللي بيوصل لصاحب المحل */
export function formatNotice({ kind, data }, who) {
  const head = {
    ...KIND_LABEL,
    password: '⚠️ زبون حاول يبعت باسورد',
    followup: '💬 رسالة جديدة من زبون',
  }[kind] || kind;
  const lines = [`🔔 ${head}`, `👤 ${who.name || '-'} (${who.platformLabel})`, `📞 ${who.contact}`];
  if (data.text) lines.push(`📝 ${data.text}`);
  if (data.details) lines.push(`📝 التفاصيل:\n${data.details}`);
  if (data.price) lines.push(`💰 السعر: ${data.price}`);
  if (data.videos?.length) lines.push(`🎥 فيديوهات: ${data.videos.length} (تحت)`);
  if (data.note) lines.push(data.note);
  lines.push('', '↩️ اعمل Reply على هاي الرسالة وأي إشي بتكتبه بيوصل للزبون.');
  return lines.join('\n');
}
