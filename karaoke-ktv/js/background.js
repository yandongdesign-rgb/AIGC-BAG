/**
 * ============================================================
 *  播放背景模块（BackgroundManager）
 *  静态背景图 / 动态视频背景 / 实时动画（随音乐律动）/ 自定义上传，歌词浮于背景之上
 * ============================================================
 */
(function (global) {
  'use strict';
  const U = global.KTVUtils;

  const PRESETS = [
    { id: 'particles', name: '霓虹律动', type: 'canvas', thumb: 'linear-gradient(135deg,#1b1250,#3a1060 60%,#0d2a5a)' },
    { id: 'video', name: '动态光斑', type: 'video', src: 'assets/backgrounds/neon-loop.mp4', thumb: 'linear-gradient(135deg,#200c3d,#0c2347)' },
    { id: 'neon-city', name: '霓虹夜景', type: 'image', src: 'assets/backgrounds/neon-city.jpg' },
    { id: 'aurora', name: '星空极光', type: 'image', src: 'assets/backgrounds/aurora.jpg' },
    { id: 'stage', name: '舞台灯光', type: 'image', src: 'assets/backgrounds/stage.jpg' },
    { id: 'cover', name: '歌曲封面', type: 'cover', thumb: 'linear-gradient(135deg,#ff5fd2,#5b6cff)' },
  ];

  class BackgroundManager {
    constructor(root, engine) {
      this.root = root; this.engine = engine;
      this.current = null; this.coverUrl = null; this.custom = null;
      this.raf = 0;
    }

    async init() {
      try {
        const c = await U.store.get('kv', 'customBg');
        if (c && c.blob) this.custom = { id: 'custom', name: '自定义', type: c.blob.type.startsWith('video') ? 'video' : 'image', src: URL.createObjectURL(c.blob) };
      } catch (e) {}
      const id = U.prefs.get('bg', 'particles');
      this.set(this.all().some((p) => p.id === id) ? id : 'particles');
    }

    all() { return this.custom ? PRESETS.concat(this.custom) : PRESETS; }

    async setCustom(file) {
      await U.store.put('kv', { blob: file }, 'customBg');
      if (this.custom) URL.revokeObjectURL(this.custom.src);
      this.custom = { id: 'custom', name: '自定义', type: file.type.startsWith('video') ? 'video' : 'image', src: URL.createObjectURL(file) };
      this.set('custom');
    }

    setCover(url) { this.coverUrl = url; if (this.current && this.current.type === 'cover') this.set('cover'); }

    set(id) {
      const p = this.all().find((x) => x.id === id) || PRESETS[0];
      this.current = p;
      U.prefs.set('bg', p.id);
      cancelAnimationFrame(this.raf);
      const old = Array.from(this.root.children);
      let el;
      if (p.type === 'image') {
        el = document.createElement('div'); el.className = 'bg-item bg-image kenburns';
        el.style.backgroundImage = `url("${p.src}")`;
      } else if (p.type === 'cover') {
        el = document.createElement('div'); el.className = 'bg-item bg-cover';
        el.innerHTML = `<div class="bg-cover-blur" style="background-image:url('${this.coverUrl || ''}')"></div>`;
      } else if (p.type === 'video') {
        el = document.createElement('video');
        el.className = 'bg-item bg-video';
        Object.assign(el, { src: p.src, muted: true, loop: true, autoplay: true, playsInline: true });
        el.play().catch(() => {});
      } else {
        el = document.createElement('canvas'); el.className = 'bg-item bg-canvas';
        this._startCanvas(el);
      }
      el.style.opacity = '0';
      this.root.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = '1'; });
      setTimeout(() => old.forEach((o) => o.remove()), 700);
    }

    /** 霓虹粒子 + 频谱光带，随音乐律动 */
    _startCanvas(cv) {
      const ctx = cv.getContext('2d');
      const dots = Array.from({ length: 70 }, () => ({
        x: Math.random(), y: Math.random(), r: 20 + Math.random() * 90, vx: (Math.random() - 0.5) * 0.0004,
        vy: -0.0002 - Math.random() * 0.0005, h: [300, 190, 265, 330, 210][Math.floor(Math.random() * 5)], a: 0.08 + Math.random() * 0.22,
      }));
      let t0 = performance.now();
      const draw = (now) => {
        const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
        if (cv.width !== Math.floor(w * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr); }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const t = (now - t0) / 1000;
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#0a0b26'); g.addColorStop(0.55, '#1a0d3a'); g.addColorStop(1, '#071a3a');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        const spec = this.engine && this.engine.readOutputLevel ? this.engine.readOutputLevel() : null;
        let bass = 0;
        if (spec && spec.length) { for (let i = 2; i < 12; i++) bass += spec[i]; bass /= 10 * 255; }
        ctx.globalCompositeOperation = 'lighter';
        for (const d of dots) {
          d.x += d.vx; d.y += d.vy;
          if (d.y < -0.15) { d.y = 1.15; d.x = Math.random(); }
          const r = d.r * (1 + bass * 0.6);
          const x = d.x * w, y = d.y * h;
          const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
          rg.addColorStop(0, `hsla(${d.h},95%,65%,${d.a * (0.7 + bass)})`); rg.addColorStop(1, `hsla(${d.h},95%,60%,0)`);
          ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        // 底部频谱光带
        if (spec && spec.length) {
          const n = 64, bw = w / n;
          for (let i = 0; i < n; i++) {
            const v = spec[Math.floor(i * spec.length * 0.6 / n)] / 255;
            const bh = v * h * 0.28;
            const lg = ctx.createLinearGradient(0, h, 0, h - bh);
            lg.addColorStop(0, `hsla(${190 + i * 2},90%,60%,0.35)`); lg.addColorStop(1, `hsla(${300 + i},90%,60%,0)`);
            ctx.fillStyle = lg; ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
          }
        }
        // 流动光线
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += 12) {
            const y = h * (0.62 + k * 0.08) + Math.sin(x / (180 + k * 40) + t * (0.6 + k * 0.2)) * (30 + bass * 50);
            x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.strokeStyle = `hsla(${[310, 195, 265][k]},95%,65%,0.18)`; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        this.raf = requestAnimationFrame(draw);
      };
      this.raf = requestAnimationFrame(draw);
    }
  }
  BackgroundManager.PRESETS = PRESETS;
  global.KTVBackground = { BackgroundManager, PRESETS };
})(window);
