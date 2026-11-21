/**
 * ============================================================
 *  曲库模块（SongLibrary）
 *  曲库来源：
 *   1) 内置歌曲包：library/manifest.js 列出的 library/songs/*.js，
 *      每个文件调用 KTV.registerSong({...}) 注册一首歌（音频 base64 内嵌）
 *   2) 用户上传：应用内「上传歌曲 / 批量导入」，保存到浏览器 IndexedDB，刷新后仍在
 *
 *  歌曲对象结构（预留接口，替换/新增歌曲按此格式即可）：
 *  {
 *    id: 'demo01',               // 唯一 ID
 *    title: '歌名', artist: '歌手', album: '专辑',
 *    tags: ['hot','pop'],        // 分类：hot 热门 / pop 流行 / guofeng 国风 / folk 民谣 / oldies 老歌 / english 英文歌
 *    duration: 68.5,             // 秒（可选）
 *    cover: 'assets/..svg',      // 封面：路径 / data URL / Blob（可选）
 *    lrc: '[00:01.00]歌词...',   // LRC 文本（支持逐字格式）
 *    original: 'data:audio/mpeg;base64,...' | Blob,      // 原唱音频
 *    instrumental: 'data:audio/mpeg;base64,...' | Blob   // 伴奏音频（独立音轨，可选）
 *  }
 * ============================================================
 */
(function (global) {
  'use strict';
  const U = global.KTVUtils;

  const CATEGORIES = [
    { id: 'hot', name: '热门歌曲' },
    { id: 'all', name: '全部' },
    { id: 'pop', name: '流行' },
    { id: 'guofeng', name: '国风' },
    { id: 'folk', name: '民谣' },
    { id: 'oldies', name: '老歌' },
    { id: 'english', name: '英文歌' },
    { id: 'custom', name: '我的上传' },
    { id: 'fav', name: '收藏' },
  ];
  const TAG_NAMES = { hot: '热门', pop: '流行', guofeng: '国风', folk: '民谣', oldies: '老歌', english: '英文' };

  const pending = [];
  // 歌曲包文件调用的全局注册接口
  global.KTV = global.KTV || {};
  global.KTV.registerSong = (song) => { pending.push(song); if (global.KTV._lib) global.KTV._lib._add(song, false); };

  function loadScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => resolve(true);
      s.onerror = () => { console.warn('[曲库] 歌曲包加载失败：', src); resolve(false); };
      document.head.appendChild(s);
    });
  }

  class SongLibrary extends EventTarget {
    constructor() {
      super();
      this.songs = new Map();
      this.favs = new Set(U.prefs.get('favs', []));
      global.KTV._lib = this;
    }

    _add(song, custom) {
      const s = Object.assign({ tags: [], album: '' }, song);
      s.custom = !!custom;
      if (s.custom && !s.tags.includes('custom')) s.tags = s.tags.concat('custom');
      if (s.cover instanceof Blob) s.coverUrl = URL.createObjectURL(s.cover);
      else s.coverUrl = s.cover || U.makeCover(s.title, s.artist);
      s.hasAccompaniment = !!s.instrumental;
      s._search = [s.title, s.artist, U.initials(s.title), U.initials(s.artist), U.wordInitials(s.title)].join(' ').toLowerCase();
      this.songs.set(s.id, s);
      return s;
    }

    /** 加载全部曲库（内置歌曲包 + IndexedDB 自定义歌曲） */
    async loadAll(onProgress) {
      pending.splice(0).forEach((s) => this._add(s, false));
      const list = global.KTV_LIBRARY_MANIFEST || [];
      let done = 0;
      for (const f of list) {
        await loadScript('library/songs/' + f);
        done++; onProgress && onProgress(done, list.length);
      }
      pending.splice(0).forEach((s) => this._add(s, false));
      try {
        const custom = await U.store.all('songs');
        custom.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)).forEach((s) => this._add(s, true));
      } catch (e) { console.warn('[曲库] 读取本地上传歌曲失败', e); }
      this.dispatchEvent(new Event('change'));
    }

    get(id) { return this.songs.get(id); }
    list() { return Array.from(this.songs.values()); }

    /** 搜索 + 分类筛选 */
    query(keyword, cat) {
      const kw = String(keyword || '').trim().toLowerCase();
      let arr = this.list();
      if (cat === 'fav') arr = arr.filter((s) => this.favs.has(s.id));
      else if (cat && cat !== 'all') arr = arr.filter((s) => s.tags.includes(cat));
      if (kw) arr = arr.filter((s) => kw.split(/\s+/).every((k) => s._search.includes(k)));
      return arr;
    }

    isFav(id) { return this.favs.has(id); }
    toggleFav(id) {
      this.favs.has(id) ? this.favs.delete(id) : this.favs.add(id);
      U.prefs.set('favs', Array.from(this.favs));
      this.dispatchEvent(new Event('change'));
      return this.favs.has(id);
    }

    /** 新增/更新自定义歌曲（持久化到 IndexedDB） */
    async saveCustom(song) {
      const rec = {
        id: song.id || 'u_' + U.uid(), title: song.title, artist: song.artist || '未知歌手', album: song.album || '',
        tags: (song.tags || []).filter((t) => t !== 'custom'), lrc: song.lrc || '', duration: song.duration || 0,
        original: song.original, instrumental: song.instrumental || null, cover: song.cover || null,
        addedAt: song.addedAt || Date.now(),
      };
      await U.store.put('songs', rec);
      const old = this.songs.get(rec.id);
      if (old && old.coverUrl && old.coverUrl.startsWith('blob:')) URL.revokeObjectURL(old.coverUrl);
      const s = this._add(rec, true);
      this.dispatchEvent(new Event('change'));
      return s;
    }
    async removeCustom(id) {
      await U.store.del('songs', id);
      this.songs.delete(id);
      this.favs.delete(id);
      this.dispatchEvent(new Event('change'));
    }

    /** 导出为歌曲包 .js（放入 library/songs/ 并登记到 manifest.js 后即成为内置歌曲） */
    async exportPack(id) {
      const s = this.get(id);
      const toUrl = async (v) => (v instanceof Blob ? await U.blobToDataURL(v) : v);
      const meta = { id: s.id, title: s.title, artist: s.artist, album: s.album || '', tags: s.tags.filter((t) => t !== 'custom'), duration: s.duration || 0 };
      const cover = s.cover ? await toUrl(s.cover) : null;
      const label = `${s.artist} - ${s.title}`.replace(/\*\//g, '* /').replace(/[\r\n\u2028\u2029]/g, ' ');
      const js = `/* KTV 歌曲包：${label} */\nKTV.registerSong(Object.assign(${JSON.stringify(meta)}, {\n` +
        (cover ? `  cover: ${JSON.stringify(cover)},\n` : '') +
        `  lrc: ${JSON.stringify(s.lrc || '')},\n  original: ${JSON.stringify(await toUrl(s.original))},\n` +
        `  instrumental: ${JSON.stringify(s.instrumental ? await toUrl(s.instrumental) : null)}\n}));\n`;
      return new Blob([js], { type: 'application/javascript' });
    }
  }

  SongLibrary.CATEGORIES = CATEGORIES;
  SongLibrary.TAG_NAMES = TAG_NAMES;
  global.KTVLibrary = { SongLibrary, CATEGORIES, TAG_NAMES };
})(window);
