// 无摄像头演示：鼠标 + 数字键 1~9 施法，或自动巡演全部法术
(function () {
  const SG = window.SG;
  const U = SG.U;
  const mk = SG.Synth.makeHand;

  class Demo {
    constructor() { this.keys = new Set(); this.mx = innerWidth / 2; this.my = innerHeight * 0.55; this.mouseT = -1e9; this.script = null; this.auto = false; this.autoIdx = 0; this.t = 0; this.releaseOpen = 0; }

    onMouse(x, y, now) { this.mx = x; this.my = y; this.mouseT = now; }
    keyDown(k) {
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (k === '3') this.play(this.purpleScript());
      if (k === '8') this.play(this.domainScript());
      if (k === '9') this.play(this.blackScript());
    }
    keyUp(k) { this.keys.delete(k); if (k === '4') this.releaseOpen = 0.6; }
    play(fn) { this.script = { fn, t: 0 }; }
    toggleAuto() { this.auto = !this.auto; this.autoIdx = 0; this.script = null; return this.auto; }

    // ---- 脚本 ----
    purpleScript() {
      return (t, W, H, s) => {
        if (t > 3.6) return null;
        const cx = W / 2, cy = H * 0.5, k = U.easeOutCubic(U.clamp((t - 0.6) / 1.1, 0, 1));
        const gap = U.lerp(W * 0.32, s * 0.55, k);
        return [{ lm: mk(cx - gap, cy, t < 2.6 ? 'point' : 'open', s, -0.15), gesture: t < 2.6 ? 'point' : 'open' }, { lm: mk(cx + gap, cy, 'pinch', s, 0.15), gesture: 'pinch' }];
      };
    }
    domainScript() {
      return (t, W, H, s) => (t > 1.6 ? null : [{ lm: mk(W * 0.3, H * 0.55, 'open', s, -0.3), gesture: 'open' }, { lm: mk(W * 0.7, H * 0.55, 'open', s, 0.3), gesture: 'open' }]);
    }
    blackScript() {
      return (t, W, H, s) => {
        if (t > 1.1) return null;
        const k = U.clamp((t - 0.5) / 0.22, 0, 1);
        return [{ lm: mk(U.lerp(W * 0.2, W * 0.62, U.easeInCubic(k)), H * 0.55, 'fist', s), gesture: 'fist' }];
      };
    }
    hold(g, dur, two, move) {
      return (t, W, H, s) => {
        if (t > dur) return null;
        const x = W * 0.5 + Math.sin(t * 1.3) * W * (move || 0.12), y = H * 0.55 + Math.cos(t * 1.7) * H * 0.06;
        if (!two) return [{ lm: mk(x, y, g, s), gesture: g }];
        return [{ lm: mk(W * 0.5 - (x - W * 0.5) - W * 0.18, y, g, s, -0.2), gesture: g }, { lm: mk(x + W * 0.18, y, g, s, 0.2), gesture: g }];
      };
    }
    burstScript() {
      return (t, W, H, s) => (t > 2.2 ? null : [{ lm: mk(W / 2, H * 0.55, t < 1.4 ? 'fist' : 'open', s), gesture: t < 1.4 ? 'fist' : 'open' }]);
    }
    autoList() {
      return [this.hold('point', 2.6), this.hold('pinch', 2.6), this.purpleScript(), this.burstScript(), this.blackScript(), this.hold('v', 3.2, true, 0.05), this.hold('rock', 3), this.hold('open', 2.8, false, 0.04), this.domainScript(), this.hold('none', 7, false, 0.2)];
    }

    frames(dt, now, W, H) {
      this.t += dt;
      const s = H * 0.17;
      if (this.auto && !this.script) { const list = this.autoList(); this.play(list[this.autoIdx % list.length]); this.autoIdx++; }
      if (this.script) {
        this.script.t += dt;
        const f = this.script.fn(this.script.t, W, H, s);
        if (f) return f;
        this.script = null;
      }
      const x = this.mx, y = this.my, K = this.keys;
      let g = null, two = false;
      if (K.has('1')) g = 'point'; else if (K.has('2')) g = 'pinch'; else if (K.has('4')) g = 'fist';
      else if (K.has('5')) { g = 'v'; two = true; } else if (K.has('6')) g = 'rock'; else if (K.has('7')) g = 'open';
      if (!g && this.releaseOpen > 0) { this.releaseOpen -= dt; g = 'open'; }
      if (!g && now - this.mouseT < 1500) g = 'none';
      if (!g) return [];
      const out = [{ lm: mk(x, y, g, s), gesture: g }];
      if (two) out.push({ lm: mk(W - x, y, g, s, 0.2), gesture: g });
      return out;
    }
    get busy() { return this.auto || !!this.script || this.keys.size > 0 || this.releaseOpen > 0; }
  }

  SG.Demo = Demo;
})();
