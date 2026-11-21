/**
 * ============================================================
 *  升降调模块（Pitch Shifter）
 *  基于相位声码器（Phase Vocoder，参考 S. M. Bernsee smbPitchShift 算法）
 *  —— 只改变音高、不改变速度，歌词时间轴保持不变。
 *  优先使用 AudioWorklet（独立音频线程，流畅），不支持时回退 ScriptProcessor。
 *  Worklet 代码通过 Blob URL 注入，保证本地 file:// 打开也可用。
 * ============================================================
 */
(function (global) {
  'use strict';

  /** DSP 核心：必须自包含（会被 toString() 注入到 AudioWorklet 线程） */
  function createPitchCore() {
    class FFT {
      constructor(n) {
        this.n = n;
        this.rev = new Uint32Array(n);
        const bits = Math.log2(n);
        for (let i = 0; i < n; i++) {
          let r = 0;
          for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
          this.rev[i] = r;
        }
        this.cos = new Float32Array(n / 2);
        this.sin = new Float32Array(n / 2);
        for (let i = 0; i < n / 2; i++) {
          this.cos[i] = Math.cos((2 * Math.PI * i) / n);
          this.sin[i] = Math.sin((2 * Math.PI * i) / n);
        }
      }
      /** 原地复数 FFT；inverse=true 时为逆变换（不做 1/N 归一化） */
      transform(re, im, inverse) {
        const n = this.n, rev = this.rev;
        for (let i = 0; i < n; i++) {
          const j = rev[i];
          if (j > i) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
          }
        }
        const sign = inverse ? 1 : -1;
        for (let size = 2; size <= n; size <<= 1) {
          const half = size >> 1, step = n / size;
          for (let i = 0; i < n; i += size) {
            for (let j = 0, k = 0; j < half; j++, k += step) {
              const c = this.cos[k], s = sign * this.sin[k];
              const a = i + j, b = a + half;
              const tr = re[b] * c - im[b] * s;
              const ti = re[b] * s + im[b] * c;
              re[b] = re[a] - tr; im[b] = im[a] - ti;
              re[a] += tr; im[a] += ti;
            }
          }
        }
      }
    }

    class PhaseVocoderChannel {
      constructor(sampleRate, frameSize = 2048, osamp = 4) {
        this.sr = sampleRate;
        this.N = frameSize;
        this.osamp = osamp;
        this.step = frameSize / osamp;
        this.latency = frameSize - this.step;
        this.fft = new FFT(frameSize);
        this.win = new Float32Array(frameSize);
        for (let k = 0; k < frameSize; k++) this.win[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / frameSize);
        const h = frameSize / 2 + 1;
        this.inFIFO = new Float32Array(frameSize);
        this.outFIFO = new Float32Array(frameSize);
        this.accum = new Float32Array(frameSize * 2);
        this.lastPhase = new Float32Array(h);
        this.sumPhase = new Float32Array(h);
        this.anaMagn = new Float32Array(h);
        this.anaFreq = new Float32Array(h);
        this.synMagn = new Float32Array(h);
        this.synFreq = new Float32Array(h);
        this.re = new Float32Array(frameSize);
        this.im = new Float32Array(frameSize);
        this.rover = this.latency;
        // 直通延迟线（原调时使用，保证与变调时延迟一致）
        this.delay = new Float32Array(this.latency + 1);
        this.dpos = 0;
        this.active = false;
      }
      reset() {
        this.inFIFO.fill(0); this.outFIFO.fill(0); this.accum.fill(0);
        this.lastPhase.fill(0); this.sumPhase.fill(0);
        this.rover = this.latency;
      }
      process(input, output, pitch) {
        const len = input.length;
        if (pitch === 1) {
          // 原调：仅延迟直通，音质无损
          const d = this.delay, L = d.length;
          for (let i = 0; i < len; i++) {
            d[this.dpos] = input[i];
            this.dpos = (this.dpos + 1) % L;
            output[i] = d[this.dpos];
          }
          this.active = false;
          return;
        }
        if (!this.active) { this.reset(); this.active = true; }
        const d = this.delay, L = d.length;
        const N = this.N, N2 = N / 2, step = this.step, osamp = this.osamp, lat = this.latency;
        const freqPerBin = this.sr / N, expct = (2 * Math.PI * step) / N;
        const re = this.re, im = this.im, win = this.win;
        for (let i = 0; i < len; i++) {
          d[this.dpos] = input[i]; this.dpos = (this.dpos + 1) % L;
          this.inFIFO[this.rover] = input[i];
          output[i] = this.outFIFO[this.rover - lat];
          this.rover++;
          if (this.rover >= N) {
            this.rover = lat;
            for (let k = 0; k < N; k++) { re[k] = this.inFIFO[k] * win[k]; im[k] = 0; }
            this.fft.transform(re, im, false);
            for (let k = 0; k <= N2; k++) {
              const magn = 2 * Math.sqrt(re[k] * re[k] + im[k] * im[k]);
              const phase = Math.atan2(im[k], re[k]);
              let tmp = phase - this.lastPhase[k];
              this.lastPhase[k] = phase;
              tmp -= k * expct;
              let qpd = (tmp / Math.PI) | 0;
              if (qpd >= 0) qpd += qpd & 1; else qpd -= qpd & 1;
              tmp -= Math.PI * qpd;
              tmp = (osamp * tmp) / (2 * Math.PI);
              this.anaMagn[k] = magn;
              this.anaFreq[k] = k * freqPerBin + tmp * freqPerBin;
            }
            this.synMagn.fill(0); this.synFreq.fill(0);
            for (let k = 0; k <= N2; k++) {
              const idx = Math.round(k * pitch);
              if (idx <= N2) {
                this.synMagn[idx] += this.anaMagn[k];
                this.synFreq[idx] = this.anaFreq[k] * pitch;
              }
            }
            for (let k = 0; k <= N2; k++) {
              let tmp = this.synFreq[k];
              tmp -= k * freqPerBin;
              tmp /= freqPerBin;
              tmp = (2 * Math.PI * tmp) / osamp;
              tmp += k * expct;
              this.sumPhase[k] += tmp;
              const ph = this.sumPhase[k];
              re[k] = this.synMagn[k] * Math.cos(ph);
              im[k] = this.synMagn[k] * Math.sin(ph);
            }
            for (let k = N2 + 1; k < N; k++) { re[k] = 0; im[k] = 0; }
            this.fft.transform(re, im, true);
            const scale = 2 / (N2 * osamp);
            for (let k = 0; k < N; k++) this.accum[k] += scale * win[k] * re[k];
            for (let k = 0; k < step; k++) this.outFIFO[k] = this.accum[k];
            this.accum.copyWithin(0, step, step + N);
            for (let k = 0; k < lat; k++) this.inFIFO[k] = this.inFIFO[k + step];
          }
        }
      }
    }
    return PhaseVocoderChannel;
  }

  const WORKLET_SRC = `
    const PhaseVocoderChannel = (${createPitchCore.toString()})();
    class KtvPitchProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.pitch = 1;
        this.ch = [new PhaseVocoderChannel(sampleRate), new PhaseVocoderChannel(sampleRate)];
        this.port.onmessage = (e) => { if (e.data && typeof e.data.pitch === 'number') this.pitch = e.data.pitch; };
      }
      process(inputs, outputs) {
        const inp = inputs[0], out = outputs[0];
        for (let c = 0; c < out.length; c++) {
          const src = inp[c] || inp[0];
          if (!src) { out[c].fill(0); continue; }
          this.ch[c % 2].process(src, out[c], this.pitch);
        }
        return true;
      }
    }
    registerProcessor('ktv-pitch-shifter', KtvPitchProcessor);
  `;

  /**
   * 创建升降调节点。返回 { input, output, setSemitones(n), kind }
   */
  async function createPitchShifterNode(ctx) {
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        // file:// 页面下 Blob URL 可能被拒绝，依次尝试 Blob URL / data URL
        const blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
        const dataUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(WORKLET_SRC);
        let loaded = false, lastErr = null;
        for (const url of location.protocol === 'file:' ? [dataUrl, blobUrl] : [blobUrl, dataUrl]) {
          try { await ctx.audioWorklet.addModule(url); loaded = true; break; } catch (e) { lastErr = e; }
        }
        URL.revokeObjectURL(blobUrl);
        if (!loaded) throw lastErr;
        const node = new AudioWorkletNode(ctx, 'ktv-pitch-shifter', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          channelCount: 2, channelCountMode: 'explicit',
        });
        return {
          kind: 'worklet', input: node, output: node,
          setSemitones(n) { node.port.postMessage({ pitch: Math.pow(2, n / 12) }); },
        };
      } catch (err) {
        console.warn('[PitchShifter] AudioWorklet 不可用，回退 ScriptProcessor：', err);
      }
    }
    const Core = createPitchCore();
    const sp = ctx.createScriptProcessor(2048, 2, 2);
    const chans = [new Core(ctx.sampleRate), new Core(ctx.sampleRate)];
    let pitch = 1;
    sp.onaudioprocess = (e) => {
      for (let c = 0; c < 2; c++) {
        const src = e.inputBuffer.getChannelData(Math.min(c, e.inputBuffer.numberOfChannels - 1));
        chans[c].process(src, e.outputBuffer.getChannelData(c), pitch);
      }
    };
    return { kind: 'script', input: sp, output: sp, setSemitones(n) { pitch = Math.pow(2, n / 12); } };
  }

  global.KTVPitch = { createPitchShifterNode, createPitchCore };
})(window);
