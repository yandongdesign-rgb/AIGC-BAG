import { createRegistry } from '../core/registry.js';
import { chain, envelope, filter, gain, loopNoise, osc } from './dsp.js';

/**
 * 音效层注册表。每层 create(env) 返回：
 *  - input: 层内部输出节点（引擎会把它接到该层的推子上做淡入淡出）
 *  - update?(params, level, dt)  每帧调用；level 为平滑前的目标强度 0~1
 *  - onEnter?(params)            强度从 0 升起时调用（状态进入过渡音）
 *  - trigger?(evt)               一次性事件（握拳爆点、电弧 zap 等）
 *  - oneShot: true 表示推子常开，仅由 trigger 发声
 * env: { ctx, reverb, noise: {white,pink,brown} }
 */
export const soundLayers = createRegistry('sound');

const rnd = (a, b) => a + Math.random() * (b - a);

soundLayers.register('ambient', {
  create({ ctx, noise }) {
    const out = gain(ctx, 1);
    chain(loopNoise(ctx, noise.brown), filter(ctx, 'lowpass', 360), gain(ctx, 0.5), out);
    const lfo = osc(ctx, 'sine', 0.07);
    const lg = gain(ctx, 0.25);
    chain(lfo, lg, out.gain);
    chain(osc(ctx, 'sine', 55), gain(ctx, 0.05), out);
    return { input: out };
  },
});

soundLayers.register('air', {
  create({ ctx, noise, reverb }) {
    const out = gain(ctx, 1);
    const bp = filter(ctx, 'bandpass', 700, 1.4);
    chain(loopNoise(ctx, noise.pink), bp, gain(ctx, 0.9), out);
    const lp = filter(ctx, 'lowpass', 520, 1);
    const hum = gain(ctx, 0.12);
    for (const [f, d] of [[110, -7], [110, 7], [220, 3]]) chain(osc(ctx, 'sawtooth', f, d), lp);
    chain(lp, hum, out);
    out.connect(reverb.send(0.25));
    return {
      input: out,
      onEnter() {
        const t = ctx.currentTime;
        bp.frequency.cancelScheduledValues(t);
        bp.frequency.setValueAtTime(350, t);
        bp.frequency.exponentialRampToValueAtTime(2800, t + 0.55);
        bp.frequency.exponentialRampToValueAtTime(900, t + 1.2);
      },
      update({ speed = 0 }) {
        bp.frequency.setTargetAtTime(600 + Math.min(speed, 3) * 900, ctx.currentTime, 0.15);
        lp.frequency.setTargetAtTime(420 + Math.min(speed, 3) * 400, ctx.currentTime, 0.2);
      },
    };
  },
});

soundLayers.register('impact', {
  oneShot: true,
  create({ ctx, noise, reverb }) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    comp.attack.value = 0.001;
    comp.release.value = 0.2;
    const out = gain(ctx, 1);
    chain(comp, out);
    out.connect(reverb.send(0.35));
    return {
      input: out,
      trigger({ intensity = 1 } = {}) {
        const t = ctx.currentTime + 0.005;
        const k = 0.6 + 0.4 * Math.min(intensity, 1.5);
        // 低频冲击：下滑正弦
        const sub = osc(ctx, 'sine', 160);
        sub.frequency.setValueAtTime(160, t);
        sub.frequency.exponentialRampToValueAtTime(36, t + 0.45);
        const sg = gain(ctx, 0);
        envelope(sg.gain, t, 0.9 * k, 0.004, 0.9);
        chain(sub, sg, comp);
        sub.stop(t + 1.1);
        // 爆响躯体：低通噪声
        const body = ctx.createBufferSource();
        body.buffer = noise.white;
        const bg = gain(ctx, 0);
        envelope(bg.gain, t, 0.55 * k, 0.002, 0.3);
        chain(body, filter(ctx, 'lowpass', 900), bg, comp);
        body.start(t, Math.random());
        body.stop(t + 0.5);
        // 碎裂高频：高通噪声 + 随机碎片音
        const crack = ctx.createBufferSource();
        crack.buffer = noise.white;
        const cg = gain(ctx, 0);
        envelope(cg.gain, t + 0.01, 0.35 * k, 0.001, 0.2);
        chain(crack, filter(ctx, 'highpass', 2800), cg, comp);
        crack.start(t, Math.random());
        crack.stop(t + 0.4);
        for (let i = 0; i < 7; i++) {
          const ts = t + rnd(0.02, 0.3);
          const o = osc(ctx, 'triangle', rnd(2400, 6500));
          const g = gain(ctx, 0);
          envelope(g.gain, ts, rnd(0.04, 0.1) * k, 0.001, rnd(0.05, 0.18));
          chain(o, g, comp);
          o.stop(ts + 0.3);
        }
      },
    };
  },
});

soundLayers.register('electric', {
  create({ ctx, noise, reverb }) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 10;
    comp.attack.value = 0.001;
    comp.release.value = 0.1;
    const out = gain(ctx, 1);
    chain(comp, out);
    out.connect(reverb.send(0.15));
    // 高压嘶鸣
    const hiss = gain(ctx, 0.12);
    chain(loopNoise(ctx, noise.white), filter(ctx, 'highpass', 5200), hiss, comp);
    const buzzBp = filter(ctx, 'bandpass', 1900, 3);
    const buzz = gain(ctx, 0.22);
    chain(osc(ctx, 'sawtooth', 98), buzzBp);
    chain(osc(ctx, 'square', 147, 9), gain(ctx, 0.5), buzzBp);
    chain(buzzBp, buzz, comp);
    const trem = osc(ctx, 'square', 31);
    chain(trem, gain(ctx, 0.1), buzz.gain);
    return {
      input: out,
      onEnter() {
        const t = ctx.currentTime;
        const o = osc(ctx, 'sawtooth', 3200);
        o.frequency.exponentialRampToValueAtTime(900, t + 0.25);
        const g = gain(ctx, 0);
        envelope(g.gain, t, 0.12, 0.005, 0.25);
        chain(o, filter(ctx, 'bandpass', 2500, 2), g, comp);
        o.stop(t + 0.35);
      },
      // 噼啪：每次电弧重绘一次短促噪声脉冲
      trigger({ intensity = 1 } = {}) {
        const t = ctx.currentTime;
        const s = ctx.createBufferSource();
        s.buffer = noise.white;
        const g = gain(ctx, 0);
        envelope(g.gain, t, rnd(0.25, 0.6) * intensity, 0.001, rnd(0.015, 0.06));
        chain(s, filter(ctx, 'bandpass', rnd(1500, 5500), rnd(0.8, 3)), g, comp);
        s.start(t, Math.random());
        s.stop(t + 0.1);
      },
    };
  },
});

soundLayers.register('vortex', {
  create({ ctx, noise, reverb }) {
    const out = gain(ctx, 1);
    const pan = ctx.createStereoPanner();
    chain(pan, out);
    out.connect(reverb.send(0.3));
    const lp = filter(ctx, 'lowpass', 900, 6);
    const o1 = osc(ctx, 'sawtooth', 120);
    const o2 = osc(ctx, 'sawtooth', 180, 8);
    chain(o1, lp);
    chain(o2, lp);
    chain(lp, gain(ctx, 0.18), pan);
    const spin = osc(ctx, 'sine', 4);
    chain(spin, gain(ctx, 400), lp.frequency);
    chain(osc(ctx, 'sine', 0.9), pan.pan);
    // 吸入低音
    const sub = osc(ctx, 'sine', 48);
    const subG = gain(ctx, 0.35);
    chain(sub, subG, pan);
    chain(osc(ctx, 'sine', 7), gain(ctx, 0.15), subG.gain);
    chain(loopNoise(ctx, noise.brown), filter(ctx, 'lowpass', 220), gain(ctx, 0.5), pan);
    return {
      input: out,
      onEnter() {
        const t = ctx.currentTime;
        for (const [o, f] of [[o1, 110], [o2, 165]]) {
          o.frequency.cancelScheduledValues(t);
          o.frequency.setValueAtTime(f, t);
          o.frequency.exponentialRampToValueAtTime(f * 3.5, t + 2.6);
        }
      },
      update({ intensity = 1 }) {
        spin.frequency.setTargetAtTime(3 + intensity * 6, ctx.currentTime, 0.3);
      },
    };
  },
});

soundLayers.register('pad', {
  create({ ctx, reverb }) {
    const out = gain(ctx, 1);
    const lp = filter(ctx, 'lowpass', 900, 0.8);
    const pg = gain(ctx, 0.07);
    for (const f of [220, 277.18, 329.63, 493.88]) for (const d of [-7, 7]) chain(osc(ctx, 'sawtooth', f, d), lp);
    chain(lp, pg, out);
    chain(osc(ctx, 'sine', 0.11), gain(ctx, 450), lp.frequency);
    out.connect(reverb.send(0.8));
    const notes = [1318.5, 1568, 1760, 2093, 2349.3, 2637];
    let acc = 0;
    return {
      input: out,
      update({ intensity = 1 }, level, dt) {
        if (level < 0.05) return;
        acc += dt * (2 + 4 * intensity) * level;
        while (acc >= 1) {
          acc -= 1 + Math.random();
          const t = ctx.currentTime + Math.random() * 0.05;
          const o = osc(ctx, 'sine', notes[Math.floor(Math.random() * notes.length)]);
          const g = gain(ctx, 0);
          envelope(g.gain, t, rnd(0.05, 0.12), 0.003, rnd(1, 2));
          chain(o, g, out);
          o.stop(t + 2.2);
        }
      },
    };
  },
});

soundLayers.register('pitch', {
  create({ ctx, reverb }) {
    const out = gain(ctx, 1);
    const lp = filter(ctx, 'lowpass', 2200);
    const o1 = osc(ctx, 'triangle', 220);
    const o2 = osc(ctx, 'sine', 440);
    chain(o1, gain(ctx, 0.3), lp);
    chain(o2, gain(ctx, 0.12), lp);
    chain(lp, out);
    const vib = gain(ctx, 3);
    chain(osc(ctx, 'sine', 5.2), vib);
    vib.connect(o1.frequency);
    vib.connect(o2.frequency);
    out.connect(reverb.send(0.35));
    return {
      input: out,
      update({ pitchHz = 220 }) {
        const t = ctx.currentTime;
        o1.frequency.setTargetAtTime(pitchHz, t, 0.04);
        o2.frequency.setTargetAtTime(pitchHz * 2, t, 0.04);
      },
    };
  },
});

soundLayers.register('transition', {
  oneShot: true,
  create({ ctx, noise, reverb }) {
    const out = gain(ctx, 1);
    out.connect(reverb.send(0.4));
    return {
      input: out,
      trigger() {
        const t = ctx.currentTime;
        const s = ctx.createBufferSource();
        s.buffer = noise.pink;
        const bp = filter(ctx, 'bandpass', 300, 2);
        bp.frequency.setValueAtTime(300, t);
        bp.frequency.exponentialRampToValueAtTime(3200, t + 0.32);
        const g = gain(ctx, 0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.12);
        g.gain.linearRampToValueAtTime(0, t + 0.4);
        chain(s, bp, g, out);
        s.start(t, Math.random());
        s.stop(t + 0.45);
      },
    };
  },
});
