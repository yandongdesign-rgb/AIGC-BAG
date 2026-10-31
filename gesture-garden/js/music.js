/**
 * AmbientMusic —— 舒缓疗愈类纯音乐（Web Audio 实时生成，无需任何音频文件，无限循环）
 *
 * 结构：
 *   柔和 Pad 和弦（Cmaj9 → Am9 → Fmaj9 → G6/9，每个和弦 9 秒，缓起缓落）
 *   + 五声音阶风铃（随机、稀疏，花园越盛开越活跃）
 *   + 轻微风声（滤波噪声）
 *   → 低通 → 干声 / 混响（程序生成的脉冲响应） → 压缩 → 输出
 *
 * 若在 config.music.customUrl 中填写了音频文件路径，则改为循环播放该文件。
 */
(function () {
  const { clamp } = GG.util;
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // 和弦进行：bass + pad voices（MIDI）
  const PROGRESSION = [
    { bass: 36, voices: [55, 59, 62, 64] }, // Cmaj9
    { bass: 45, voices: [55, 59, 60, 64] }, // Am9
    { bass: 41, voices: [57, 60, 64, 67] }, // Fmaj9
    { bass: 43, voices: [57, 59, 62, 64] }, // G6/9
  ];
  // C 大调五声音阶（高音区风铃）
  const BELL_NOTES = [72, 74, 76, 79, 81, 84, 86, 88];

  class AmbientMusic {
    constructor(cfg) {
      this.cfg = cfg;
      this.ctx = null;
      this.playing = false;
      this.volume = cfg.volume;
      this.energy = 0;      // 0~1，由花园盛开程度驱动
      this.chordIndex = 0;
      this.timer = null;
      this.audioEl = null;
    }

    get isPlaying() { return this.playing; }

    async start() {
      if (this.playing) return;
      this.playing = true;

      if (this.cfg.customUrl) {
        if (!this.audioEl) {
          this.audioEl = new Audio(this.cfg.customUrl);
          this.audioEl.loop = true;
        }
        this.audioEl.volume = this.volume;
        try { await this.audioEl.play(); return; } catch (e) {
          console.warn('[music] 自定义音乐播放失败，改用内置生成音乐', e);
          this.audioEl = null;
        }
      }

      if (!this.ctx) this._build();
      await this.ctx.resume();
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(this.volume, now + 2.5);

      this.nextChordTime = Math.max(this.nextChordTime || 0, now + 0.05);
      this.nextBellTime = Math.max(this.nextBellTime || 0, now + 2.5);
      clearInterval(this.timer);
      this.timer = setInterval(() => this._schedule(), 200);
      this._schedule();
    }

    stop() {
      if (!this.playing) return;
      this.playing = false;
      if (this.audioEl) { this.audioEl.pause(); return; }
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0, now + 1.2);
      clearInterval(this.timer);
      this.timer = null;
    }

    toggle() { return this.playing ? (this.stop(), false) : (this.start(), true); }

    setVolume(v) {
      this.volume = clamp(v);
      if (this.audioEl) this.audioEl.volume = this.volume;
      if (this.ctx && this.playing) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.15);
    }

    setEnergy(e) { this.energy = clamp(e); }

    // ---------------------------------------------------------------- 音频图
    _build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC());

      this.master = ctx.createGain();
      this.master.gain.value = 0;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(ctx.destination);

      this.bus = ctx.createGain();
      this.bus.gain.value = 1;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3600;
      lp.Q.value = 0.3;
      this.bus.connect(lp);

      const dry = ctx.createGain();
      dry.gain.value = 0.62;
      const wet = ctx.createGain();
      wet.gain.value = 0.7;
      const reverb = ctx.createConvolver();
      reverb.buffer = this._impulse(5.5, 2.6);
      lp.connect(dry).connect(this.master);
      lp.connect(reverb).connect(wet).connect(this.master);

      this._buildWind();
    }

    /** 程序生成的混响脉冲响应 */
    _impulse(seconds, decay) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return buf;
    }

    /** 轻柔风声：粉红化噪声 + 缓慢摆动的带通滤波 */
    _buildWind() {
      const ctx = this.ctx;
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(bp.frequency);
      src.connect(bp).connect(g).connect(this.master);
      src.start();
      lfo.start();
    }

    // ---------------------------------------------------------------- 调度
    _schedule() {
      if (!this.playing || !this.ctx) return;
      const horizon = this.ctx.currentTime + 1.2;
      const chordDur = 9;

      while (this.nextChordTime < horizon) {
        this._playChord(PROGRESSION[this.chordIndex % PROGRESSION.length], this.nextChordTime, chordDur);
        this.chordIndex++;
        this.nextChordTime += chordDur;
      }

      while (this.nextBellTime < horizon) {
        const chord = PROGRESSION[(this.chordIndex - 1 + PROGRESSION.length) % PROGRESSION.length];
        this._playBell(this.nextBellTime, chord);
        // 花园越盛开，风铃越密集
        const base = 3.4 - 2.0 * this.energy;
        this.nextBellTime += base * (0.55 + Math.random() * 0.9);
      }
    }

    _playChord(chord, t, dur) {
      const attack = 3.2;
      const release = 4.5;
      const end = t + dur + release;
      chord.voices.forEach((m, i) => {
        this._padVoice(midiToFreq(m), t + i * 0.18, attack, dur, release, 0.034);
      });
      this._padVoice(midiToFreq(chord.bass), t, attack, dur, release, 0.05, true);
      return end;
    }

    _padVoice(freq, t, attack, hold, release, level, isBass) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + attack);
      g.gain.setValueAtTime(level, t + hold);
      g.gain.linearRampToValueAtTime(0, t + hold + release);
      g.connect(this.bus);

      const types = isBass ? ['sine'] : ['sine', 'triangle'];
      const detunes = isBass ? [0] : [-5, 6];
      types.forEach((type, i) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = detunes[i];
        const og = ctx.createGain();
        og.gain.value = type === 'triangle' ? 0.45 : 1;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + hold + release + 0.1);
      });
    }

    _playBell(t, chord) {
      const ctx = this.ctx;
      // 优先选择与当前和弦协和的音
      const chordPcs = chord.voices.map((m) => m % 12);
      const pool = BELL_NOTES.filter((m) => chordPcs.includes(m % 12) || Math.random() < 0.25);
      const note = pool[Math.floor(Math.random() * pool.length)] || 76;
      const f = midiToFreq(note);
      const vel = 0.035 + Math.random() * 0.03 + this.energy * 0.015;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.random() * 1.2 - 0.6; g.connect(pan).connect(this.bus); } else g.connect(this.bus);

      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = f;
      o1.connect(g);

      // 泛音（钟/钢片琴质感）
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2.76;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(vel * 0.35, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o2.connect(g2);
      if (pan) g2.connect(pan); else g2.connect(this.bus);

      o1.start(t); o2.start(t);
      o1.stop(t + 4.3); o2.stop(t + 1.4);
    }
  }

  GG.AmbientMusic = AmbientMusic;
})();
