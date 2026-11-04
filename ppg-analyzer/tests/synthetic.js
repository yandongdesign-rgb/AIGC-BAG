/**
 * 合成 PPG 信号生成器：用于离线验证算法（也可作为课堂作业的“金标准”数据）
 * 心搏序列含 LF(0.1 Hz) 与 HF(0.25 Hz, 呼吸性窦性心律不齐) 调制
 */

export function makeBeats({ duration = 120, hr = 72, lfAmp = 30, hfAmp = 40, seed = 1 } = {}) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const base = 60000 / hr;
  const beats = [];
  let t = 0.3;
  while (t < duration) {
    const ibi = base + lfAmp * Math.sin(2 * Math.PI * 0.1 * t) + hfAmp * Math.sin(2 * Math.PI * 0.25 * t) + (rand() - 0.5) * 10;
    beats.push(t);
    t += ibi / 1000;
  }
  return beats;
}

/** 单个脉搏波：收缩期主峰 + 重搏波 */
function pulseShape(dt) {
  if (dt < -0.4 || dt > 1.2) return 0;
  const g = (mu, sd, a) => a * Math.exp(-((dt - mu) ** 2) / (2 * sd * sd));
  return g(0.0, 0.07, 1) + g(0.3, 0.09, 0.35);
}

/**
 * 模拟摄像头采样（帧间隔抖动）
 * @returns {{frames: {t,r,g,b}[], beats: number[]}}
 */
export function makeCameraFrames({ duration = 120, fps = 30, jitterMs = 4, noise = 0.15, seed = 7, ...rest } = {}) {
  const beats = makeBeats({ duration, ...rest });
  let s = seed;
  const rand = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const frames = [];
  let k = 0;
  for (let t = 0; t < duration; t += 1 / fps + ((rand() - 0.5) * 2 * jitterMs) / 1000) {
    while (k < beats.length - 1 && beats[k + 1] <= t) k++;
    // beats 为收缩期峰时刻（金标准）
    let p = 0;
    for (let j = Math.max(0, k - 3); j <= Math.min(beats.length - 1, k + 3); j++) p += pulseShape(t - beats[j]);
    const drift = 6 * Math.sin(2 * Math.PI * 0.03 * t) + 2 * Math.sin(2 * Math.PI * 0.2 * t);
    const r = 200 - 2.5 * p + drift + (rand() - 0.5) * 2 * noise * 3;
    frames.push({ t, r, g: r * 0.25, b: r * 0.2 });
  }
  return { frames, beats };
}
