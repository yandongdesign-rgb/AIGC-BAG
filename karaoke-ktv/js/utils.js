/**
 * ============================================================
 *  通用工具：时间格式化、拼音首字母、IndexedDB 存储、下载等
 * ============================================================
 */
(function (global) {
  'use strict';
  const U = {};

  U.fmtTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  U.hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

  /* ---------- 拼音首字母（KTV 拼音点歌），利用浏览器内置中文排序规则 ---------- */
  const PY_LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ';
  const PY_BOUND = '阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀';
  let collator = null;
  try { collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin'); } catch (e) {}
  U.initials = (str) => {
    let out = '';
    for (const ch of String(str || '')) {
      if (/[a-z0-9]/i.test(ch)) { out += ch.toUpperCase(); continue; }
      if (!collator || !/[\u4e00-\u9fa5]/.test(ch)) continue;
      for (let i = PY_BOUND.length - 1; i >= 0; i--) {
        if (collator.compare(ch, PY_BOUND[i]) >= 0) { out += PY_LETTERS[i]; break; }
      }
    }
    return out;
  };
  // 英文歌按单词首字母
  U.wordInitials = (str) => String(str || '').split(/\s+/).map((w) => (w[0] || '').toUpperCase()).join('');

  /* ---------- 下载 ---------- */
  U.download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  U.blobToDataURL = (blob) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
  });
  /** 读取歌词文本：自动识别 UTF-8 / GBK 编码 */
  U.readText = async (file) => {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder('gbk').decode(buf); } catch (e2) { return new TextDecoder().decode(buf); } }
  };
  U.safeName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_');

  /* ---------- 生成默认封面（SVG data URL） ---------- */
  U.makeCover = (title, artist) => {
    const pal = [['#ff5fd2', '#5b6cff'], ['#3fe0c5', '#2a4d8f'], ['#ffb347', '#a0336b'], ['#00e5ff', '#7c3aed'], ['#f6d365', '#fd6585'], ['#8ec5fc', '#e0c3fc']];
    const [a, b] = pal[U.hash(title + artist) % pal.length];
    const t = U.esc(title).slice(0, 12);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="300" height="300" fill="#0b1026"/><rect width="300" height="300" fill="url(#g)" opacity=".85"/><g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"><circle cx="210" cy="95" r="58"/><circle cx="210" cy="95" r="38"/></g><circle cx="210" cy="95" r="8" fill="#fff" fill-opacity=".6"/><path d="M0 230 Q75 190 150 228 T300 222 V300 H0 Z" fill="#000" fill-opacity=".28"/><text x="24" y="246" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="28" font-weight="700" fill="#fff">${t}</text><text x="24" y="274" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="16" fill="#fff" fill-opacity=".8">${U.esc(artist).slice(0, 18)}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };

  /* ---------- IndexedDB 简易封装（自定义歌曲、录音、背景持久化） ---------- */
  const DB_NAME = 'ktv-studio-db', DB_VER = 1;
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('浏览器不支持 IndexedDB'));
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('recordings')) d.createObjectStore('recordings', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  const tx = async (store, mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  };
  U.store = {
    all: (store) => tx(store, 'readonly', (s) => s.getAll()),
    get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
    put: (store, val, key) => tx(store, 'readwrite', (s) => (key !== undefined ? s.put(val, key) : s.put(val))),
    del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  };

  /* ---------- localStorage 设置 ---------- */
  U.prefs = {
    get(k, def) { try { const v = localStorage.getItem('ktv.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('ktv.' + k, JSON.stringify(v)); } catch (e) {} },
  };

  global.KTVUtils = U;
})(window);
