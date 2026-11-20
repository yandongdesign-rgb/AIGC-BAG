/** 内置音效层：全部用 Web Audio 实时合成（振荡器 + 噪声 + 滤波 + 包络 + 混响），无需音频文件 */
import { SoundLayer } from './layer.js';
import { Registry } from '../core/registry.js';
import { rand, pick } from '../core/math.js';

/** 待机：低通褐噪 + 慢速滤波摆动的环境底噪 */
class AmbientLayer extends SoundLayer {
  start() {
    this.g = this.gain(0);
    this.lp = this.filter('lowpass', 320, 0.7, this.g);
    this.n = this.noise('brown', true, this.lp); this.n.start();
    const lfo = this.osc('sine', 0.07); const d = this.gain(140, this.lp.frequency); lfo.connect(d); lfo.start();
    this.drone = this.osc('sine', 55, this.gain(0.05, this.g), true); this.drone.start();
  }
  update(dt, w, p) { this.to(this.g.gain, (0.05 + 0.22 * p.idle) * w, 0.6); }
}

/** 拖尾：流动空气感嗡鸣 + 随手速扫频 */
class TrailLayer extends SoundLayer {
  start() {
    this.g1 = this.gain(0);
    this.bp = this.filter('bandpass', 500, 1.3, this.g1);
    this.noise('white', true, this.bp).start();
    this.g2 = this.gain(0);
    this.lp = this.filter('lowpass', 400, 1.5, this.g2);
    [[110, 'sawtooth'], [110.7, 'sawtooth'], [55, 'triangle']].forEach(([f, t]) => this.osc(t, f, this.lp, true).start());
  }
  update(dt, w, p) {
    const s = p.trailSpeed || 0;
    this.to(this.g1.gain, w * (0.06 + 0.42 * s), 0.06);
    this.to(this.bp.frequency, 350 + 3400 * s, 0.05);
    this.to(this.g2.gain, w * (0.05 + 0.05 * s), 0.1);
    this.to(this.lp.frequency, 280 + 1100 * s, 0.08);
  }
}

/** 闪爆：低频冲击爆响 + 碎裂高频；握住时低沉隆隆声 */
class BurstLayer extends SoundLayer {
  start() {
    this.rg = this.gain(0);
    this.noise('brown', true, this.filter('lowpass', 110, 0.8, this.rg)).start();
  }
  update(dt, w) { this.to(this.rg.gain, w * 0.22, 0.12); }
  trigger(ev, p) {
    if (ev !== 'boom') return;
    const t = this.now + 0.005, k = p.intensity ?? 1;
    const pan = this.panner(p.x ?? 0.5);
    // 低频 boom：音高快速下坠
    const g = this.gain(0, pan); const o = this.osc('sine', 150, g);
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.45);
    this.env(g.gain, t, 0.004, 0.95 * k, 1.1); o.start(t); o.stop(t + 1.3);
    // 瞬态“啪”
    const g2 = this.gain(0, pan); const o2 = this.osc('triangle', 900, g2);
    o2.frequency.setValueAtTime(1100, t); o2.frequency.exponentialRampToValueAtTime(110, t + 0.04);
    this.env(g2.gain, t, 0.001, 0.35 * k, 0.07); o2.start(t); o2.stop(t + 0.15);
    // 冲击噪声
    const g3 = this.gain(0, pan); const lp = this.filter('lowpass', 2600, 0.9, g3);
    lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.6);
    const n = this.noise('white', false, lp); this.env(g3.gain, t, 0.003, 0.7 * k, 0.7); n.start(t, rand(0, 1)); n.stop(t + 0.9);
    // 碎裂高频：一串随机小碎响
    for (let i = 0; i < 16; i++) {
      const tt = t + 0.02 + Math.pow(Math.random(), 1.6) * 0.55;
      const gc = this.gain(0, this.panner(rand(0.1, 0.9)));
      const bp = this.filter('bandpass', rand(2800, 9500), 3, gc);
      const nc = this.noise('white', false, bp);
      this.env(gc.gain, tt, 0.001, rand(0.08, 0.3) * k, rand(0.012, 0.05));
      nc.start(tt, rand(0, 1.5)); nc.stop(tt + 0.08);
    }
  }
}

/** 闪电：持续电流嘶鸣/嗡响（随机闪烁）+ 每道电弧的噼啪 */
class LightningLayer extends SoundLayer {
  start() {
    this.hiss = this.gain(0);
    this.noise('white', true, this.filter('highpass', 4800, 0.7, this.hiss)).start();
    this.buzz = this.gain(0);
    const bp = this.filter('bandpass', 1500, 6, this.buzz);
    this.osc('sawtooth', 60, bp, true).start(); this.osc('sawtooth', 120.6, bp, true).start();
  }
  update(dt, w, p) {
    const l = p.lightning || 0;
    this.to(this.hiss.gain, l * 0.035, 0.05);
    this.to(this.buzz.gain, l * (0.015 + Math.random() * 0.06), 0.008);
  }
  trigger(ev, p) {
    if (ev !== 'zap') return;
    const t = this.now + 0.003, k = p.intensity ?? 1, pan = this.panner(p.x ?? 0.5);
    const dur = rand(0.04, 0.1);
    const g = this.gain(0, pan);
    const n = this.noise('white', false, this.filter('bandpass', rand(1800, 6500), 1.4, g));
    this.env(g.gain, t, 0.001, 0.32 * k, dur); n.start(t, rand(0, 1.5)); n.stop(t + dur + 0.05);
    // 高压嘶鸣：快速下扫的方波
    const g2 = this.gain(0, pan); const o = this.osc('square', 3000, this.filter('highpass', 900, 0.7, g2));
    o.frequency.setValueAtTime(rand(2600, 4200), t); o.frequency.exponentialRampToValueAtTime(rand(300, 700), t + 0.07);
    this.env(g2.gain, t, 0.001, 0.05 * k, 0.08); o.start(t); o.stop(t + 0.12);
  }
}

/** 漩涡：旋转上升音 + 吸入低音 + 随转速起伏的风声 */
class VortexLayer extends SoundLayer {
  start() {
    this.tg = this.gain(0);
    const lp = this.filter('lowpass', 2200, 1, this.tg);
    this.o1 = this.osc('triangle', 150, lp, true); this.o2 = this.osc('sine', 225, lp, true);
    this.o1.start(); this.o2.start();
    this.sg = this.gain(0); this.sub = this.osc('sine', 46, this.sg, true); this.sub.start();
    this.wg = this.gain(0);
    this.wbp = this.filter('bandpass', 600, 2.5, this.wg);
    this.noise('white', true, this.wbp).start();
    this.lfo = this.osc('sine', 2); this.lfoD = this.gain(0, this.wg.gain); this.lfo.connect(this.lfoD); this.lfo.start();
  }
  update(dt, w, p) {
    const v = p.vortex || 0, spin = p.vortexSpin || 1, size = p.vortexSize || 1;
    const f = (140 * Math.pow(2, Math.min(spin - 1, 2.2))) / Math.sqrt(size);
    this.to(this.o1.frequency, f, 0.08); this.to(this.o2.frequency, f * 1.5, 0.08);
    this.to(this.tg.gain, v * 0.07, 0.1);
    this.to(this.sg.gain, v * 0.32, 0.15);
    this.to(this.sub.frequency, 42 / Math.sqrt(size) + spin * 4, 0.1);
    this.to(this.wbp.frequency, 380 + 650 * spin, 0.1);
    this.to(this.wg.gain, v * 0.1, 0.1);
    this.to(this.lfoD.gain, v * 0.08, 0.1);
    this.to(this.lfo.frequency, 1.5 + spin * 2.4, 0.2);
  }
  trigger(ev) {
    if (ev !== 'suck') return;
    const t = this.now + 0.003;
    const g = this.gain(0); const bp = this.filter('bandpass', 3500, 2, g);
    bp.frequency.setValueAtTime(3800, t); bp.frequency.exponentialRampToValueAtTime(140, t + 0.6);
    const n = this.noise('white', false, bp); this.env(g.gain, t, 0.06, 0.4, 0.65); n.start(t, rand(0, 1)); n.stop(t + 0.8);
    const g2 = this.gain(0); const o = this.osc('sine', 300, g2);
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.6);
    this.env(g2.gain, t, 0.02, 0.4, 0.7); o.start(t); o.stop(t + 0.8);
  }
}

/** 四散：空灵铺底 pad + 细碎风铃 */
const PENTA = [1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.32, 2637.02, 3135.96];
class ScatterLayer extends SoundLayer {
  start() {
    this.send.gain.value = 0.85;
    this.pg = this.gain(0);
    const lp = this.filter('lowpass', 1700, 0.6, this.pg);
    const amp = this.gain(0.5, lp);
    [220, 329.63, 440, 554.37, 659.25, 987.77].forEach((f, i) => {
      // 用频率微偏（而非 detune）制造合唱感，detune 留给“双手音高跟随”
      this.osc('sine', f * 0.9966, amp, true).start();
      this.osc('triangle', f * (1.0035 + i * 0.0004), this.gain(0.4, amp), true).start();
    });
    const lfo = this.osc('sine', 0.16); lfo.connect(this.gain(0.18, amp.gain)); lfo.start();
  }
  update(dt, w, p) { this.to(this.pg.gain, (p.scatter || 0) * 0.09, 0.25); }
  trigger(ev, p) {
    if (ev !== 'chime') return;
    const t = this.now + 0.003, k = p.intensity ?? 1, f = pick(PENTA), pan = this.panner(rand(0.15, 0.85));
    for (const [mul, amp] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) {
      const g = this.gain(0, pan); const o = this.osc('sine', f * mul, g);
      this.env(g.gain, t, 0.003, 0.09 * k * amp, 1.5 / mul + 0.2); o.start(t); o.stop(t + 2);
    }
  }
}

/** 双手：音高随双手距离滑动（越近越高） */
class DualLayer extends SoundLayer {
  start() {
    this.g = this.gain(0);
    this.o1 = this.osc('sine', 440, this.g); this.o2 = this.osc('triangle', 880, this.gain(0.3, this.g));
    this.o1.start(); this.o2.start();
  }
  update(dt, w, p) {
    const f = 880 * Math.pow(2, -2 * (p.dualNorm ?? 0.5));
    this.to(this.o1.frequency, f, 0.05); this.to(this.o2.frequency, f * 2, 0.05);
    this.to(this.g.gain, w * 0.06, 0.1);
  }
}

/** 手势切换过渡音：柔和的滤波噪声扫频 */
class TransitionLayer extends SoundLayer {
  trigger(ev, p) {
    if (ev !== 'switch') return;
    const t = this.now + 0.003, up = p.to !== 'NONE';
    const g = this.gain(0); const bp = this.filter('bandpass', 800, 1.8, g);
    bp.frequency.setValueAtTime(up ? 300 : 2400, t); bp.frequency.exponentialRampToValueAtTime(up ? 2600 : 250, t + 0.28);
    const n = this.noise('white', false, bp); this.env(g.gain, t, 0.05, up ? 0.12 : 0.06, 0.28); n.start(t, rand(0, 1)); n.stop(t + 0.45);
  }
}

export function registerBuiltinSounds() {
  Registry.registerSound('ambient', AmbientLayer);
  Registry.registerSound('trail', TrailLayer);
  Registry.registerSound('burst', BurstLayer);
  Registry.registerSound('lightning', LightningLayer);
  Registry.registerSound('vortex', VortexLayer);
  Registry.registerSound('scatter', ScatterLayer);
  Registry.registerSound('dual', DualLayer);
  Registry.registerSound('transition', TransitionLayer);
}
