/**
 * 轻量 Canvas 绘图（无第三方依赖）：脉搏波形、间期趋势图（tachogram）、Poincaré 散点图
 */

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function grid(ctx, w, h, nx = 8, ny = 4) {
  ctx.strokeStyle = css('--grid');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < nx; i++) { const x = Math.round((w * i) / nx) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let i = 1; i < ny; i++) { const y = Math.round((h * i) / ny) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

function placeholder(ctx, w, h, text) {
  ctx.fillStyle = css('--muted');
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
}

/** 实时脉搏波形 + 峰值标记 */
export function drawWave(canvas, t, x, peakIdx = [], windowSec = 8) {
  const { ctx, w, h } = setup(canvas);
  grid(ctx, w, h, windowSec, 4);
  if (!x || x.length < 2) return placeholder(ctx, w, h, '将指腹覆盖在后置摄像头上');
  let lo = Infinity, hi = -Infinity;
  for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad; hi += pad;
  const t1 = t[t.length - 1], t0 = t1 - windowSec;
  const X = (tt) => ((tt - t0) / windowSec) * w;
  const Y = (v) => h - ((v - lo) / (hi - lo)) * h;
  ctx.strokeStyle = css('--wave');
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < x.length; i++) {
    const px = X(t[i]), py = Y(x[i]);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = css('--peak');
  for (const i of peakIdx) {
    ctx.beginPath();
    ctx.arc(X(t[i]), Y(x[i]), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 间期趋势：横轴时间，纵轴 PPI(ms)，无效间期以空心点显示 */
export function drawTacho(canvas, beats, t0) {
  const { ctx, w, h } = setup(canvas);
  grid(ctx, w, h, 6, 3);
  if (!beats || beats.length < 2) return placeholder(ctx, w, h, '间期趋势图（等待心搏）');
  const show = beats.slice(-120);
  const valid = show.filter((b) => b.valid).map((b) => b.ibi);
  let lo = Math.min(...(valid.length ? valid : [600])) - 40;
  let hi = Math.max(...(valid.length ? valid : [1000])) + 40;
  const ta = show[0].t, tb = show[show.length - 1].t;
  const X = (tt) => 8 + ((tt - ta) / Math.max(1, tb - ta)) * (w - 16);
  const Y = (v) => h - 6 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - 18);
  ctx.strokeStyle = css('--wave');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let first = true;
  for (const b of show) {
    if (!b.valid) continue;
    first ? ctx.moveTo(X(b.t), Y(b.ibi)) : ctx.lineTo(X(b.t), Y(b.ibi));
    first = false;
  }
  ctx.stroke();
  for (const b of show) {
    ctx.beginPath();
    ctx.arc(X(b.t), Y(b.ibi), 2.5, 0, Math.PI * 2);
    if (b.valid) { ctx.fillStyle = css('--wave'); ctx.fill(); }
    else { ctx.strokeStyle = css('--peak'); ctx.stroke(); }
  }
  ctx.fillStyle = css('--muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(hi)} ms`, 4, 12);
  ctx.fillText(`${Math.round(lo)} ms`, 4, h - 4);
}

/** Poincaré 散点图：PPI(n) vs PPI(n+1) */
export function drawPoincare(canvas, nn) {
  const { ctx, w, h } = setup(canvas);
  if (!nn || nn.length < 3) { grid(ctx, w, h, 4, 4); return placeholder(ctx, w, h, 'Poincaré 图'); }
  const lo = Math.min(...nn) - 30, hi = Math.max(...nn) + 30;
  const s = Math.min(w, h) - 24;
  const ox = (w - s) / 2, oy = (h - s) / 2;
  const P = (v) => (v - lo) / (hi - lo) * s;
  ctx.strokeStyle = css('--grid');
  ctx.strokeRect(ox + 0.5, oy + 0.5, s, s);
  ctx.beginPath();
  ctx.moveTo(ox, oy + s); ctx.lineTo(ox + s, oy);
  ctx.stroke();
  ctx.fillStyle = css('--wave');
  ctx.globalAlpha = 0.7;
  for (let i = 0; i < nn.length - 1; i++) {
    ctx.beginPath();
    ctx.arc(ox + P(nn[i]), oy + s - P(nn[i + 1]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = css('--muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PPIₙ', w / 2, h - 2);
  ctx.save(); ctx.translate(10, h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('PPIₙ₊₁', 0, 0); ctx.restore();
}

/** PSD 曲线（HRV 频域），LF/HF 频带着色 */
export function drawPSD(canvas, psd, cfg) {
  const { ctx, w, h } = setup(canvas);
  if (!psd) { grid(ctx, w, h, 4, 3); return placeholder(ctx, w, h, '功率谱（需 ≥30 s 数据）'); }
  const fMax = 0.5;
  const pts = [];
  for (let k = 0; k < psd.f.length && psd.f[k] <= fMax; k++) pts.push([psd.f[k], psd.p[k]]);
  const pMax = Math.max(...pts.map((p) => p[1])) * 1.1 || 1;
  const X = (f) => 6 + (f / fMax) * (w - 12);
  const Y = (p) => h - 16 - (p / pMax) * (h - 26);
  const band = (b, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(X(b[0]), Y(0));
    for (const [f, p] of pts) if (f >= b[0] && f <= b[1]) ctx.lineTo(X(f), Y(p));
    ctx.lineTo(X(b[1]), Y(0));
    ctx.closePath();
    ctx.fill();
  };
  band(cfg.lfBand, css('--lf'));
  band(cfg.hfBand, css('--hf'));
  ctx.strokeStyle = css('--text');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  pts.forEach(([f, p], i) => (i ? ctx.lineTo(X(f), Y(p)) : ctx.moveTo(X(f), Y(p))));
  ctx.stroke();
  ctx.fillStyle = css('--muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const f of [0, 0.1, 0.2, 0.3, 0.4]) ctx.fillText(f.toFixed(1), X(f), h - 3);
  ctx.textAlign = 'right';
  ctx.fillText('Hz', w - 4, h - 3);
}
