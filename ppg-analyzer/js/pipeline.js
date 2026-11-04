/**
 * PPG 处理流水线（与界面、摄像头解耦，可离线喂数据做实验/单测）
 * ------------------------------------------------------------
 *   原始帧均值 (t, R, G, B)
 *     → 手指检测 → 选通道 / 取反
 *     → 均匀重采样(fs) → 去趋势 → 带通滤波(FILTERS[cfg.filter])
 *     → 峰值检测(DETECTORS[cfg.detector]) → 脉搏间期 PPI
 *     → 伪迹剔除 → 心率 / HRV 特征(FEATURES) → 智能解读(ANALYZERS)
 */

import { resampleUniform, detrend, FILTERS } from './dsp/filters.js';
import { detectPeaks, findFeet } from './dsp/peaks.js';
import { spectralSQI } from './dsp/spectrum.js';
import { cleanIBI, computeHRV, median } from './dsp/hrv.js';

export class PPGProcessor {
  constructor(cfg) {
    this.cfg = { ...cfg };
    this.reset();
  }

  setConfig(cfg) {
    this.cfg = { ...cfg };
  }

  reset() {
    this.raw = [];          // 全程原始数据 {t, r, g, b}，用于导出
    this.startT = null;
    this.peakTimes = [];    // 全程确认的峰时刻 (s)
    this.beats = [];        // {t, ibi(ms)}
    this.lastPeakT = null;
    this.morph = [];        // 每搏形态特征 {t, riseTime, amp}
  }

  /** 推入一帧 ROI 均值；t 单位秒 */
  push(t, r, g, b) {
    if (this.startT === null) this.startT = t;
    this.raw.push({ t, r, g, b });
  }

  get elapsed() {
    return this.raw.length ? this.raw[this.raw.length - 1].t - this.startT : 0;
  }

  /** 手指覆盖检测：画面足够亮且足够“红” */
  fingerStatus(last) {
    const { fingerMinRed, fingerRedRatio } = this.cfg;
    if (!last) return { ok: false, msg: '等待画面' };
    if (last.r < fingerMinRed) return { ok: false, msg: '画面过暗：请打开闪光灯或到明亮处' };
    if (last.r / Math.max(1, last.g) < fingerRedRatio) return { ok: false, msg: '请用指腹完全覆盖后置摄像头和闪光灯' };
    if (last.r > 254.5 && last.g > 250) return { ok: false, msg: '过曝：手指稍微放松或调整位置' };
    return { ok: true, msg: '信号采集中，请保持静止' };
  }

  /** 对最近 windowSec 秒做一次完整分析；建议每 100~250 ms 调用一次 */
  process() {
    const cfg = this.cfg;
    const n = this.raw.length;
    const last = this.raw[n - 1];
    const finger = this.fingerStatus(last);
    const out = { finger, elapsed: this.elapsed, ready: false };
    if (n < 10) return out;

    const tEnd = last.t;
    const tStart = Math.max(this.raw[0].t, tEnd - cfg.windowSec);
    // 取窗口内样本（从尾部向前找，避免全量遍历）
    let i0 = n - 1;
    while (i0 > 0 && this.raw[i0 - 1].t >= tStart) i0--;
    const win = this.raw.slice(i0);
    const ch = cfg.channel === 'green' ? 'g' : 'r';
    const tt = win.map((s) => s.t);
    const vv = win.map((s) => (cfg.invert ? -s[ch] : s[ch]));
    out.fpsActual = (win.length - 1) / Math.max(1e-6, tt[tt.length - 1] - tt[0]);
    if (tEnd - tStart < 2.5) return out;

    // 均匀重采样 + 去趋势 + 滤波
    const { t, x } = resampleUniform(tt, vv, cfg.fs, tStart, tEnd);
    const xd = detrend(x, cfg.detrend);
    const filt = (FILTERS[cfg.filter] || FILTERS.butterworthBandpass)(xd, cfg.fs, cfg);

    // 灌注指数 PI = AC/DC
    const dc = win.reduce((s, v) => s + v[ch], 0) / win.length;
    const sorted = Array.from(filt).sort((a, b) => a - b);
    const ac = sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.05)];
    const pi = dc > 0 ? (100 * ac) / dc : 0;

    // 频谱质量与主频心率
    const { sqi, f0 } = spectralSQI(filt, cfg.fs, cfg.lowCut, cfg.highCut);

    // 峰值检测
    const peaks = detectPeaks(filt, t, cfg.fs, cfg);
    const good = finger.ok && sqi >= cfg.sqiMin && tEnd - this.startT > cfg.warmupSec;
    if (good) this._acceptPeaks(peaks, filt, t, tEnd);
    else if (!finger.ok) this.lastPeakT = null; // 中断后不跨越间隙计算间期

    const cleaned = cleanIBI(this.beats, cfg);
    const valid = cleaned.filter((b) => b.valid);
    const recent = valid.slice(-8).map((b) => b.ibi);
    const hrPeaks = recent.length >= 3 ? 60000 / median(recent) : NaN;

    Object.assign(out, {
      ready: true,
      t, x: filt, peaks,
      sqi, pi, good,
      hrSpectral: f0 * 60,
      hr: Number.isFinite(hrPeaks) ? hrPeaks : (good ? f0 * 60 : NaN),
      ppi: recent.length ? recent[recent.length - 1] : NaN,
      beats: cleaned,
      validCount: valid.length,
      morph: this.morph,
    });
    return out;
  }

  /** 只确认“窗口尾部 guard 秒之前”的新峰，避免滤波边缘效应与重复计数 */
  _acceptPeaks(peaks, x, t, tEnd) {
    const guard = 0.6;
    const minGap = 60 / this.cfg.maxHR;
    const maxGap = (60 / this.cfg.minHR) * 1.5;
    const feet = findFeet(x, peaks.idx, this.cfg.fs);
    peaks.t.forEach((pt, k) => {
      if (pt > tEnd - guard) return;
      if (this.lastPeakT !== null && pt <= this.lastPeakT + minGap) return;
      if (this.lastPeakT !== null) {
        const ibi = (pt - this.lastPeakT) * 1000;
        if (pt - this.lastPeakT < maxGap) this.beats.push({ t: pt, ibi });
      }
      this.lastPeakT = pt;
      this.peakTimes.push(pt);
      // 形态学：上升时间（足→峰）与脉搏幅度
      const fi = feet[k], pi = peaks.idx[k];
      this.morph.push({ t: pt, riseTime: ((pi - fi) / this.cfg.fs) * 1000, amp: x[pi] - x[fi] });
    });
  }

  /** 全程 HRV 汇总 */
  summary() {
    const cleaned = cleanIBI(this.beats, this.cfg);
    const valid = cleaned.filter((b) => b.valid);
    const hrv = computeHRV(valid, this.cfg);
    hrv.artifactRate = cleaned.length ? 1 - valid.length / cleaned.length : 0;
    hrv.duration = this.elapsed;
    const rt = this.morph.map((m) => m.riseTime);
    hrv.riseTime = rt.length ? median(rt) : NaN;
    return { hrv, beats: cleaned };
  }

  /** CSV 导出（原始数据 + 间期） */
  toCSV() {
    const lines = ['# raw', 't_s,R,G,B'];
    for (const s of this.raw) lines.push(`${(s.t - this.startT).toFixed(4)},${s.r.toFixed(3)},${s.g.toFixed(3)},${s.b.toFixed(3)}`);
    lines.push('', '# beats', 't_s,ppi_ms,valid');
    for (const b of cleanIBI(this.beats, this.cfg)) lines.push(`${(b.t - this.startT).toFixed(4)},${b.ibi.toFixed(2)},${b.valid ? 1 : 0}`);
    return lines.join('\n');
  }
}
