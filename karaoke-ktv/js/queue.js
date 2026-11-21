/**
 * ============================================================
 *  已点歌曲队列（PlayQueue）
 *  - 点歌：加入队尾；优先：置顶；删除；清空
 *  - 已唱列表（history），支持"上一首"回唱
 *  - 播放模式：顺序播放 / 单曲循环 / 列表循环
 * ============================================================
 */
(function (global) {
  'use strict';
  const U = global.KTVUtils;
  const MODES = [
    { id: 'sequence', name: '顺序播放' },
    { id: 'repeat-one', name: '单曲循环' },
    { id: 'repeat-all', name: '列表循环' },
  ];

  class PlayQueue extends EventTarget {
    constructor() {
      super();
      this.items = U.prefs.get('queue', []);   // [{uid, songId}]
      this.history = U.prefs.get('history', []);
      this.current = null;
      this.mode = U.prefs.get('playMode', 'sequence');
    }
    _changed() {
      U.prefs.set('queue', this.items);
      U.prefs.set('history', this.history.slice(0, 50));
      this.dispatchEvent(new Event('change'));
    }
    /** 过滤掉曲库中已不存在的歌曲 */
    sanitize(lib) {
      this.items = this.items.filter((i) => lib.get(i.songId));
      this.history = this.history.filter((i) => lib.get(i.songId));
      this._changed();
    }
    add(songId, top = false) {
      const it = { uid: U.uid(), songId };
      top ? this.items.unshift(it) : this.items.push(it);
      this._changed();
      return it;
    }
    remove(uid) { this.items = this.items.filter((i) => i.uid !== uid); this._changed(); }
    top(uid) {
      const i = this.items.findIndex((x) => x.uid === uid);
      if (i > 0) { const [it] = this.items.splice(i, 1); this.items.unshift(it); this._changed(); }
    }
    clear() { this.items = []; this._changed(); }
    clearHistory() { this.history = []; this._changed(); }
    countOf(songId) { return this.items.filter((i) => i.songId === songId).length; }

    /** 切到下一首：返回下一首 item（无则 null） */
    next({ finished = false } = {}) {
      const cur = this.current;
      if (cur) {
        this.history.unshift({ uid: U.uid(), songId: cur.songId, at: Date.now() });
        if (finished && this.mode === 'repeat-one') { this._changed(); return cur; }
        if (this.mode === 'repeat-all') this.items.push({ uid: U.uid(), songId: cur.songId });
      }
      this.current = this.items.shift() || null;
      this._changed();
      return this.current;
    }
    /** 上一首：从已唱列表取回，当前歌曲放回队首 */
    prev() {
      const last = this.history.shift();
      if (!last) return null;
      if (this.current) this.items.unshift({ uid: U.uid(), songId: this.current.songId });
      this.current = { uid: U.uid(), songId: last.songId };
      this._changed();
      return this.current;
    }
    playNow(songId) {
      if (this.current) this.history.unshift({ uid: U.uid(), songId: this.current.songId, at: Date.now() });
      this.current = { uid: U.uid(), songId };
      this._changed();
      return this.current;
    }
    cycleMode() {
      const i = MODES.findIndex((m) => m.id === this.mode);
      this.mode = MODES[(i + 1) % MODES.length].id;
      U.prefs.set('playMode', this.mode);
      this.dispatchEvent(new Event('change'));
      return this.mode;
    }
    modeName() { return (MODES.find((m) => m.id === this.mode) || MODES[0]).name; }
  }
  PlayQueue.MODES = MODES;
  global.KTVQueue = { PlayQueue, MODES };
})(window);
