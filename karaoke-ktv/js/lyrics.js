/**
 * ============================================================
 *  歌词解析模块（LRC Parser）+ 歌词渲染模块（LyricsView）
 *  支持：
 *   - 标准 LRC：[mm:ss.xx]歌词，一行多个时间标签 [00:10.00][01:20.00]歌词
 *   - 逐字 LRC（增强格式）：[00:10.00]<00:10.00>字<00:10.40>字...<00:12.00>
 *   - 标签：[ti:] [ar:] [al:] [by:] [offset:±毫秒]
 *  渲染模式：scroll（滚动多行）/ double（KTV 经典双行）/ single（单行大字）
 *  逐字/逐行"卡拉OK 擦色"高亮，严格跟随音频时间轴
 * ============================================================
 */
(function (global) {
  'use strict';

  const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const WORD_RE = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
  const toSec = (m, s, f) => +m * 60 + +s + (f ? +f / Math.pow(10, f.length) : 0);

  function parseLRC(text) {
    const meta = {};
    const raw = [];
    let offset = 0;
    String(text || '').replace(/\r/g, '').split('\n').forEach((line) => {
      const tag = line.match(/^\s*\[(ti|ar|al|by|offset|length|au|re|ve):(.*)\]\s*$/i);
      if (tag) {
        const k = tag[1].toLowerCase();
        meta[k] = tag[2].trim();
        if (k === 'offset') offset = (parseInt(tag[2], 10) || 0) / 1000;
        return;
      }
      const times = [];
      let m; TIME_RE.lastIndex = 0;
      let last = 0;
      while ((m = TIME_RE.exec(line))) { times.push(toSec(m[1], m[2], m[3])); last = TIME_RE.lastIndex; }
      if (!times.length) return;
      const body = line.slice(last);
      // 逐字时间
      let words = null;
      if (WORD_RE.test(body)) {
        words = [];
        WORD_RE.lastIndex = 0;
        const parts = [];
        let wm, prevEnd = 0, prevT = null;
        while ((wm = WORD_RE.exec(body))) {
          if (prevT !== null) parts.push({ t: prevT, text: body.slice(prevEnd, wm.index) });
          prevT = toSec(wm[1], wm[2], wm[3]); prevEnd = WORD_RE.lastIndex;
        }
        const tail = body.slice(prevEnd);
        if (tail) parts.push({ t: prevT, text: tail, open: true });
        else parts.push({ t: prevT, text: '', endMark: true });
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (p.endMark) break;
          const nt = parts[i + 1] ? parts[i + 1].t : p.t + 0.5;
          if (p.text) words.push({ t: p.t, d: Math.max(0.05, nt - p.t), text: p.text });
        }
      }
      const clean = body.replace(WORD_RE, '').trim();
      times.forEach((t) => raw.push({ time: t, text: clean, words: words && times.length === 1 ? words : null }));
    });
    raw.sort((a, b) => a.time - b.time);
    // 应用 offset（正值 = 歌词提前）
    raw.forEach((l) => {
      l.time = Math.max(0, l.time - offset);
      if (l.words) l.words.forEach((w) => (w.t = Math.max(0, w.t - offset)));
    });
    const lines = [];
    raw.forEach((l, i) => {
      if (!l.text) return; // 空行作为上一句结束标记
      const next = raw[i + 1];
      let end;
      if (l.words && l.words.length) {
        const lw = l.words[l.words.length - 1];
        end = lw.t + lw.d;
      } else {
        const nextT = next ? next.time : l.time + 6;
        // 估算演唱结束：不超过下一句开始，也不会因长间奏而拖太长
        end = Math.min(nextT - 0.12, l.time + Math.max(2, l.text.length * 0.55 + 0.8));
        end = Math.max(end, l.time + 0.5);
      }
      lines.push({ time: l.time, end, text: l.text, words: l.words });
    });
    return { meta, lines };
  }

  /* ----------------------------------------------------------- 渲染 */
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function buildLineEl(line, cls = '') {
    const el = document.createElement('div');
    el.className = 'lrc-line ' + cls;
    const words = line.words && line.words.length ? line.words : [{ t: line.time, d: line.end - line.time, text: line.text }];
    const html = words.map((w, i) => `<span class="w" data-i="${i}">${esc(w.text).replace(/ /g, '&nbsp;')}</span>`).join('');
    el.innerHTML = `<div class="lrc-inner"><span class="lrc-base">${html}</span><span class="lrc-fill" aria-hidden="true">${html}</span></div>`;
    el._line = line;
    el._words = words;
    return el;
  }

  /** 计算某行在时间 t 的擦色宽度（像素） */
  function fillPx(el, t) {
    const line = el._line, words = el._words;
    if (t <= line.time) return 0;
    if (!el._spans) {
      el._spans = Array.from(el.querySelectorAll('.lrc-base .w')).map((s) => ({ x: s.offsetLeft, w: s.offsetWidth }));
      el._width = el.querySelector('.lrc-base').offsetWidth;
    }
    if (t >= line.end) return el._width;
    for (let i = words.length - 1; i >= 0; i--) {
      if (t >= words[i].t) {
        const s = el._spans[i];
        const f = Math.min(1, (t - words[i].t) / words[i].d);
        return s.x + s.w * f;
      }
    }
    return 0;
  }

  function setFill(el, t) {
    const px = fillPx(el, t);
    if (el._lastPx === px) return;
    el._lastPx = px;
    const fill = el._fill || (el._fill = el.querySelector('.lrc-fill'));
    fill.style.clipPath = `inset(-30% calc(100% - ${px.toFixed(1)}px) -30% -2px)`;
  }

  /** 行太长时自动缩小，保证一行显示 */
  function fitLine(el, maxWidth) {
    const inner = el.querySelector('.lrc-inner');
    inner.style.transform = '';
    const w = inner.scrollWidth;
    if (w > maxWidth && maxWidth > 0) inner.style.transform = `scale(${(maxWidth / w).toFixed(3)})`;
  }

  class LyricsView {
    constructor(root) {
      this.root = root;
      this.mode = 'double';
      this.lines = [];
      this.index = -2;
      this.root.innerHTML = '';
      this.countdown = document.createElement('div');
      this.countdown.className = 'lrc-countdown';
      this.countdown.innerHTML = '<i></i><i></i><i></i><i></i>';
      this.body = document.createElement('div');
      this.body.className = 'lrc-body';
      this.root.append(this.countdown, this.body);
      window.addEventListener('resize', () => this._layout());
    }

    setMode(mode) { this.mode = mode; this._render(); }

    setLyrics(parsed) {
      this.lines = parsed ? parsed.lines : [];
      this._render();
    }

    clear() { this.lines = []; this._render(); }

    _render() {
      this.index = -2;
      this.body.innerHTML = '';
      this.root.dataset.mode = this.mode;
      this.slots = null; this.lineEls = null;
      if (!this.lines.length) return;
      if (this.mode === 'scroll') {
        this.track = document.createElement('div');
        this.track.className = 'lrc-track';
        this.lineEls = this.lines.map((l) => buildLineEl(l));
        this.track.append(...this.lineEls);
        this.body.append(this.track);
      } else {
        this.slots = [0, 1].map((i) => {
          const s = document.createElement('div');
          s.className = 'lrc-slot slot-' + i;
          this.body.append(s);
          return s;
        });
      }
      requestAnimationFrame(() => this._layout());
    }

    _layout() {
      const maxW = this.body.clientWidth * 0.94;
      if (this.lineEls) this.lineEls.forEach((el) => { fitLine(el, maxW); el._spans = null; el._lastPx = null; });
      if (this.slots) this.slots.forEach((s) => { const el = s.firstChild; if (el) { fitLine(el, maxW); el._spans = null; el._lastPx = null; } });
      this._scrollTo(this.index, true);
    }

    /** 当前时间对应的行号（尚未开始为 -1） */
    findIndex(t) {
      const L = this.lines;
      let lo = 0, hi = L.length - 1, ans = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
      return ans;
    }

    _setSlot(slot, line, idx) {
      const cur = slot.firstChild;
      if (cur && cur._idx === idx) return cur;
      const el = line ? buildLineEl(line, 'enter') : null;
      if (cur) { cur.classList.add('leave'); setTimeout(() => cur.remove(), 380); }
      if (el) {
        el._idx = idx;
        slot.prepend(el);
        fitLine(el, this.body.clientWidth * 0.94);
        requestAnimationFrame(() => el.classList.remove('enter'));
      }
      return el;
    }

    _scrollTo(idx, instant) {
      if (!this.track || !this.lineEls) return;
      const i = Math.max(0, idx);
      const el = this.lineEls[i];
      if (!el) return;
      const y = el.offsetTop + el.offsetHeight / 2 - this.body.clientHeight / 2;
      this.track.style.transition = instant ? 'none' : '';
      this.track.style.transform = `translateY(${-y}px)`;
    }

    /** 每帧调用：t 为当前播放时间（秒） */
    update(t) {
      const L = this.lines;
      if (!L.length) { this.countdown.classList.remove('show'); return; }
      const idx = this.findIndex(t);
      // 倒计时圆点：首句或长间奏后的下一句前 4 秒
      const nextIdx = idx + 1;
      let dots = 0;
      if (nextIdx < L.length) {
        const prevEnd = idx >= 0 ? L[idx].end : -10;
        const remain = L[nextIdx].time - t;
        if (L[nextIdx].time - prevEnd > 4.5 && remain <= 4 && remain > 0 && t > prevEnd + 0.3) dots = Math.ceil(remain);
      }
      this.countdown.classList.toggle('show', dots > 0);
      if (dots !== this._dots) {
        this._dots = dots;
        Array.from(this.countdown.children).forEach((d, i) => d.classList.toggle('on', i < dots));
      }

      if (this.mode === 'scroll') {
        if (idx !== this.index) {
          this.lineEls.forEach((el, i) => {
            el.classList.toggle('current', i === idx);
            el.classList.toggle('past', i < idx);
            el.classList.toggle('near', Math.abs(i - idx) === 1);
          });
          this.index = idx;
          this._scrollTo(idx);
        }
        if (idx >= 0) setFill(this.lineEls[idx], t);
        if (idx + 1 < L.length) setFill(this.lineEls[idx + 1], t);
        return;
      }

      if (this.mode === 'double') {
        // KTV 经典双行：奇偶行交替显示在上（左对齐）/ 下（右对齐）
        const base = Math.max(0, idx);
        if (idx !== this.index) {
          this.index = idx;
          const a = base, b = base + 1;
          const elA = this._setSlot(this.slots[a % 2], L[a], a);
          const elB = this._setSlot(this.slots[b % 2], L[b], b);
          this.slots[a % 2].classList.add('active'); this.slots[b % 2].classList.remove('active');
          this._els = [elA, elB];
        }
        this._els && this._els.forEach((el) => el && setFill(el, t));
        return;
      }

      // single：单行大字 + 下一句预告
      const base = Math.max(0, idx);
      if (idx !== this.index) {
        this.index = idx;
        this._els = [this._setSlot(this.slots[0], L[base], base), this._setSlot(this.slots[1], L[base + 1], base + 1)];
      }
      if (this._els[0]) setFill(this._els[0], t);
    }
  }

  global.KTVLyrics = { parseLRC, LyricsView };
})(window);
