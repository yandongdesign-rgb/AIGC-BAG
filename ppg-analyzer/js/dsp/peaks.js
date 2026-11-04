/**
 * 脉搏波收缩期峰值检测
 * ------------------------------------------------------------
 * 内置两种算法，均返回 { idx: 整数下标[], t: 亚采样精度时间(s)[] }：
 *  - elgendi : Elgendi M. et al., PLoS ONE 2013, "Systolic Peak Detection in
 *              Acceleration Photoplethysmograms..." 双滑动平均 + 事件块法
 *  - localMax: 自适应阈值局部极大值 + 不应期
 * 拓展：registerDetector('myAlgo', (x, fs, cfg) => idxArray)
 */

import { movingAverage } from './filters.js';

/** 抛物线插值，提高峰时刻分辨率（30 fps 时单帧 33 ms，对 HRV 太粗） */
export function parabolicRefine(x, i) {
  if (i <= 0 || i >= x.length - 1) return i;
  const a = x[i - 1], b = x[i], c = x[i + 1];
  const d = a - 2 * b + c;
  if (d === 0) return i;
  const off = (0.5 * (a - c)) / d;
  return i + Math.max(-0.5, Math.min(0.5, off));
}

function percentile(arr, p) {
  const s = Array.from(arr).sort((a, b) => a - b);
  if (!s.length) return 0;
  const k = (s.length - 1) * p;
  const lo = Math.floor(k), hi = Math.ceil(k);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
}

/** 强制最小间距：冲突时保留幅值较大的峰 */
function enforceRefractory(x, idx, minDist) {
  const out = [];
  for (const i of idx) {
    if (out.length && i - out[out.length - 1] < minDist) {
      if (x[i] > x[out[out.length - 1]]) out[out.length - 1] = i;
    } else out.push(i);
  }
  return out;
}

export const DETECTORS = {
  /** Elgendi 2013 */
  elgendi(x, fs, cfg) {
    const n = x.length;
    // 1) 削波：只保留正半周  2) 平方，增强收缩期峰
    const y = new Float64Array(n);
    let meanY = 0;
    for (let i = 0; i < n; i++) { const v = x[i] > 0 ? x[i] : 0; y[i] = v * v; meanY += y[i]; }
    meanY /= n || 1;
    const w1 = Math.max(1, Math.round(cfg.elgendiW1 * fs));
    const w2 = Math.max(1, Math.round(cfg.elgendiW2 * fs));
    const maPeak = movingAverage(y, w1);
    const maBeat = movingAverage(y, w2);
    const alpha = cfg.elgendiBeta * meanY;
    // 3) 感兴趣块：MA_peak > MA_beat + α，块宽 ≥ W1 时取块内最大值
    const peaks = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const inBlock = i < n && maPeak[i] > maBeat[i] + alpha;
      if (inBlock && start < 0) start = i;
      if (!inBlock && start >= 0) {
        if (i - start >= w1) {
          let m = start;
          for (let k = start; k < i; k++) if (x[k] > x[m]) m = k;
          peaks.push(m);
        }
        start = -1;
      }
    }
    return peaks;
  },

  /** 自适应阈值局部极大值 */
  localMax(x, fs, cfg) {
    const med = percentile(x, 0.5);
    const p95 = percentile(x, 0.95);
    const thr = med + cfg.localMaxThreshold * (p95 - med);
    const idx = [];
    for (let i = 1; i < x.length - 1; i++) {
      if (x[i] > thr && x[i] > x[i - 1] && x[i] >= x[i + 1]) idx.push(i);
    }
    return idx;
  },
};

export function registerDetector(name, fn) {
  DETECTORS[name] = fn;
}

/**
 * 统一入口：调用注册的检测器 → 不应期约束 → 亚采样精修
 * @param {Float64Array} x 已滤波信号（峰向上）
 * @param {Float64Array} t 对应时间轴
 */
export function detectPeaks(x, t, fs, cfg) {
  const fn = DETECTORS[cfg.detector] || DETECTORS.elgendi;
  const minDist = Math.max(1, Math.floor((60 / cfg.maxHR) * fs));
  // 边界上的“峰”往往是半个波，丢掉
  const raw = fn(x, fs, cfg).filter((i) => i > 0 && i < x.length - 1);
  const idx = enforceRefractory(x, raw, minDist);
  const times = idx.map((i) => t[0] + parabolicRefine(x, i) / fs);
  return { idx, t: times };
}

/** 每个峰前的波谷（脉搏波起点 foot），用于形态学特征 */
export function findFeet(x, peakIdx, fs) {
  const maxBack = Math.round(0.5 * fs);
  return peakIdx.map((p, k) => {
    const lo = Math.max(k > 0 ? peakIdx[k - 1] : 0, p - maxBack);
    let m = p;
    for (let i = lo; i < p; i++) if (x[i] < x[m]) m = i;
    return m;
  });
}
