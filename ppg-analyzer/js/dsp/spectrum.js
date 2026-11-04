/**
 * 频谱工具：FFT、Welch 功率谱、频带积分、谱质量指数 SQI
 */

/** 原地基 2 FFT（re/im 长度须为 2 的幂） */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1;
  return w;
}

/**
 * 单边功率谱密度（周期图，Hann 窗，补零到 nfft）
 * @returns {{f: Float64Array, p: Float64Array}} p 的单位为 (x单位)²/Hz
 */
export function periodogram(x, fs, nfft) {
  const n = x.length;
  const N = Math.max(nextPow2(n), nfft || 0);
  const w = hann(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n || 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  let u = 0;
  for (let i = 0; i < n; i++) { re[i] = (x[i] - mean) * w[i]; u += w[i] * w[i]; }
  fft(re, im);
  const half = N / 2 + 1;
  const f = new Float64Array(half), p = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    f[k] = (k * fs) / N;
    const s = (re[k] ** 2 + im[k] ** 2) / (fs * u);
    p[k] = k === 0 || k === N / 2 ? s : 2 * s;
  }
  return { f, p };
}

/** Welch 法：50% 重叠分段平均 */
export function welch(x, fs, segLen) {
  const n = x.length;
  const L = Math.min(n, segLen);
  if (L < 8) return periodogram(x, fs);
  const step = Math.max(1, Math.floor(L / 2));
  const nfft = nextPow2(L);
  let acc = null, count = 0;
  for (let s = 0; s + L <= n; s += step) {
    const { f, p } = periodogram(x.subarray ? x.subarray(s, s + L) : x.slice(s, s + L), fs, nfft);
    if (!acc) acc = { f, p: Float64Array.from(p) };
    else for (let k = 0; k < p.length; k++) acc.p[k] += p[k];
    count++;
  }
  for (let k = 0; k < acc.p.length; k++) acc.p[k] /= count;
  return acc;
}

/** 频带功率（梯形积分） */
export function bandPower(f, p, lo, hi) {
  let s = 0;
  for (let k = 1; k < f.length; k++) {
    const fa = f[k - 1], fb = f[k];
    if (fb <= lo || fa >= hi) continue;
    s += 0.5 * (p[k - 1] + p[k]) * (fb - fa);
  }
  return s;
}

/**
 * 频谱 SQI：主频（及其 2 次谐波）±0.15 Hz 内功率占通带总功率的比例
 * 干净的 PPG 通常 > 0.5，运动伪迹/未贴合 < 0.3
 */
export function spectralSQI(x, fs, lo, hi) {
  const { f, p } = periodogram(x, fs, 1024);
  let kMax = -1;
  for (let k = 0; k < f.length; k++) {
    if (f[k] < lo || f[k] > hi) continue;
    if (kMax < 0 || p[k] > p[kMax]) kMax = k;
  }
  if (kMax < 0) return { sqi: 0, f0: 0 };
  // 抛物线插值主频
  let f0 = f[kMax];
  if (kMax > 0 && kMax < f.length - 1) {
    const a = p[kMax - 1], b = p[kMax], c = p[kMax + 1];
    const d = a - 2 * b + c;
    if (d !== 0) f0 += ((0.5 * (a - c)) / d) * (f[1] - f[0]);
  }
  const total = bandPower(f, p, lo, hi);
  const bw = 0.15;
  const sig = bandPower(f, p, f0 - bw, f0 + bw) + bandPower(f, p, 2 * f0 - bw, 2 * f0 + bw);
  return { sqi: total > 0 ? Math.min(1, sig / total) : 0, f0 };
}
