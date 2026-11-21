import { chain, gain, impulseResponse, noiseBuffer, softClipCurve } from './dsp.js';
import { soundLayers } from './layers.js';

/**
 * 音频引擎：各音效层 → 推子（淡入淡出）→ 总线 → 压缩 → 限幅 → 软削波 → 总音量。
 * 混响为共享 send/return。分析器用于界面峰值表与削波计数。
 */
export class AudioEngine {
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = null;
    this.layers = new Map();
    this.enabled = Object.fromEntries(Object.entries(cfg.layers).map(([k, v]) => [k, v.enabled !== false]));
    this.peak = 0;
    this.clips = 0;
  }

  get ready() {
    return !!this.ctx;
  }

  async start() {
    if (this.ctx) return this.ctx.resume();
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const c = this.cfg;

    this.bus = gain(ctx, 1);
    const comp = ctx.createDynamicsCompressor();
    const lim = ctx.createDynamicsCompressor();
    for (const [node, p] of [[comp, c.compressor], [lim, c.limiter]]) {
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[k].value = p[k];
    }
    this.master = gain(ctx, c.masterVolume);
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = '4x';
    chain(this.bus, comp, lim, ...(c.softClip ? [shaper] : []), this.master);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.meterBuf = new Float32Array(this.analyser.fftSize);
    this.master.connect(this.analyser);
    this.master.connect(ctx.destination);
    this.streamDest = ctx.createMediaStreamDestination();
    this.master.connect(this.streamDest);

    const conv = ctx.createConvolver();
    conv.buffer = impulseResponse(ctx, c.reverb.seconds, c.reverb.decay);
    const ret = gain(ctx, c.reverb.wet);
    const sendBus = gain(ctx, 1);
    chain(sendBus, conv, ret, this.bus);
    const reverb = {
      send: (amount) => {
        const g = gain(ctx, amount);
        g.connect(sendBus);
        return g;
      },
    };
    const noise = { white: noiseBuffer(ctx, 'white'), pink: noiseBuffer(ctx, 'pink'), brown: noiseBuffer(ctx, 'brown') };
    const env = { ctx, reverb, noise };

    for (const def of soundLayers.list()) {
      const lc = c.layers[def.id];
      if (!lc) continue;
      // 混响发送也经过该层推子，关闭/静音的层不会从混响里漏声
      const wet = gain(ctx, 0);
      wet.connect(sendBus);
      const send = (amount) => {
        const g = gain(ctx, amount);
        g.connect(wet);
        return g;
      };
      const inst = def.create({ ...env, reverb: { send } });
      const fader = gain(ctx, 0);
      inst.input.connect(fader);
      fader.connect(this.bus);
      this.layers.set(def.id, { def, inst, fader, wet, cfg: lc, level: 0, target: 0 });
    }
    this._applyFaders(true);
    return ctx.resume();
  }

  setMasterVolume(v) {
    this.cfg.masterVolume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setEnabled(id, on) {
    this.enabled[id] = on;
    this._applyFaders();
  }

  _applyFaders(force = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [id, L] of this.layers) {
      const lv = this.enabled[id] ? (L.def.oneShot ? 1 : L.target) * L.cfg.gain : 0;
      if (force || Math.abs(lv - L.level) > 0.002) {
        L.fader.gain.setTargetAtTime(lv, t, this.cfg.fadeSeconds / 3);
        L.wet.gain.setTargetAtTime(lv, t, this.cfg.fadeSeconds / 3);
        L.level = lv;
      }
    }
  }

  /**
   * @param levels {layerId: 0~1}
   * @param params { speed, intensity, pitchHz }
   */
  update(levels, params, dt) {
    if (!this.ctx) return;
    for (const [id, L] of this.layers) {
      const target = levels[id] || 0;
      if (target > 0.05 && L.target <= 0.05 && this.enabled[id]) L.inst.onEnter?.(params);
      L.target = target;
      L.inst.update?.(params, target, dt);
    }
    this._applyFaders();
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let pk = 0;
    for (const v of this.meterBuf) pk = Math.max(pk, Math.abs(v));
    this.peak = Math.max(pk, this.peak * 0.92);
    if (pk >= 0.999) this.clips++;
  }

  trigger(id, evt) {
    const L = this.layers.get(id);
    if (L && this.enabled[id]) L.inst.trigger?.(evt);
  }
}
