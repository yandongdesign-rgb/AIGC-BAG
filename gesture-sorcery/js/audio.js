// Web Audio 实时合成：背景音乐 + 持续法术音层 + 爆发音效（无需音频文件）
(function () {
  const SG = window.SG;
  const U = SG.U;

  class AudioFX {
    constructor(cfg) { this.cfg = cfg; this.ctx = null; this.loops = {}; this.musicOn = true; this.lastShot = {}; }

    init() {
      if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain(); this.master.gain.value = this.cfg.master;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
      this.master.connect(comp); comp.connect(ctx.destination);
      this.sfx = ctx.createGain(); this.sfx.gain.value = this.cfg.sfx; this.sfx.connect(this.master);
      this.music = ctx.createGain(); this.music.gain.value = this.cfg.music; this.music.connect(this.master);
      this.reverb = ctx.createConvolver(); this.reverb.buffer = this.makeIR(3.6, 2.6);
      const rv = ctx.createGain(); rv.gain.value = 0.7; this.reverb.connect(rv); rv.connect(this.master);
      this.sfxSend = ctx.createGain(); this.sfxSend.gain.value = 0.38; this.sfx.connect(this.sfxSend); this.sfxSend.connect(this.reverb);
      this.musicSend = ctx.createGain(); this.musicSend.gain.value = 0.55; this.music.connect(this.musicSend); this.musicSend.connect(this.reverb);
      this.noise = this.makeNoise(3);
      this.dist = this.makeCurve(3.5);
      this.buildLoops();
      this.startMusic();
    }

    get t() { return this.ctx.currentTime; }

    makeIR(sec, decay) {
      const ctx = this.ctx, len = (ctx.sampleRate * sec) | 0, b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return b;
    }
    makeNoise(sec) {
      const ctx = this.ctx, len = (ctx.sampleRate * sec) | 0, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    makeCurve(k) {
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k); }
      return c;
    }
    osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
    gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
    filt(type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; return b; }
    noiseSrc(loop) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = !!loop; s.loopStart = Math.random(); return s; }
    shaper() { const w = this.ctx.createWaveShaper(); w.curve = this.dist; w.oversample = '2x'; return w; }

    // ---------- 持续音层 ----------
    buildLoops() {
      const L = this.loops;
      const out = (name, maxGain) => { const g = this.gain(0); g.connect(this.sfx); L[name] = { g, max: maxGain, v: 0 }; return g; };

      { // 赫：低频锯齿 + 颤动滤波 + 嘶嘶声
        const g = out('red', 0.26);
        const f = this.filt('lowpass', 520, 6), sh = this.shaper();
        const o1 = this.osc('sawtooth', 55), o2 = this.osc('sawtooth', 82.6);
        const lfo = this.osc('sine', 7), lg = this.gain(260); lfo.connect(lg); lg.connect(f.frequency);
        o1.connect(f); o2.connect(f); f.connect(sh); sh.connect(g);
        const n = this.noiseSrc(true), nb = this.filt('bandpass', 2400, 2), ng = this.gain(0.18);
        n.connect(nb); nb.connect(ng); ng.connect(g);
        [o1, o2, lfo, n].forEach((s) => s.start());
        L.red.osc = [o1, o2];
      }
      { // 苍：吸入风声 + 次低频
        const g = out('blue', 0.34);
        const n = this.noiseSrc(true), f = this.filt('lowpass', 600, 8);
        const lfo = this.osc('sine', 0.7), lg = this.gain(500); lfo.connect(lg); lg.connect(f.frequency);
        const sub = this.osc('sine', 41), sg = this.gain(0.7);
        const trem = this.osc('sine', 5), tg = this.gain(0.35); trem.connect(tg); tg.connect(sg.gain);
        n.connect(f); f.connect(g); sub.connect(sg); sg.connect(g);
        const hi = this.osc('sine', 1760), hg = this.gain(0.025); hi.connect(hg); hg.connect(g);
        [n, lfo, sub, trem, hi].forEach((s) => s.start());
        L.blue.osc = [hi];
      }
      { // 茈 蓄力：两个逐渐靠拢的音高 + 上升噪声
        const g = out('purple', 0.3);
        const o1 = this.osc('sawtooth', 110), o2 = this.osc('sawtooth', 116), f = this.filt('lowpass', 900, 3);
        o1.connect(f); o2.connect(f); f.connect(g);
        const n = this.noiseSrc(true), nb = this.filt('bandpass', 800, 1.5), ng = this.gain(0.6);
        n.connect(nb); nb.connect(ng); ng.connect(g);
        [o1, o2, n].forEach((s) => s.start());
        L.purple.osc = [o1, o2]; L.purple.f = f; L.purple.nb = nb;
      }
      { // 握拳蓄力
        const g = out('charge', 0.16);
        const o = this.osc('triangle', 220), o2 = this.osc('sine', 331);
        const trem = this.osc('square', 8), tg = this.gain(0.5), vg = this.gain(0.5);
        trem.connect(tg); tg.connect(vg.gain); o.connect(vg); o2.connect(vg); vg.connect(g);
        [o, o2, trem].forEach((s) => s.start());
        L.charge.osc = [o, o2]; L.charge.trem = trem;
      }
      { // 雷霆：电流嗡鸣 + 噼啪
        const g = out('zap', 0.3);
        const o = this.osc('sawtooth', 60), sh = this.shaper(), bp = this.filt('bandpass', 1100, 1.2), og = this.gain(0.35);
        o.connect(sh); sh.connect(bp); bp.connect(og); og.connect(g);
        const n = this.noiseSrc(true), hp = this.filt('highpass', 2500), cg = this.gain(0);
        n.connect(hp); hp.connect(cg); cg.connect(g);
        [o, n].forEach((s) => s.start());
        L.zap.crackle = cg;
      }
      { // 狐火：呼啸火焰
        const g = out('flame', 0.42);
        const n = this.noiseSrc(true), lp = this.filt('lowpass', 700, 0.7), bp = this.filt('bandpass', 260, 0.9), fg = this.gain(1);
        const lfo = this.osc('sine', 2.3), lg = this.gain(0.4); lfo.connect(lg); lg.connect(fg.gain);
        n.connect(lp); lp.connect(bp); bp.connect(fg); fg.connect(g);
        const n2 = this.noiseSrc(true), hp = this.filt('bandpass', 3200, 3), cg = this.gain(0.08);
        n2.connect(hp); hp.connect(cg); cg.connect(g);
        [n, lfo, n2].forEach((s) => s.start());
      }
      { // 法阵：空灵和弦垫
        const g = out('circle', 0.12);
        [220, 329.63, 440, 493.88, 659.25].forEach((f, i) => {
          const o = this.osc(i % 2 ? 'sine' : 'triangle', f), og = this.gain(0.2);
          const l = this.osc('sine', 0.2 + i * 0.07), lg = this.gain(0.15); l.connect(lg); lg.connect(og.gain);
          o.connect(og); og.connect(g); o.start(); l.start();
        });
      }
      { // 领域：合唱共振峰
        const g = out('domain', 0.22);
        const f1 = this.filt('bandpass', 760, 6), f2 = this.filt('bandpass', 1150, 7), mix = this.gain(1);
        [73.42, 146.83, 220, 293.66, 349.23, 440].forEach((f) => {
          for (const det of [-7, 7]) { const o = this.osc('sawtooth', f); o.detune.value = det; o.connect(f1); o.connect(f2); o.start(); }
        });
        f1.connect(mix); f2.connect(mix); mix.connect(g);
        const sub = this.osc('sine', 36.7), sg = this.gain(1.2); sub.connect(sg); sg.connect(g); sub.start();
      }
    }

    // value: 0..1，param: 可选 (蓄力程度等)
    setLoop(name, value, param) {
      if (!this.ctx) return;
      const L = this.loops[name]; if (!L) return;
      const v = U.clamp(value, 0, 1);
      if (Math.abs(v - L.v) > 0.01 || (v === 0 && L.v !== 0)) { L.g.gain.setTargetAtTime(v * L.max, this.t, 0.06); L.v = v; }
      const t = this.t;
      if (name === 'purple' && param !== undefined) {
        L.osc[0].frequency.setTargetAtTime(110 + 330 * param, t, 0.1);
        L.osc[1].frequency.setTargetAtTime((110 + 330 * param) * (1.06 - 0.055 * param), t, 0.1);
        L.f.frequency.setTargetAtTime(700 + 3200 * param, t, 0.1);
        L.nb.frequency.setTargetAtTime(600 + 3000 * param, t, 0.1);
      }
      if (name === 'charge' && param !== undefined) {
        L.osc[0].frequency.setTargetAtTime(200 + 700 * param, t, 0.05);
        L.osc[1].frequency.setTargetAtTime(300 + 1050 * param, t, 0.05);
        L.trem.frequency.setTargetAtTime(6 + 26 * param, t, 0.05);
      }
      if (name === 'red' && param !== undefined) {
        L.osc[0].frequency.setTargetAtTime(55 * (1 + 0.5 * param), t, 0.1);
        L.osc[1].frequency.setTargetAtTime(82.6 * (1 + 0.5 * param), t, 0.1);
      }
      if (name === 'zap' && v > 0.05) {
        // 随机噼啪
        const c = L.crackle.gain;
        c.cancelScheduledValues(t);
        c.setValueAtTime(0, t);
        for (let k = 0; k < 3; k++) {
          const s = t + Math.random() * 0.05;
          c.setValueAtTime(Math.random() * 1.6 * v, s); c.setValueAtTime(0, s + 0.004 + Math.random() * 0.012);
        }
      }
    }

    // ---------- 一次性音效 ----------
    env(node, t, a, peak, d) { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

    boom(t, power, f0, f1, dur) {
      const o = this.osc('sine', f0), g = this.gain(0), sh = this.shaper();
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
      this.env(g, t, 0.005, 0.9 * power, dur);
      o.connect(sh); sh.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.1);
    }
    noiseHit(t, power, type, f0, f1, dur, q) {
      const n = this.noiseSrc(false), f = this.filt(type, f0, q || 0.8), g = this.gain(0);
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      this.env(g, t, 0.003, power, dur);
      n.connect(f); f.connect(g); g.connect(this.sfx); n.start(t); n.stop(t + dur + 0.1);
    }
    ring(t, freqs, power, dur, type) {
      freqs.forEach((f, i) => {
        const o = this.osc(type || 'sine', f), g = this.gain(0);
        this.env(g, t + i * 0.002, 0.004, power / freqs.length, dur * (1 - i * 0.08));
        o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.2);
      });
    }
    sweep(t, f0, f1, dur, power, type) {
      const o = this.osc(type || 'sine', f0), g = this.gain(0);
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(power, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.1);
    }
    gate(name, sec) { const now = performance.now(); if (this.lastShot[name] && now - this.lastShot[name] < sec * 1000) return false; this.lastShot[name] = now; return true; }

    play(name, power = 1) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = this.t + 0.005;
      switch (name) {
        case 'igniteRed':
          if (!this.gate(name, 0.25)) return;
          this.sweep(t, 900, 120, 0.35, 0.35, 'sawtooth'); this.noiseHit(t, 0.3, 'bandpass', 5000, 800, 0.25, 2); break;
        case 'igniteBlue':
          if (!this.gate(name, 0.25)) return;
          this.sweep(t, 140, 1100, 0.45, 0.3, 'sine'); this.noiseHit(t, 0.25, 'lowpass', 300, 3000, 0.4, 3); break;
        case 'fuse':
          this.sweep(t, 220, 1760, 0.6, 0.45, 'sawtooth'); this.ring(t + 0.4, [440, 660, 990, 1320], 0.5, 2.2, 'sine');
          this.noiseHit(t, 0.5, 'bandpass', 400, 6000, 0.6, 1.5); this.boom(t + 0.45, 0.6, 120, 40, 0.8); break;
        case 'burst':
          this.boom(t, 0.7 + 0.4 * power, 160, 34, 0.5 + 0.5 * power);
          this.noiseHit(t, 0.9 * power, 'lowpass', 9000, 260, 0.9 + 0.6 * power, 0.6);
          this.noiseHit(t, 0.6, 'highpass', 6000, 3000, 0.08, 0.7);
          this.ring(t, [1318.5, 1975.5, 2637], 0.22 * power, 1.6); break;
        case 'purpleRelease':
          this.boom(t, 1.3, 180, 24, 2.2); this.boom(t + 0.08, 0.8, 90, 30, 1.6);
          this.noiseHit(t, 1.2, 'lowpass', 12000, 120, 3.2, 0.5);
          this.noiseHit(t, 0.7, 'highpass', 8000, 2000, 0.15, 0.7);
          this.ring(t, [523.25, 787.3, 1131.7, 1567.9, 2093], 0.45, 3.5, 'sine');
          this.sweep(t, 2400, 60, 1.6, 0.35, 'sawtooth');
          [0.45, 0.9, 1.4].forEach((d, i) => this.noiseHit(t + d, 0.45 / (i + 1), 'lowpass', 900, 80, 1.2, 0.6)); break;
        case 'blackFlash':
          this.noiseHit(t, 1.3, 'highpass', 7000, 2500, 0.06, 0.8);
          this.boom(t, 1.1, 120, 28, 0.9);
          { const o = this.osc('square', 48), sh = this.shaper(), g = this.gain(0); this.env(g, t, 0.002, 0.5, 0.45); o.connect(sh); sh.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.6); }
          this.ring(t + 0.02, [3520, 4186, 5274], 0.25, 0.9, 'sine');
          this.noiseHit(t + 0.03, 0.6, 'bandpass', 1400, 200, 0.7, 2); break;
        case 'thunder':
          if (!this.gate(name, 0.3)) return;
          this.noiseHit(t, 0.9 * power, 'highpass', 5000, 1500, 0.1, 0.6);
          this.noiseHit(t + 0.03, 0.7 * power, 'lowpass', 1800, 60, 1.6, 0.7);
          this.boom(t, 0.4 * power, 90, 30, 0.8); break;
        case 'circle':
          if (!this.gate(name, 0.8)) return;
          [659.25, 880, 987.77, 1318.5].forEach((f, i) => this.ring(t + i * 0.07, [f, f * 2.01], 0.18, 1.8)); break;
        case 'flameOn':
          if (!this.gate(name, 0.5)) return;
          this.noiseHit(t, 0.6, 'lowpass', 200, 2400, 0.5, 1.2); this.boom(t, 0.3, 90, 50, 0.4); break;
        case 'domainStart':
          this.sweep(t, 80, 2400, 1.0, 0.25, 'sawtooth'); this.noiseHit(t, 0.4, 'bandpass', 200, 8000, 1.0, 2); break;
        case 'domain':
          this.boom(t, 1.2, 70, 22, 3.0);
          this.ring(t, [146.83, 220, 293.66, 369.99, 440, 587.33, 880], 0.6, 6, 'triangle');
          this.ring(t + 0.1, [1174.7, 1568, 2349], 0.2, 5, 'sine');
          this.noiseHit(t, 0.8, 'lowpass', 6000, 100, 4, 0.5); break;
        case 'domainEnd':
          this.sweep(t, 1500, 60, 1.2, 0.25, 'sine'); this.noiseHit(t, 0.4, 'lowpass', 4000, 80, 1.2, 0.5); break;
        case 'dissipate':
          this.noiseHit(t, 0.35, 'bandpass', 2500, 300, 0.5, 1); break;
      }
    }

    // ---------- 背景音乐：暗黑史诗氛围 ----------
    startMusic() {
      const ctx = this.ctx;
      const drone = this.gain(0.1), lp = this.filt('lowpass', 320, 2);
      const lfo = this.osc('sine', 0.06), lg = this.gain(180); lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      [36.71, 73.42, 110.0].forEach((f, i) => { const o = this.osc('sawtooth', f); o.detune.value = (i - 1) * 6; o.connect(lp); o.start(); });
      lp.connect(drone); drone.connect(this.music);
      this.musicLP = this.filt('lowpass', 20000); this.musicLP.connect(this.music);
      const chords = [
        [146.83, 220.0, 293.66, 349.23], // Dm
        [116.54, 174.61, 233.08, 293.66], // Bb
        [130.81, 196.0, 261.63, 329.63], // C
        [110.0, 164.81, 220.0, 277.18], // A
      ];
      const scale = [587.33, 698.46, 783.99, 880, 1046.5, 1174.66, 1396.9];
      let next = ctx.currentTime + 0.2, beat = 0;
      const BEAT = 0.75;
      const tick = () => {
        if (!this.musicOn) { next = ctx.currentTime + 0.2; return; }
        while (next < ctx.currentTime + 0.4) {
          const t = next, bar = Math.floor(beat / 8) % chords.length, step = beat % 8;
          if (step === 0) chords[bar].forEach((f) => this.pad(t, f, BEAT * 8));
          if (step === 0 || step === 3 || step === 4) this.kick(t, step === 0 ? 0.55 : 0.35);
          if (step === 6) this.tom(t, 0.22);
          if (Math.random() < 0.32) this.pluck(t + (Math.random() < 0.5 ? 0 : BEAT / 2), U.pick(scale));
          next += BEAT; beat++;
        }
      };
      this.musicTimer = setInterval(tick, 100);
      tick();
    }
    pad(t, f, dur) {
      const g = this.gain(0), lp = this.filt('lowpass', 1200, 0.5);
      for (const det of [-9, 9]) { const o = this.osc('sawtooth', f); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 2.5); }
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 1.8); g.gain.setValueAtTime(0.03, t + dur - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 2.4);
      lp.connect(g); g.connect(this.musicLP);
    }
    kick(t, p) {
      const o = this.osc('sine', 90), g = this.gain(0);
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
      this.env(g, t, 0.004, p, 0.45); o.connect(g); g.connect(this.musicLP); o.start(t); o.stop(t + 0.6);
    }
    tom(t, p) {
      const n = this.noiseSrc(false), f = this.filt('bandpass', 180, 3), g = this.gain(0);
      this.env(g, t, 0.003, p * 2, 0.35); n.connect(f); f.connect(g); g.connect(this.musicLP); n.start(t); n.stop(t + 0.5);
    }
    pluck(t, f) {
      const o = this.osc('triangle', f), o2 = this.osc('sine', f * 2), g = this.gain(0);
      this.env(g, t, 0.004, 0.05, 1.8); o.connect(g); o2.connect(g); g.connect(this.musicLP); o.start(t); o2.start(t); o.stop(t + 2); o2.stop(t + 2);
    }

    // 领域展开时音乐压低
    duck(amount) { if (this.musicLP) this.musicLP.frequency.setTargetAtTime(20000 * (1 - amount) + 500 * amount, this.t, 0.3); }
    toggleMusic() {
      this.musicOn = !this.musicOn;
      if (this.music) this.music.gain.setTargetAtTime(this.musicOn ? this.cfg.music : 0, this.t, 0.3);
      return this.musicOn;
    }
  }

  SG.AudioFX = AudioFX;
})();
