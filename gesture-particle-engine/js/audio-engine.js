/**
 * Web Audio 音效引擎
 * 振荡器 + 噪声 + 包络 + 滤波 + 压缩限幅；每种手势对应独立层，可开关 / 淡入淡出
 */
(function (global) {
  'use strict';

  const U = global.GPUtils;

  class AudioEngine {
    constructor(config) {
      this.cfg = config;
      this.ctx = null;
      this.enabled = true;
      this.volume = 0.8;
      this.layers = {};
      this.activeLayers = new Set();
      this.lastTrigger = {};
      this.layerStates = {};
      this.started = false;
    }

    async init() {
      if (this.started) return this;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('浏览器不支持 Web Audio API');
      const ctx = new AC();
      this.ctx = ctx;
      // 不等待 resume：某些环境（无音频设备 / 无头浏览器）promise 可能长期挂起
      ctx.resume().catch(() => {});

      this.master = ctx.createGain();
      this.master.gain.value = this.volume;

      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 8;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;

      this.limiter = ctx.createGain();
      this.limiter.gain.value = 0.92;

      this.master.connect(this.compressor);
      this.compressor.connect(this.limiter);
      this.limiter.connect(ctx.destination);
      this.recordDest = ctx.createMediaStreamDestination();
      this.limiter.connect(this.recordDest);

      this.noiseBuffer = this._makeNoise(2);
      this._buildLayers();
      this.started = true;
      return this;
    }

    _makeNoise(seconds) {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    _noiseSource(loop) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuffer;
      s.loop = !!loop;
      return s;
    }

    _layer(name) {
      const def = (this.cfg.audioLayers || {})[name] || { gain: 0.1, fade: 0.3 };
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      const layer = { gain: g, base: def.gain, fade: def.fade, nodes: [] };
      this.layers[name] = layer;
      return layer;
    }

    _buildLayers() {
      const ctx = this.ctx;

      // 环境底噪：低通噪声 + 极低频嗡鸣
      {
        const l = this._layer('ambience');
        const n = this._noiseSource(true);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
        n.connect(lp); lp.connect(l.gain); n.start(); l.nodes.push(n);
        const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 52;
        const sg = ctx.createGain(); sg.gain.value = 0.18;
        sub.connect(sg); sg.connect(l.gain); sub.start(); l.nodes.push(sub);
      }

      // 流动空气：带通噪声（LFO 扫频）+ 轻正弦
      {
        const l = this._layer('flow');
        const n = this._noiseSource(true);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.1;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.28;
        const lfoG = ctx.createGain(); lfoG.gain.value = 420;
        lfo.connect(lfoG); lfoG.connect(bp.frequency);
        n.connect(bp); bp.connect(l.gain);
        n.start(); lfo.start(); l.nodes.push(n, lfo);
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 116;
        const og = ctx.createGain(); og.gain.value = 0.3;
        osc.connect(og); og.connect(l.gain); osc.start(); l.nodes.push(osc);
      }

      // 电流底噪：高通噪声
      {
        const l = this._layer('electric');
        const n = this._noiseSource(true);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2300;
        n.connect(hp); hp.connect(l.gain); n.start(); l.nodes.push(n);
      }

      // 漩涡：上升锯齿 + 低频吸入
      {
        const l = this._layer('rotation');
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 190;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
        osc.connect(lp); lp.connect(l.gain); osc.start(); l.nodes.push(osc);
        l.osc = osc;
        const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 68;
        const sg = ctx.createGain(); sg.gain.value = 0.5;
        sub.connect(sg); sg.connect(l.gain); sub.start(); l.nodes.push(sub);
        l.sub = sub;
      }

      // 空灵 pad：三音和弦 + 轻微失谐 LFO
      {
        const l = this._layer('pad');
        [220, 277.18, 329.63].forEach((f, i) => {
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
          const g = ctx.createGain(); g.gain.value = 0.26;
          const det = ctx.createOscillator(); det.frequency.value = 0.12 + i * 0.07;
          const dg = ctx.createGain(); dg.gain.value = 3.5;
          det.connect(dg); dg.connect(o.detune);
          o.connect(g); g.connect(l.gain); o.start(); det.start(); l.nodes.push(o, det);
        });
      }

      // 双手距离音高
      {
        const l = this._layer('dual');
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 330;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
        o.connect(lp); lp.connect(l.gain); o.start(); l.nodes.push(o);
        l.osc = o;
      }
    }

    getRecordStream() {
      return this.recordDest ? this.recordDest.stream : null;
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.ctx && this.master) {
        this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0,
          this.ctx.currentTime, 0.08);
      }
    }

    setVolume(v) {
      this.volume = U.clamp(v, 0, 1);
      if (this.ctx && this.master && this.enabled) {
        this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
      }
    }

    /** 根据当前手势状态设置各音效层的目标增益 */
    setState(state, gesture) {
      if (!this.ctx) return;
      const mapping = (this.cfg.gestures || []).find(g => g.id === state);
      const wanted = new Set(mapping && mapping.sound && mapping.sound.layers ? mapping.sound.layers : []);
      this.activeLayers = wanted;
      for (const name of Object.keys(this.layers)) {
        const l = this.layers[name];
        const on = wanted.has(name);
        const target = on ? l.base * U.clamp((gesture && gesture.confidence) || 0.85, 0.4, 1) : 0;
        l.gain.gain.setTargetAtTime(target, this.ctx.currentTime, Math.max(0.02, l.fade / 3));
      }
    }

    /** 每帧更新连续参数（音高随距离/速度滑动） */
    update(dt, gesture) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const rot = this.layers.rotation;
      if (rot && this.activeLayers.has('rotation')) {
        const speed = Math.abs((gesture && gesture.metrics && gesture.metrics.vy) || 0);
        const f = 150 + U.clamp(speed, 0, 1.2) * 210 + Math.sin(now * 2.1) * 24;
        rot.osc.frequency.setTargetAtTime(f, now, 0.08);
        rot.sub.frequency.setTargetAtTime(58 + U.clamp(speed, 0, 1) * 22, now, 0.1);
      }
      const dual = this.layers.dual;
      if (dual && this.activeLayers.has('dual')) {
        const norm = (gesture && gesture.dual && gesture.dual.norm) || 0;
        dual.osc.frequency.setTargetAtTime(240 + norm * 720, now, 0.07);
      }
    }

    trigger(name, intensity) {
      if (!this.ctx || !this.enabled) return;
      const def = (this.cfg.soundTriggers || {})[name] || { gain: 0.2, cooldown: 0.1 };
      const now = this.ctx.currentTime;
      if (now - (this.lastTrigger[name] || -99) < (def.cooldown || 0.1)) return;
      this.lastTrigger[name] = now;
      const amp = Math.max(0.001, def.gain * (intensity == null ? 1 : intensity));

      if (name === 'impact') this._impact(now, amp);
      else if (name === 'zap') this._zap(now, amp);
      else if (name === 'sweep') this._sweep(now, amp);
      else if (name === 'suck') this._suck(now, amp);
      else if (name === 'chime') this._chime(now, amp);
      else if (name === 'pitchSlide') this._pitchSlide(now, amp);
    }

    _env(gainNode, now, peak, attack, decay) {
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
      return now + attack + decay + 0.02;
    }

    _impact(now, amp) {
      const ctx = this.ctx;
      // 低频冲击：正弦快速下滑
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(165, now);
      o.frequency.exponentialRampToValueAtTime(38, now + 0.34);
      const g = ctx.createGain();
      this._env(g, now, amp, 0.006, 0.42);
      o.connect(g); g.connect(this.master); o.start(now); o.stop(now + 0.52);

      // 碎裂高频：噪声经高通
      const n = this._noiseSource(false);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1600;
      const ng = ctx.createGain();
      this._env(ng, now, amp * 0.5, 0.002, 0.18);
      n.connect(hp); hp.connect(ng); ng.connect(this.master); n.start(now); n.stop(now + 0.24);

      // 瞬态咔哒
      const c = ctx.createOscillator(); c.type = 'square'; c.frequency.value = 820;
      const cg = ctx.createGain(); this._env(cg, now, amp * 0.13, 0.001, 0.03);
      c.connect(cg); cg.connect(this.master); c.start(now); c.stop(now + 0.05);
    }

    _zap(now, amp) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(2800 + Math.random() * 900, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.13);
      const ws = ctx.createWaveShaper(); ws.curve = this._distortionCurve(60);
      const g = ctx.createGain(); this._env(g, now, amp * 0.6, 0.002, 0.14);
      osc.connect(ws); ws.connect(g); g.connect(this.master);
      osc.start(now); osc.stop(now + 0.2);

      const n = this._noiseSource(false);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3400; bp.Q.value = 1.8;
      const ng = ctx.createGain(); this._env(ng, now, amp * 0.4, 0.002, 0.11);
      n.connect(bp); bp.connect(ng); ng.connect(this.master); n.start(now); n.stop(now + 0.16);
    }

    _distortionCurve(amount) {
      const n = 1024, curve = new Float32Array(n), deg = Math.PI / 180;
      for (let i = 0; i < n; i++) {
        const x = i * 2 / n - 1;
        curve[i] = (3 + amount) * x * 20 * deg / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    }

    _sweep(now, amp) {
      const ctx = this.ctx;
      const n = this._noiseSource(false);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(320, now);
      bp.frequency.exponentialRampToValueAtTime(2600, now + 0.48);
      const g = ctx.createGain(); this._env(g, now, amp * 0.55, 0.12, 0.45);
      n.connect(bp); bp.connect(g); g.connect(this.master); n.start(now); n.stop(now + 0.65);

      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(280, now);
      o.frequency.exponentialRampToValueAtTime(620, now + 0.45);
      const og = ctx.createGain(); this._env(og, now, amp * 0.22, 0.1, 0.4);
      o.connect(og); og.connect(this.master); o.start(now); o.stop(now + 0.6);
    }

    _suck(now, amp) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(92, now);
      o.frequency.exponentialRampToValueAtTime(360, now + 0.55);
      const g = ctx.createGain(); this._env(g, now, amp * 0.7, 0.06, 0.6);
      o.connect(g); g.connect(this.master); o.start(now); o.stop(now + 0.72);

      const n = this._noiseSource(false);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1800, now);
      lp.frequency.exponentialRampToValueAtTime(180, now + 0.5);
      const ng = ctx.createGain(); this._env(ng, now, amp * 0.35, 0.05, 0.5);
      n.connect(lp); lp.connect(ng); ng.connect(this.master); n.start(now); n.stop(now + 0.62);
    }

    _chime(now, amp) {
      const ctx = this.ctx;
      const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      const base = scale[U.randInt(0, scale.length - 1)];
      [1, 2.01, 3.02].forEach((mul, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * mul;
        const g = ctx.createGain(); this._env(g, now + i * 0.02, amp * (0.5 / (i + 1)), 0.004, 1.3 - i * 0.25);
        o.connect(g); g.connect(this.master); o.start(now + i * 0.02); o.stop(now + 1.6);
      });
    }

    _pitchSlide(now, amp) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(220, now);
      o.frequency.exponentialRampToValueAtTime(760, now + 0.55);
      const g = ctx.createGain(); this._env(g, now, amp * 0.8, 0.09, 0.55);
      o.connect(g); g.connect(this.master); o.start(now); o.stop(now + 0.75);
    }

    transition(prev, next) {
      if (!this.ctx || prev === next) return;
      const now = this.ctx.currentTime;
      const n = this._noiseSource(false);
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(next === 'IDLE' ? 1800 : 500, now);
      bp.frequency.exponentialRampToValueAtTime(next === 'IDLE' ? 300 : 1900, now + 0.28);
      const g = this.ctx.createGain(); this._env(g, now, 0.045, 0.06, 0.24);
      n.connect(bp); bp.connect(g); g.connect(this.master); n.start(now); n.stop(now + 0.36);
    }
  }

  global.GPAudioEngine = AudioEngine;
})(window);
