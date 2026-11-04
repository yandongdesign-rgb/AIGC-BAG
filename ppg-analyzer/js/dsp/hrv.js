/**
 * 心率变异性 HRV 特征提取（参考 Task Force of ESC/NASPE, Circulation 1996）
 * ------------------------------------------------------------
 * 输入：脉搏间期序列 PPI（ms，PPG 中与 ECG 的 RR 间期相对应，又称 PRV）
 * 时域：MeanNN, SDNN, RMSSD, pNN50, SDSD, CVNN, MeanHR
 * 非线性：Poincaré SD1 / SD2
 * 频域：间期序列线性插值重采样到 4 Hz（可替换为三次样条）+ 去趋势 + Welch → VLF / LF / HF、LF/HF、LFnu/HFnu
 * 拓展：registerFeature('name', (nn, cfg) => ({ key: value }))
 */

import { resampleUniform, detrend } from './filters.js';
import { welch, bandPower, nextPow2 } from './spectrum.js';

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = (a, ddof = 1) => {
  if (a.length <= ddof) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - ddof));
};
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
export { mean, std, median };

/**
 * 间期伪迹剔除：生理范围 + 与近期中位数相对偏差
 * @param {{t:number, ibi:number}[]} beats 每个间期结束时刻与长度(ms)
 * @returns {{t:number, ibi:number, valid:boolean}[]}
 */
export function cleanIBI(beats, cfg) {
  const lo = 60000 / cfg.maxHR, hi = 60000 / cfg.minHR;
  const out = [];
  const recent = [];
  for (const b of beats) {
    let valid = b.ibi >= lo && b.ibi <= hi;
    if (valid && recent.length >= 3) {
      const m = median(recent);
      if (Math.abs(b.ibi - m) / m > cfg.ibiMaxDeviation) valid = false;
    }
    out.push({ ...b, valid });
    if (b.ibi >= lo && b.ibi <= hi) {
      recent.push(b.ibi);
      if (recent.length > cfg.ibiMedianN) recent.shift();
    }
  }
  return out;
}

export function timeDomain(nn) {
  if (nn.length < 2) return {};
  const diff = [];
  for (let i = 1; i < nn.length; i++) diff.push(nn[i] - nn[i - 1]);
  const meanNN = mean(nn);
  return {
    meanNN,
    sdnn: std(nn),
    rmssd: Math.sqrt(mean(diff.map((d) => d * d))),
    sdsd: std(diff),
    pnn50: (100 * diff.filter((d) => Math.abs(d) > 50).length) / diff.length,
    cvnn: (100 * std(nn)) / meanNN,
    meanHR: mean(nn.map((v) => 60000 / v)),
  };
}

export function poincare(nn) {
  if (nn.length < 3) return {};
  const x = nn.slice(0, -1), y = nn.slice(1);
  const d1 = x.map((v, i) => (y[i] - v) / Math.SQRT2);
  const d2 = x.map((v, i) => (y[i] + v) / Math.SQRT2);
  const sd1 = std(d1), sd2 = std(d2);
  return { sd1, sd2, sd1sd2: sd1 / sd2 };
}

/**
 * 频域 HRV
 * @param {number[]} tBeat 每个间期结束的时刻 (s)
 * @param {number[]} nn 间期 (ms)
 */
export function freqDomain(tBeat, nn, cfg) {
  const dur = tBeat[tBeat.length - 1] - tBeat[0];
  if (nn.length < 8 || dur < 30) return { durationOk: false };
  const fs = cfg.hrvResampleFs;
  const { x } = resampleUniform(tBeat, nn, fs, tBeat[0], tBeat[tBeat.length - 1]);
  const xd = detrend(x, 'linear');
  const seg = Math.min(xd.length, nextPow2(Math.round(cfg.welchSegSec * fs)));
  const { f, p } = welch(xd, fs, seg);
  const vlf = bandPower(f, p, ...cfg.vlfBand);
  const lf = bandPower(f, p, ...cfg.lfBand);
  const hf = bandPower(f, p, ...cfg.hfBand);
  return {
    durationOk: dur >= 120, // LF 至少需要约 2 分钟数据才可靠
    vlf, lf, hf,
    lfhf: hf > 0 ? lf / hf : NaN,
    lfnu: (100 * lf) / (lf + hf),
    hfnu: (100 * hf) / (lf + hf),
    psd: { f, p },
  };
}

// ============ 特征注册表（拓展接口） ============

/**
 * 每个特征函数：(nn: number[] ms, ctx: {tBeat, cfg}) => 对象（会合并到结果中）
 * 示例（加入三角指数 HRV Triangular Index）：
 *   registerFeature('triangular', (nn) => {
 *     const bin = 1000 / 128, hist = {};
 *     nn.forEach(v => { const k = Math.floor(v / bin); hist[k] = (hist[k] || 0) + 1; });
 *     return { hrvTi: nn.length / Math.max(...Object.values(hist)) };
 *   });
 */
export const FEATURES = {
  timeDomain: (nn) => timeDomain(nn),
  poincare: (nn) => poincare(nn),
  freqDomain: (nn, ctx) => freqDomain(ctx.tBeat, nn, ctx.cfg),
};

export function registerFeature(name, fn) {
  FEATURES[name] = fn;
}

export function computeHRV(validBeats, cfg) {
  const nn = validBeats.map((b) => b.ibi);
  const tBeat = validBeats.map((b) => b.t);
  const res = { n: nn.length };
  for (const [name, fn] of Object.entries(FEATURES)) {
    try { Object.assign(res, fn(nn, { tBeat, cfg })); } catch (e) { console.warn('feature', name, e); }
  }
  return res;
}
