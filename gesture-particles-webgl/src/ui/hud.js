/** 界面层：状态 HUD、手势图例、设置面板、摄像头小窗骨架绘制 */
const EFFECT_NAME = {
  trail: '拖尾', burst: '闪爆', lightning: '闪电', vortex: '漩涡', scatter: '四散飞舞',
  dualLink: '双手连接', ambient: '待机粒子流', cursor: '光标', ripple: '涟漪',
};
const GESTURE_ICON = { OPEN_PALM: '🖐', FIST: '✊', POINT: '☝', PINCH: '🤏', PALM_UP: '🫴', VICTORY: '✌', UNKNOWN: '·', NONE: '—' };
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

export class Hud {
  constructor(cfg, handlers) {
    this.cfg = cfg; this.h = handlers;
    this.el = document.getElementById('hud');
    this.legend = document.getElementById('legend');
    this.panel = document.getElementById('panel');
    this.toast = document.getElementById('toast');
    this.buildLegend();
    this.buildPanel();
    this.t = 0;
  }

  buildLegend() {
    const rows = Object.entries(this.cfg.mapping).filter(([k]) => k !== 'UNKNOWN');
    rows.push(['DUAL', { label: this.cfg.dual.label, modes: this.cfg.dual.modes }]);
    this.legend.innerHTML = rows.map(([k, m]) =>
      `<div class="row" data-g="${k}"><span class="ico">${GESTURE_ICON[k] || '🙌'}</span><span class="lbl">${m.label}</span><span class="fx">${m.modes.map((x) => EFFECT_NAME[x] || x).join('+')}</span></div>`).join('');
  }

  buildPanel() {
    const A = this.cfg.audio.layers;
    const themes = Object.entries(this.cfg.themes).map(([k, t]) => `<option value="${k}" ${k === this.cfg.render.theme ? 'selected' : ''}>${t.name}</option>`).join('');
    this.panel.innerHTML = `
      <h3>设置 <small>(P 关闭)</small></h3>
      <label>配色主题 <select id="p-theme">${themes}</select></label>
      <label>主音量 <input id="p-vol" type="range" min="0" max="1" step="0.01" value="${this.cfg.audio.masterVolume}"></label>
      <label>残影长度 <input id="p-persist" type="range" min="0" max="0.95" step="0.01" value="${this.cfg.render.trailPersistence}"></label>
      <label>辉光 <input id="p-bloom" type="range" min="0" max="2.5" step="0.05" value="${this.cfg.render.bloom}"></label>
      <div class="sub">音效层</div>
      <div class="grid">${Object.keys(A).map((k) => `<label class="chk"><input type="checkbox" data-layer="${k}" ${A[k].enabled ? 'checked' : ''}> ${k}</label>`).join('')}</div>`;
    const $ = (id) => this.panel.querySelector(id);
    $('#p-theme').onchange = (e) => this.h.setTheme(e.target.value);
    $('#p-vol').oninput = (e) => this.h.setVolume(+e.target.value);
    $('#p-persist').oninput = (e) => { this.cfg.render.trailPersistence = +e.target.value; };
    $('#p-bloom').oninput = (e) => { this.cfg.render.bloom = +e.target.value; };
    this.panel.querySelectorAll('[data-layer]').forEach((c) => (c.onchange = (e) => this.h.setLayer(e.target.dataset.layer, e.target.checked)));
  }

  syncTheme(k) { const s = this.panel.querySelector('#p-theme'); if (s) s.value = k; }

  show(msg, ms = 1600) {
    this.toast.textContent = msg; this.toast.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => this.toast.classList.remove('on'), ms);
  }

  update(dt, s) {
    this.t += dt;
    const active = new Set(s.hands.map((h) => h.gesture));
    if (s.hands.length >= 2) active.add('DUAL');
    this.legend.querySelectorAll('.row').forEach((r) => r.classList.toggle('on', active.has(r.dataset.g)));
    if (this.t < 0.2) return; // HUD 文本 5Hz 刷新
    this.t = 0;
    const handTxt = [0, 1].map((i) => {
      const h = s.slots[i];
      if (!h.present) return `手${i + 1}: —`;
      return `手${i + 1}: ${GESTURE_ICON[h.gesture] || ''} ${this.cfg.mapping[h.gesture]?.label || h.gesture} <span class="dim">(${(h.confidence * 100).toFixed(0)}%${h.lm ? ` · 掌心↑${h.palmUpScore.toFixed(2)} · 捏${h.pinchRatio.toFixed(2)}` : ''})</span>`;
    }).join('<br>');
    const fpsCls = s.fps >= 30 ? 'ok' : 'bad';
    this.el.innerHTML = `
      <div><b class="${fpsCls}">${s.fps.toFixed(0)} FPS</b> <span class="dim">帧耗时 ${s.frameMs.toFixed(1)}ms</span></div>
      <div>识别耗时 ${s.detectMs.toFixed(1)}ms · 端到端延迟 ${s.latency ? s.latency.toFixed(0) + 'ms' : '—'}</div>
      <div>粒子 ${s.particles} / ${s.limit} · 画质 ${s.quality}${s.auto ? '(自动)' : '(手动)'}</div>
      <div>输入 ${s.source} · 音频 ${s.audio} ${s.peak > -90 ? `<span class="dim">峰值 ${s.peak.toFixed(1)}dBFS</span>` : ''}</div>
      <div class="hands">${handTxt}</div>`;
  }

  /** 摄像头小窗上画 21 点骨架 */
  drawSkeleton(canvas, video, result) {
    const g = canvas.getContext('2d');
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480; }
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!result?.landmarks) return;
    const W = canvas.width, H = canvas.height;
    result.landmarks.forEach((lm, k) => {
      g.strokeStyle = k ? '#ff5fd2' : '#5fe8ff'; g.lineWidth = 3;
      g.beginPath();
      for (const [a, b] of BONES) { g.moveTo(lm[a].x * W, lm[a].y * H); g.lineTo(lm[b].x * W, lm[b].y * H); }
      g.stroke();
      g.fillStyle = '#fff';
      for (const p of lm) { g.beginPath(); g.arc(p.x * W, p.y * H, 3.5, 0, 6.283); g.fill(); }
    });
  }
}
