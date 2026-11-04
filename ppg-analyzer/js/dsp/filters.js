/**
 * 数字滤波与预处理（纯函数，无 DOM 依赖，可在 Node 中单测）
 * ------------------------------------------------------------
 * - resampleUniform：非均匀采样 → 均匀采样（线性插值）
 * - detrend：去均值 / 线性去趋势
 * - designButterworth*：RBJ 双线性变换二阶节（biquad）设计
 * - sosfilt / filtfilt：级联二阶节滤波 / 零相位前后向滤波
 * - FILTERS 注册表：registerFilter(name, fn) 即可加入新滤波器
 */

// ============ 预处理 ============

/**
 * 线性插值重采样
 * @param {number[]} t 时间戳 (s)，单调递增
 * @param {number[]} v 采样值
 * @param {number} fs 目标采样率
 * @param {number} t0 起始时间
 * @param {number} t1 结束时间
 * @returns {{t: Float64Array, x: Float64Array}}
 */
export function resampleUniform(t, v, fs, t0, t1) {
  const n = Math.max(0, Math.floor((t1 - t0) * fs) + 1);
  const tu = new Float64Array(n);
  const xu = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = t0 + i / fs;
    tu[i] = ti;
    while (j < t.length - 2 && t[j + 1] < ti) j++;
    if (ti <= t[0]) { xu[i] = v[0]; continue; }
    if (ti >= t[t.length - 1]) { xu[i] = v[v.length - 1]; continue; }
    const dt = t[j + 1] - t[j];
    const a = dt > 0 ? (ti - t[j]) / dt : 0;
    xu[i] = v[j] + a * (v[j + 1] - v[j]);
  }
  return { t: tu, x: xu };
}

/** 去趋势：'none' | 'mean' | 'linear'（最小二乘直线） */
export function detrend(x, mode = 'linear') {
  const n = x.length;
  const y = Float64Array.from(x);
  if (mode === 'none' || n === 0) return y;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  if (mode === 'mean') { for (let i = 0; i < n; i++) y[i] -= mean; return y; }
  // linear
  const tm = (n - 1) / 2;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (i - tm) * (x[i] - mean); sxx += (i - tm) ** 2; }
  const k = sxx > 0 ? sxy / sxx : 0;
  for (let i = 0; i < n; i++) y[i] = x[i] - mean - k * (i - tm);
  return y;
}

// ============ 滤波器设计 ============

/** 二阶节 {b:[b0,b1,b2], a:[1,a1,a2]} */
function biquad(type, f0, fs, Q) {
  const w0 = (2 * Math.PI * f0) / fs;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  let b;
  if (type === 'lowpass') b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
  else if (type === 'highpass') b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  else throw new Error('unknown biquad type ' + type);
  const a0 = 1 + alpha;
  return { b: b.map((v) => v / a0), a: [1, (-2 * cw) / a0, (1 - alpha) / a0] };
}

/** Butterworth 各二阶节的 Q 值（阶数 N 为偶数） */
function butterQs(order) {
  const N = Math.max(2, order + (order % 2));
  const qs = [];
  for (let k = 0; k < N / 2; k++) qs.push(1 / (2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * N))));
  return qs;
}

export function designButterworthLowpass(fc, fs, order = 4) {
  return butterQs(order).map((q) => biquad('lowpass', fc, fs, q));
}

export function designButterworthHighpass(fc, fs, order = 4) {
  return butterQs(order).map((q) => biquad('highpass', fc, fs, q));
}

/** 带通 = 高通级联低通（课堂常见实现方式） */
export function designButterworthBandpass(lowCut, highCut, fs, order = 4) {
  const nyq = fs / 2;
  const hc = Math.min(highCut, nyq * 0.95);
  return [...designButterworthHighpass(lowCut, fs, order), ...designButterworthLowpass(hc, fs, order)];
}

/**
 * 频率响应 |H(f)|，便于课堂作业画幅频特性
 * @returns {number} 幅值
 */
export function sosFreqResponse(sos, f, fs) {
  const w = (2 * Math.PI * f) / fs;
  let mag = 1;
  for (const { b, a } of sos) {
    const re = (c) => c[0] + c[1] * Math.cos(-w) + c[2] * Math.cos(-2 * w);
    const im = (c) => c[1] * Math.sin(-w) + c[2] * Math.sin(-2 * w);
    mag *= Math.hypot(re(b), im(b)) / Math.hypot(re(a), im(a));
  }
  return mag;
}

// ============ 滤波实现 ============

/** 级联二阶节滤波（直接 II 型转置），初始状态取首样本的稳态值以减小启动瞬态 */
export function sosfilt(sos, x) {
  let y = Float64Array.from(x);
  if (y.length === 0) return y;
  for (const { b, a } of sos) {
    const out = new Float64Array(y.length);
    const x0 = y[0];
    const gain = (b[0] + b[1] + b[2]) / (1 + a[1] + a[2]);
    const y0 = gain * x0;
    let z2 = b[2] * x0 - a[2] * y0;
    let z1 = y0 - b[0] * x0;
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const yi = b[0] * xi + z1;
      z1 = b[1] * xi - a[1] * yi + z2;
      z2 = b[2] * xi - a[2] * yi;
      out[i] = yi;
    }
    y = out;
  }
  return y;
}

/** 零相位滤波：奇对称延拓 + 前向 + 反向（等价于 scipy.signal.sosfiltfilt 的思路） */
export function filtfilt(sos, x, padLen) {
  const n = x.length;
  if (n < 4) return Float64Array.from(x);
  const p = Math.min(n - 1, padLen ?? 3 * 2 * sos.length * 3);
  const ext = new Float64Array(n + 2 * p);
  for (let i = 0; i < p; i++) ext[i] = 2 * x[0] - x[p - i];
  for (let i = 0; i < n; i++) ext[p + i] = x[i];
  for (let i = 0; i < p; i++) ext[p + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  let y = sosfilt(sos, ext);
  y.reverse();
  y = sosfilt(sos, y);
  y.reverse();
  return y.slice(p, p + n);
}

// ============ 滤波器注册表（拓展接口） ============

/**
 * 每个滤波器签名：(x: Float64Array, fs: number, cfg: object) => Float64Array
 * 例如加入滑动平均滤波：
 *   registerFilter('movingAverage', (x, fs, cfg) => { ... });
 * 然后在 config.js 中将 filter 设为 'movingAverage'。
 */
export const FILTERS = {
  butterworthBandpass(x, fs, cfg) {
    const sos = designButterworthBandpass(cfg.lowCut, cfg.highCut, fs, cfg.filterOrder);
    return filtfilt(sos, x, Math.min(x.length - 1, Math.round((fs / cfg.lowCut) * 1.5)));
  },
  /** 示例：仅低通 + 滑动平均去基线（另一种常见课堂方法） */
  movingAverageBaseline(x, fs, cfg) {
    const w = Math.max(1, Math.round(fs / cfg.lowCut));
    const base = movingAverage(x, w);
    const hp = x.map((v, i) => v - base[i]);
    return filtfilt(designButterworthLowpass(cfg.highCut, fs, cfg.filterOrder), hp);
  },
};

export function registerFilter(name, fn) {
  FILTERS[name] = fn;
}

/** 居中滑动平均 */
export function movingAverage(x, w) {
  const n = x.length;
  const y = new Float64Array(n);
  const half = Math.floor(w / 2);
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    y[i] = (cs[b] - cs[a]) / (b - a);
  }
  return y;
}
