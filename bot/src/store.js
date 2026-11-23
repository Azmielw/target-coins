// تخزين بسيط بملف JSON: حالة كل محادثة، والإيقاف المؤقت، وربط إشعارات الإدارة بالزبون.
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.db = { chats: {}, notices: {} };
    try { this.db = { ...this.db, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch {}
    this._t = null;
  }

  chat(key) { return this.db.chats[key] || null; }

  setChat(key, value) { this.db.chats[key] = value; this.save(); }

  /** ربط رسالة الإشعار عند الإدارة بالزبون، عشان الـ Reply يوصله */
  linkNotice(noticeId, key) {
    this.db.notices[noticeId] = key;
    const ids = Object.keys(this.db.notices);
    if (ids.length > 5000) for (const id of ids.slice(0, ids.length - 5000)) delete this.db.notices[id];
    this.save();
  }

  noticeKey(noticeId) { return this.db.notices[noticeId] || null; }

  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, this.file);
    }, 200);
    this._t.unref?.();
  }
}
