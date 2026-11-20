/**
 * 音频引擎：各音效层 → 总线 → 压缩器 → 限幅器 → 软削波 → 主音量
 * 混响：程序生成的脉冲响应（ConvolverNode）。
 * 双手距离 → 所有“可调音”振荡器的 detune（音高跟随）。
 */
import { Registry } from '../core/registry.js';

export class AudioEngine {
  constructor(cfg) {
    this.cfg = cfg;
    this.layers = new Map();
    this.tunables = [];
    this.started = false;
    this.peakDb = -Infinity;
  }

  async start() {
    if (this.started) return;
    const ac = (this.ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));
    const A = this.cfg.audio;

    this.master = ac.createGain(); this.master.gain.value = A.masterVolume;
    const clip = ac.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 1.1) / Math.tanh(1.1); }
    clip.curve = curve; clip.oversample = '2x';
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.bus = ac.createGain();
    this.bus.connect(comp); comp.connect(limiter); limiter.connect(clip); clip.connect(this.master);
    this.master.connect(ac.destination);
    this.analyser = ac.createAnalyser(); this.analyser.fftSize = 1024;
    this.master.connect(this.analyser);
    this.meterBuf = new Float32Array(this.analyser.fftSize);

    // 混响
    this.reverbIn = ac.createGain();
    const conv = ac.createConvolver(); conv.buffer = this.impulse(A.reverbSeconds);
    const wet = ac.createGain(); wet.gain.value = 0.35;
    this.reverbIn.connect(conv); conv.connect(wet); wet.connect(comp);

    // 噪声缓冲
    const len = ac.sampleRate * 2;
    this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    this.brownBuf = ac.createBuffer(1, len, ac.sampleRate);
    const w = this.noiseBuf.getChannelData(0), b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5;
    }

    for (const id of Registry.soundIds()) {
      const Cls = Registry.getSound(id);
      const lc = { enabled: true, volume: 0.7, ...(A.layers[id] || {}) };
      try { const L = new Cls(this, lc); L.start(); this.layers.set(id, L); } catch (e) { console.error('音效层启动失败', id, e); }
    }
    await ac.resume();
    this.started = true;
  }

  impulse(sec) {
    const ac = this.ac, n = Math.floor(ac.sampleRate * sec);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return buf;
  }

  setEnabled(id, on) { this.layers.get(id)?.setEnabled(on); if (this.cfg.audio.layers[id]) this.cfg.audio.layers[id].enabled = on; }
  setMaster(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ac.currentTime, 0.05); }

  trigger(id, ev, params = {}) {
    if (!this.started) return;
    const L = this.layers.get(id);
    if (L && L.enabled) { try { L.trigger(ev, params); } catch (e) { console.warn(e); } }
  }

  /** weights: { layerId: 0~1 }，params: 实时参数 */
  update(dt, weights, params) {
    if (!this.started) return;
    for (const [id, L] of this.layers) L.update(dt, weights[id] || 0, params);
    const cents = params.dualActive ? (0.5 - params.dualNorm) * 900 : 0; // 双手越近音越高
    if (Math.abs(cents - (this._cents || 0)) > 2) {
      this._cents = cents;
      const t = this.ac.currentTime;
      for (const d of this.tunables) d.setTargetAtTime(cents, t, 0.06);
    }
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let pk = 0; for (let i = 0; i < this.meterBuf.length; i += 2) pk = Math.max(pk, Math.abs(this.meterBuf[i]));
    const db = 20 * Math.log10(pk + 1e-6);
    this.peakDb = Math.max(db, this.peakDb - dt * 20);
  }
}
