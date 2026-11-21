/**
 * ============================================================
 *  UI 模块：点歌台（SongPicker）、已点/已唱/录音面板（QueuePanel）、
 *  上传歌曲弹窗（UploadDialog）、背景弹窗、设置弹窗、Toast 提示
 * ============================================================
 */
(function (global) {
  'use strict';
  const U = global.KTVUtils;
  const { $, $$, esc, fmtTime } = U;
  const { CATEGORIES, TAG_NAMES } = global.KTVLibrary;

  /* ---------------- 通用 ---------------- */
  const UI = {
    toast(msg, type = 'info', ms = 2400) {
      const el = document.createElement('div');
      el.className = 'toast ' + type; el.textContent = msg;
      $('#toasts').appendChild(el);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
    },
    openModal(id) { $('#' + id).classList.remove('hidden'); },
    closeModal(id) { $('#' + id).classList.add('hidden'); },
    initModals() {
      $$('.modal').forEach((m) => {
        m.addEventListener('mousedown', (e) => { if (e.target === m) m.classList.add('hidden'); });
        $$('[data-close]', m).forEach((b) => b.addEventListener('click', () => m.classList.add('hidden')));
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal').forEach((m) => m.classList.add('hidden')); });
    },
    setRange(input, v) { input.value = v; UI.paintRange(input); },
    paintRange(input) { input.style.setProperty('--p', ((input.value - input.min) / (input.max - input.min)) * 100 + '%'); },
    seg(root, value, onChange) {
      const btns = $$('button', root);
      const set = (v) => btns.forEach((b) => b.classList.toggle('on', (b.dataset.v || b.dataset.u || b.dataset.mode || b.dataset.tab) === v));
      set(value);
      btns.forEach((b) => b.addEventListener('click', () => { const v = b.dataset.v || b.dataset.u || b.dataset.mode || b.dataset.tab; set(v); onChange && onChange(v); }));
      return set;
    },
  };

  /* ---------------- 点歌台 ---------------- */
  class SongPicker {
    constructor(app) {
      this.app = app;
      this.cat = 'hot';
      this.kw = '';
      this.input = $('#searchInput');
      this.listEl = $('#songList');
      $('#cats').innerHTML = CATEGORIES.map((c) => `<button class="cat" data-cat="${c.id}">${c.name}</button>`).join('');
      $$('#cats .cat').forEach((b) => b.addEventListener('click', () => { this.cat = b.dataset.cat; this.render(); }));
      let timer;
      this.input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { this.kw = this.input.value; this.render(); }, 120);
        $('#searchClear').classList.toggle('hidden', !this.input.value);
      });
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const first = this.results && this.results[0]; if (first) app.orderSong(first.id); }
      });
      $('#searchClear').addEventListener('click', () => { this.input.value = ''; this.kw = ''; $('#searchClear').classList.add('hidden'); this.render(); this.input.focus(); });
      this.listEl.addEventListener('click', (e) => this._onClick(e));
    }

    _onClick(e) {
      const card = e.target.closest('.song-card');
      if (!card) return;
      const id = card.dataset.id;
      const act = e.target.closest('[data-act]');
      const a = act ? act.dataset.act : 'add';
      const app = this.app;
      if (a === 'add') app.orderSong(id);
      else if (a === 'top') app.orderSong(id, true);
      else if (a === 'play') app.playNow(id);
      else if (a === 'fav') { const on = app.lib.toggleFav(id); UI.toast(on ? '已加入收藏' : '已取消收藏', 'ok', 1500); }
      else if (a === 'edit') app.upload.open(app.lib.get(id));
      else if (a === 'export') app.exportSong(id);
      else if (a === 'del') app.deleteSong(id);
    }

    render() {
      const lib = this.app.lib;
      $$('#cats .cat').forEach((b) => b.classList.toggle('on', b.dataset.cat === this.cat));
      const res = this.results = lib.query(this.kw, this.kw ? 'all' : this.cat);
      const catName = (CATEGORIES.find((c) => c.id === this.cat) || {}).name;
      $('#listTitle').textContent = this.kw ? `搜索 “${this.kw.trim()}”` : catName;
      $('#listCount').textContent = `${res.length} 首`;
      $('#libCount').textContent = `曲库 ${lib.list().length} 首`;
      if (!res.length) {
        const msg = this.cat === 'fav' && !this.kw ? '还没有收藏歌曲<br>点击歌曲上的 ♡ 即可收藏'
          : this.cat === 'custom' && !this.kw ? '还没有上传歌曲<br>点击右上角「上传歌曲」补充曲库' : '没有找到相关歌曲<br>试试歌名、歌手或拼音首字母';
        this.listEl.innerHTML = `<div class="empty"><b>♪</b>${msg}</div>`;
        return;
      }
      this.listEl.innerHTML = res.map((s, i) => this._card(s, i)).join('');
      this.refreshMarks();
    }

    _card(s, i) {
      const fav = this.app.lib.isFav(s.id);
      const tags = s.tags.filter((t) => TAG_NAMES[t] && t !== 'hot').slice(0, 1).map((t) => `<span>${TAG_NAMES[t]}</span>`).join('');
      return `<div class="song-card" data-id="${esc(s.id)}" style="animation-delay:${Math.min(i, 12) * 0.03}s" title="点击点歌">
        <div class="song-cover"><img src="${esc(s.coverUrl)}" alt="" loading="lazy" /><div class="eq"><i></i><i></i><i></i></div></div>
        <div class="song-info">
          <div class="song-title">${esc(s.title)}</div>
          <div class="song-meta">
            <span class="artist">${esc(s.artist)}</span>
            <span>${s.duration ? fmtTime(s.duration) : '--:--'}</span>
            ${s.hasAccompaniment ? '<span class="badge acc">伴奏</span>' : '<span class="badge noacc" title="无独立伴奏，将自动生成消音伴奏">消音</span>'}
            ${s.tags.includes('hot') ? '<span class="badge hot">HOT</span>' : ''}
            <span class="badge queued hidden" data-q></span>
          </div>
        </div>
        <div class="song-actions">
          ${s.custom ? `<button class="ibtn" data-act="edit" title="编辑"><svg><use href="#i-edit"/></svg></button>
            <button class="ibtn" data-act="export" title="导出歌曲包"><svg><use href="#i-export"/></svg></button>
            <button class="ibtn danger" data-act="del" title="删除"><svg><use href="#i-trash"/></svg></button>` : ''}
          <button class="ibtn fav ${fav ? 'on' : ''}" data-act="fav" title="收藏"><svg><use href="#i-heart${fav ? '-fill' : ''}"/></svg></button>
          <button class="ibtn" data-act="play" title="立即演唱"><svg><use href="#i-play"/></svg></button>
          <button class="ibtn" data-act="top" title="优先（置顶）"><svg><use href="#i-top"/></svg></button>
          <button class="ibtn add" data-act="add" title="点歌"><svg><use href="#i-plus"/></svg></button>
        </div>
      </div>`;
    }

    /** 刷新"已点/正在播放"标识（不重绘列表） */
    refreshMarks() {
      const q = this.app.queue, cur = q.current && q.current.songId;
      $$('.song-card', this.listEl).forEach((c) => {
        const id = c.dataset.id, n = q.countOf(id);
        c.classList.toggle('playing', id === cur);
        const b = $('[data-q]', c);
        b.classList.toggle('hidden', !n);
        b.textContent = n > 1 ? `已点×${n}` : '已点';
      });
    }
  }

  /* ---------------- 已点 / 已唱 / 录音 ---------------- */
  class QueuePanel {
    constructor(app) {
      this.app = app;
      this.tab = 'queue';
      this.records = [];
      this.urls = new Map();
      this.setTab = UI.seg($('#qtabs'), 'queue', (v) => { this.tab = v; this.render(); });
      $('#qClear').addEventListener('click', () => {
        if (this.tab === 'queue') { if (app.queue.items.length) { app.queue.clear(); UI.toast('已清空已点列表'); } }
        else if (this.tab === 'history') app.queue.clearHistory();
      });
      $('#qlist').addEventListener('click', (e) => this._onClick(e));
      const main = $('#main');
      if (U.prefs.get('queueCollapsed', false)) main.classList.add('queue-collapsed');
      $('#queueToggle').addEventListener('click', () => {
        main.classList.toggle('queue-collapsed');
        U.prefs.set('queueCollapsed', main.classList.contains('queue-collapsed'));
        setTimeout(() => window.dispatchEvent(new Event('resize')), 480);
      });
    }

    async loadRecords() {
      try { this.records = (await U.store.all('recordings')).sort((a, b) => b.createdAt - a.createdAt); } catch (e) { this.records = []; }
      this.render();
    }
    async addRecord(rec) { await U.store.put('recordings', rec); this.records.unshift(rec); this.render(); }
    async delRecord(id) {
      await U.store.del('recordings', id);
      this.records = this.records.filter((r) => r.id !== id);
      if (this.urls.has(id)) { URL.revokeObjectURL(this.urls.get(id)); this.urls.delete(id); }
      this.render();
    }

    _onClick(e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const row = btn.closest('[data-uid],[data-rid],[data-sid]');
      const app = this.app, act = btn.dataset.act;
      if (act === 'top') app.queue.top(row.dataset.uid);
      else if (act === 'del') app.queue.remove(row.dataset.uid);
      else if (act === 'again') app.orderSong(row.dataset.sid);
      else if (act === 'wav') app.downloadRecord(row.dataset.rid, 'wav');
      else if (act === 'raw') app.downloadRecord(row.dataset.rid, 'raw');
      else if (act === 'rdel') this.delRecord(row.dataset.rid);
    }

    render() {
      const app = this.app, q = app.queue, lib = app.lib;
      $('#qCount').textContent = q.items.length;
      $('#queueBadge').textContent = q.items.length;
      $('#rCount').textContent = this.records.length;
      const list = $('#qlist');
      $('#qClear').classList.toggle('hidden', this.tab === 'records');
      $('#qHint').textContent = { queue: '点击「优先」可将歌曲置顶', history: '最近演唱过的歌曲', records: '演唱录音保存在本机浏览器' }[this.tab];
      const row = (s, extra, cls = '', num = '') => `
        <img src="${esc(s.coverUrl)}" alt="" />
        <div class="qinfo"><b>${esc(s.title)}</b><small>${esc(s.artist)}${extra || ''}</small></div>`;
      if (this.tab === 'queue') {
        let html = '';
        const cur = q.current && lib.get(q.current.songId);
        if (cur) html += `<div class="qitem now"><span class="qnum">♪</span>${row(cur, ' · <span class="now-tag">正在演唱</span>')}<span></span></div>`;
        html += q.items.map((it, i) => {
          const s = lib.get(it.songId); if (!s) return '';
          return `<div class="qitem" data-uid="${it.uid}"><span class="qnum">${String(i + 1).padStart(2, '0')}</span>${row(s)}
            <div class="qactions">${i > 0 ? '<button class="ibtn txt" data-act="top" title="优先">优先</button>' : ''}
            <button class="ibtn danger" data-act="del" title="删除"><svg><use href="#i-trash"/></svg></button></div></div>`;
        }).join('');
        list.innerHTML = html || '<div class="empty"><b>♪</b>还没有点歌<br>在左侧点歌台选择歌曲吧</div>';
      } else if (this.tab === 'history') {
        list.innerHTML = q.history.map((it, i) => {
          const s = lib.get(it.songId); if (!s) return '';
          return `<div class="qitem" data-sid="${esc(s.id)}"><span class="qnum">${i + 1}</span>${row(s)}
            <div class="qactions"><button class="ibtn txt" data-act="again">再点</button></div></div>`;
        }).join('') || '<div class="empty"><b>♪</b>暂无演唱记录</div>';
      } else {
        list.innerHTML = this.records.map((r) => {
          if (!this.urls.has(r.id)) this.urls.set(r.id, URL.createObjectURL(r.blob));
          const d = new Date(r.createdAt);
          return `<div class="rec-item" data-rid="${r.id}"><b>${esc(r.name)}</b>
            <small>${d.toLocaleDateString()} ${d.toLocaleTimeString().slice(0, 5)} · 时长 ${fmtTime(r.duration)}</small>
            <audio controls preload="none" src="${this.urls.get(r.id)}"></audio>
            <div class="rec-ops"><button class="ibtn" data-act="wav"><svg><use href="#i-download"/></svg>下载 WAV</button>
            <button class="ibtn" data-act="raw"><svg><use href="#i-download"/></svg>下载 ${r.ext.toUpperCase()}</button>
            <button class="ibtn danger" data-act="rdel" title="删除"><svg><use href="#i-trash"/></svg></button></div></div>`;
        }).join('') || '<div class="empty"><b>●</b>暂无录音<br>演唱时点击底部「录音」即可录制<br>（人声 + 伴奏混音）</div>';
      }
    }
  }

  /* ---------------- 上传歌曲 ---------------- */
  const INST_RE = /[\s_\-—.]*[(（\[【]?(伴奏|伴唱|消音|纯音乐|instrumental|inst|karaoke|off[\s_-]?vocal|accompaniment|backing)[)）\]】]?$/i;
  const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'webm', 'wma'];
  const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'];
  const splitName = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? [n.slice(0, i), n.slice(i + 1).toLowerCase()] : [n, '']; };
  /** 文件名 "歌手 - 歌名" → {artist, title} */
  const parseFileName = (base) => {
    const m = base.split(/\s+[-—–]\s+|\s*[-—–]\s*/);
    if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
    return { artist: '', title: base.trim() };
  };

  class UploadDialog {
    constructor(app) {
      this.app = app;
      this.mode = 'single';
      this.tags = new Set();
      this.files = {};
      this.batch = [];
      this.setSeg = UI.seg($('#uploadSeg'), 'single', (v) => this._mode(v));
      const tagIds = ['hot', 'pop', 'guofeng', 'folk', 'oldies', 'english'];
      $('#fTags').innerHTML = tagIds.map((t) => `<button data-t="${t}">${TAG_NAMES[t]}</button>`).join('');
      $$('#fTags button').forEach((b) => b.addEventListener('click', () => {
        this.tags.has(b.dataset.t) ? this.tags.delete(b.dataset.t) : this.tags.add(b.dataset.t);
        b.classList.toggle('on', this.tags.has(b.dataset.t));
      }));
      ['fOrig', 'fInst', 'fLrc', 'fCover'].forEach((id) => {
        const inp = $('#' + id);
        inp.addEventListener('change', () => this._pick(id, inp.files[0]));
        const drop = inp.closest('.file-drop');
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
        drop.addEventListener('drop', () => drop.classList.remove('drag'));
      });
      $('#fBatch').addEventListener('change', (e) => this._batchPick(Array.from(e.target.files)));
      $('#uploadSave').addEventListener('click', () => (this.mode === 'single' ? this._saveSingle() : this._saveBatch()));
    }

    _mode(v) {
      this.mode = v;
      $$('[data-u-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.uPane !== v));
      $('#uploadMsg').textContent = '';
    }

    open(editSong) {
      this.edit = editSong || null;
      this.files = {}; this.tags = new Set(editSong ? editSong.tags.filter((t) => t !== 'custom') : []);
      $('#uploadTitle').textContent = editSong ? '编辑歌曲' : '上传歌曲';
      $('#uploadSeg').classList.toggle('hidden', !!editSong);
      this.setSeg('single'); this._mode('single');
      $('#fTitle').value = editSong ? editSong.title : '';
      $('#fArtist').value = editSong ? editSong.artist : '';
      $$('#fTags button').forEach((b) => b.classList.toggle('on', this.tags.has(b.dataset.t)));
      ['fOrig', 'fInst', 'fLrc', 'fCover'].forEach((id) => {
        const inp = $('#' + id); inp.value = '';
        const drop = inp.closest('.file-drop'); drop.classList.remove('filled');
        const em = $('[data-name]', drop); em.textContent = em.dataset.def || (em.dataset.def = em.textContent);
        if (editSong) {
          const has = { fOrig: editSong.original, fInst: editSong.instrumental, fLrc: editSong.lrc, fCover: editSong.cover }[id];
          if (has) { drop.classList.add('filled'); em.textContent = '已有文件（重新选择可替换）'; }
        }
      });
      this.batch = []; $('#batchList').innerHTML = ''; $('#fBatch').value = '';
      $('#uploadMsg').textContent = '';
      UI.openModal('uploadModal');
    }

    async _pick(id, file) {
      if (!file) return;
      this.files[id] = file;
      const drop = $('#' + id).closest('.file-drop');
      drop.classList.add('filled');
      $('[data-name]', drop).textContent = file.name;
      const [base] = splitName(file.name);
      if (id === 'fOrig' && !$('#fTitle').value) {
        const p = parseFileName(base.replace(INST_RE, ''));
        $('#fTitle').value = p.title; if (!$('#fArtist').value) $('#fArtist').value = p.artist;
      }
      if (id === 'fLrc') {
        const text = await U.readText(file);
        this.files.lrcText = text;
        const meta = global.KTVLyrics.parseLRC(text).meta;
        if (meta.ti && !$('#fTitle').value) $('#fTitle').value = meta.ti;
        if (meta.ar && !$('#fArtist').value) $('#fArtist').value = meta.ar;
      }
    }

    async _probeDuration(file) {
      await this.app.engine.init();
      const buf = await this.app.engine.ctx.decodeAudioData(await file.arrayBuffer());
      return buf.duration;
    }

    async _saveSingle() {
      const title = $('#fTitle').value.trim();
      const msg = $('#uploadMsg');
      if (!title) { msg.textContent = '请填写歌名'; return; }
      if (!this.files.fOrig && !(this.edit && this.edit.original)) { msg.textContent = '请选择原唱音频文件'; return; }
      const btn = $('#uploadSave'); btn.disabled = true;
      try {
        msg.textContent = '正在解析音频…';
        const song = this.edit ? {
          id: this.edit.id, original: this.edit.original, instrumental: this.edit.instrumental, cover: this.edit.cover,
          lrc: this.edit.lrc, duration: this.edit.duration, addedAt: this.edit.addedAt,
        } : {};
        if (this.files.fOrig) { song.original = this.files.fOrig; song.duration = await this._probeDuration(this.files.fOrig); }
        if (this.files.fInst) { await this._probeDuration(this.files.fInst); song.instrumental = this.files.fInst; }
        if (this.files.fLrc) song.lrc = this.files.lrcText || (await U.readText(this.files.fLrc));
        if (this.files.fCover) song.cover = this.files.fCover;
        Object.assign(song, { title, artist: $('#fArtist').value.trim() || '未知歌手', tags: Array.from(this.tags) });
        const s = await this.app.lib.saveCustom(song);
        if (this.edit) this.app.engine.decodeCache.clear();
        UI.closeModal('uploadModal');
        UI.toast(`${this.edit ? '已更新' : '已添加到曲库'}：${s.title}`, 'ok');
        this.app.picker.cat = 'custom'; this.app.picker.render();
      } catch (e) {
        console.error(e);
        msg.textContent = '音频解析失败，请确认文件格式（' + (e.message || e) + '）';
      } finally { btn.disabled = false; }
    }

    async _batchPick(files) {
      const groups = new Map();
      const get = (key, disp) => { if (!groups.has(key)) groups.set(key, { key, disp, files: {} }); return groups.get(key); };
      for (const f of files) {
        const [base, ext] = splitName(f.name);
        const isAudio = AUDIO_EXT.includes(ext) || (f.type || '').startsWith('audio');
        if (isAudio) {
          const inst = INST_RE.test(base);
          const disp = base.replace(INST_RE, '').trim();
          get(disp.toLowerCase(), disp).files[inst ? 'inst' : 'orig'] = f;
        } else if (ext === 'lrc' || ext === 'txt') get(base.trim().toLowerCase(), base.trim()).files.lrc = f;
        else if (IMG_EXT.includes(ext)) get(base.trim().toLowerCase(), base.trim()).files.cover = f;
      }
      const list = [];
      for (const g of groups.values()) {
        if (!g.files.orig && g.files.inst) { g.files.orig = g.files.inst; g.files.inst = null; }
        if (!g.files.orig) continue;
        const p = parseFileName(g.disp);
        if (g.files.lrc) {
          g.lrcText = await U.readText(g.files.lrc);
          const meta = global.KTVLyrics.parseLRC(g.lrcText).meta;
          if (meta.ti) p.title = meta.ti; if (meta.ar) p.artist = meta.ar;
        }
        Object.assign(g, p);
        list.push(g);
      }
      this.batch = list;
      $('#batchList').innerHTML = list.map((g, i) => `<div class="batch-item" data-i="${i}">
        <input data-k="title" value="${esc(g.title)}" placeholder="歌名" /><input data-k="artist" value="${esc(g.artist)}" placeholder="歌手" />
        <span>#${i + 1}</span>
        <div class="bf"><span class="ok">原唱 ✓</span><span class="${g.files.inst ? 'ok' : 'miss'}">伴奏 ${g.files.inst ? '✓' : '✗ 将自动消音'}</span>
        <span class="${g.files.lrc ? 'ok' : 'miss'}">歌词 ${g.files.lrc ? '✓' : '✗'}</span><span class="${g.files.cover ? 'ok' : ''}">封面 ${g.files.cover ? '✓' : '自动'}</span></div></div>`).join('')
        || '<div class="empty">未识别到音频文件</div>';
      $$('#batchList input').forEach((inp) => inp.addEventListener('input', () => {
        this.batch[inp.closest('.batch-item').dataset.i][inp.dataset.k] = inp.value;
      }));
      $('#uploadMsg').textContent = list.length ? `识别到 ${list.length} 首歌曲` : '';
    }

    async _saveBatch() {
      const msg = $('#uploadMsg');
      if (!this.batch.length) { msg.textContent = '请先选择文件'; return; }
      const btn = $('#uploadSave'); btn.disabled = true;
      let ok = 0;
      for (let i = 0; i < this.batch.length; i++) {
        const g = this.batch[i];
        msg.textContent = `正在导入 ${i + 1}/${this.batch.length}：${g.title}`;
        try {
          const duration = await this._probeDuration(g.files.orig);
          await this.app.lib.saveCustom({
            title: g.title || g.disp, artist: g.artist || '未知歌手', tags: Array.from(this.tags),
            original: g.files.orig, instrumental: g.files.inst || null, cover: g.files.cover || null,
            lrc: g.lrcText || '', duration,
          });
          ok++;
        } catch (e) { console.error(e); UI.toast(`导入失败：${g.disp}`, 'err'); }
      }
      btn.disabled = false;
      UI.closeModal('uploadModal');
      UI.toast(`批量导入完成：${ok} 首`, 'ok');
      this.app.picker.cat = 'custom'; this.app.picker.render();
    }
  }

  /* ---------------- 背景 ---------------- */
  class BgDialog {
    constructor(app) {
      this.app = app;
      $('#fBg').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        await app.bg.setCustom(f); this.render(); UI.toast('已应用自定义背景', 'ok');
      });
      $('#bgGrid').addEventListener('click', (e) => {
        const o = e.target.closest('.bg-opt'); if (!o) return;
        app.bg.set(o.dataset.id); this.render();
      });
    }
    open() { this.render(); UI.openModal('bgModal'); }
    render() {
      const bg = this.app.bg;
      const typeName = { image: '图片', video: '视频', canvas: '动画', cover: '封面' };
      $('#bgGrid').innerHTML = bg.all().map((p) => {
        const thumb = p.type === 'image' ? `url('${p.src}')` : p.type === 'cover' && bg.coverUrl ? `url('${bg.coverUrl}')` : p.thumb || '#111';
        return `<button class="bg-opt ${bg.current && bg.current.id === p.id ? 'on' : ''}" data-id="${p.id}" style="background:${thumb};background-size:cover;background-position:center">
          <i class="tagv">${typeName[p.type]}</i><span>${p.name}</span></button>`;
      }).join('');
    }
  }

  /* ---------------- 设置 ---------------- */
  class SettingsDialog {
    constructor(app) {
      this.app = app;
      const e = app.engine;
      const rv = $('#sReverb');
      UI.setRange(rv, Math.round(e.mic.reverb * 100));
      rv.addEventListener('input', () => { UI.paintRange(rv); e.setReverb(rv.value / 100); U.prefs.set('reverb', rv.value / 100); });
      $('#sEcho').checked = e.mic.echoCancel;
      $('#sEcho').addEventListener('change', async (ev) => {
        U.prefs.set('echo', ev.target.checked);
        try { await e.setEchoCancel(ev.target.checked); } catch (err) { UI.toast('麦克风重启失败', 'err'); }
      });
      $('#sMonitor').checked = e.mic.monitor;
      $('#sMonitor').addEventListener('change', (ev) => app.setMonitor(ev.target.checked));
      UI.seg($('#sDefault'), app.prefs.defaultVocal, (v) => { app.prefs.defaultVocal = v; U.prefs.set('defaultVocal', v); });
      $('#sScore').checked = app.prefs.scoreOn;
      $('#sScore').addEventListener('change', (ev) => { app.prefs.scoreOn = ev.target.checked; U.prefs.set('scoreOn', ev.target.checked); app.updateUI(); });
      UI.seg($('#sFont'), app.prefs.font, (v) => app.setFont(v));
    }
    open() { $('#sMonitor').checked = this.app.engine.mic.monitor; UI.openModal('settingsModal'); }
  }

  global.KTVUI = { UI, SongPicker, QueuePanel, UploadDialog, BgDialog, SettingsDialog };
})(window);
