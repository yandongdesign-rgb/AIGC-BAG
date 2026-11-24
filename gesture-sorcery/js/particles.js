// CPU 粒子池（结构数组），每帧写入 GPU 缓冲
(function () {
  const SG = window.SG;
  const F_FIELD = 1, F_DUST = 2, F_FLICKER = 4, F_TURB = 8, F_HOT = 16, F_STREAK = 32;

  class ParticlePool {
    constructor(max) {
      this.max = max;
      this.n = 0;
      const A = () => new Float32Array(max);
      this.x = A(); this.y = A(); this.vx = A(); this.vy = A();
      this.age = A(); this.life = A(); this.size = A(); this.size2 = A();
      this.r = A(); this.g = A(); this.b = A(); this.r2 = A(); this.g2 = A(); this.b2 = A();
      this.a = A(); this.drag = A(); this.grav = A(); this.seed = A();
      this.flags = new Uint8Array(max);
      this.gpu = new Float32Array(max * 7);
      this.fields = [];
      this.time = 0;
      this.W = 1; this.H = 1;
      this.budget = 1; // 自适应画质：0.35~1
    }

    emit(o) {
      if (this.n >= this.max) return -1;
      if (!(o.flags & F_DUST) && this.budget < 1 && Math.random() > this.budget) return -1;
      const i = this.n++;
      this.x[i] = o.x; this.y[i] = o.y; this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0;
      this.age[i] = 0; this.life[i] = o.life || 1;
      this.size[i] = o.size || 4; this.size2[i] = o.size2 !== undefined ? o.size2 : this.size[i] * 0.2;
      const c = o.color || [1, 1, 1], c2 = o.color2 || c;
      this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
      this.r2[i] = c2[0]; this.g2[i] = c2[1]; this.b2[i] = c2[2];
      this.a[i] = o.alpha !== undefined ? o.alpha : 1;
      this.drag[i] = o.drag || 0; this.grav[i] = o.gravity || 0;
      this.seed[i] = Math.random() * 100;
      this.flags[i] = o.flags || 0;
      return i;
    }

    kill(i) {
      const j = --this.n;
      if (i === j) return;
      this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
      this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size[i] = this.size[j]; this.size2[i] = this.size2[j];
      this.r[i] = this.r[j]; this.g[i] = this.g[j]; this.b[i] = this.b[j];
      this.r2[i] = this.r2[j]; this.g2[i] = this.g2[j]; this.b2[i] = this.b2[j];
      this.a[i] = this.a[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
      this.seed[i] = this.seed[j]; this.flags[i] = this.flags[j];
    }

    spawnDust(count) {
      for (let k = 0; k < count; k++) {
        const t = Math.random();
        this.emit({
          x: Math.random() * this.W, y: Math.random() * this.H,
          vx: SG.U.rand(-8, 8), vy: SG.U.rand(-14, 2), life: 1e9,
          size: SG.U.rand(1.2, 3.6), color: t < 0.6 ? [0.55, 0.7, 1] : t < 0.85 ? [0.8, 0.6, 1] : [1, 0.85, 0.6],
          alpha: SG.U.rand(0.15, 0.55), drag: 0.6, flags: F_DUST | F_FIELD | F_FLICKER,
        });
      }
    }

    // fields: {x,y,strength(+吸引/-排斥),radius,swirl,sink}
    update(dt) {
      this.time += dt;
      const fields = this.fields, nf = fields.length, W = this.W, H = this.H, T = this.time;
      for (let i = this.n - 1; i >= 0; i--) {
        const fl = this.flags[i];
        this.age[i] += dt;
        if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
        let vx = this.vx[i], vy = this.vy[i];
        if (fl & F_FIELD) {
          const dustK = fl & F_DUST ? 1.6 : 1;
          for (let f = 0; f < nf; f++) {
            const F = fields[f];
            const dx = F.x - this.x[i], dy = F.y - this.y[i];
            const d2 = dx * dx + dy * dy, d = Math.sqrt(d2) + 0.001;
            if (d > F.radius * 4) continue;
            if (F.sink && d < F.sink) {
              if (fl & F_DUST) { this.respawnDust(i); break; }
              this.age[i] = this.life[i]; break;
            }
            const q = d / F.radius;
            const s = (F.strength * dustK) / (q * q + 0.35);
            vx += (dx / d) * s * dt + (-dy / d) * (F.swirl || 0) * s * dt;
            vy += (dy / d) * s * dt + (dx / d) * (F.swirl || 0) * s * dt;
          }
        }
        if (fl & F_TURB) {
          const sd = this.seed[i];
          vx += (SG.U.noise1(T * 3 + sd) - 0.5) * 900 * dt;
        }
        vy += this.grav[i] * dt;
        const dr = Math.exp(-this.drag[i] * dt);
        vx *= dr; vy *= dr;
        this.vx[i] = vx; this.vy[i] = vy;
        this.x[i] += vx * dt; this.y[i] += vy * dt;
        if (fl & F_DUST) {
          if (this.x[i] < -20) this.x[i] = W + 10; else if (this.x[i] > W + 20) this.x[i] = -10;
          if (this.y[i] < -20) this.y[i] = H + 10; else if (this.y[i] > H + 20) this.y[i] = -10;
          // 尘埃速度回归缓慢漂浮
          this.vx[i] += (0 - this.vx[i]) * 0.4 * dt;
          this.vy[i] += (-6 - this.vy[i]) * 0.4 * dt;
        } else if (this.x[i] < -300 || this.x[i] > W + 300 || this.y[i] < -300 || this.y[i] > H + 300) {
          this.kill(i);
        }
      }
    }

    respawnDust(i) {
      const e = (Math.random() * 4) | 0;
      this.x[i] = e === 0 ? -10 : e === 1 ? this.W + 10 : Math.random() * this.W;
      this.y[i] = e === 2 ? -10 : e === 3 ? this.H + 10 : Math.random() * this.H;
      this.vx[i] = 0; this.vy[i] = 0;
    }

    write(boost) {
      const g = this.gpu, T = this.time;
      for (let i = 0; i < this.n; i++) {
        const t = this.age[i] / this.life[i], fl = this.flags[i];
        let a = this.a[i];
        if (fl & F_DUST) a *= boost;
        else a *= t < 0.08 ? t / 0.08 : 1 - (t - 0.08) / 0.92;
        if (fl & F_FLICKER) a *= 0.55 + 0.45 * Math.sin(T * 9 + this.seed[i] * 7);
        let r = this.r[i] + (this.r2[i] - this.r[i]) * t;
        let gg = this.g[i] + (this.g2[i] - this.g[i]) * t;
        let b = this.b[i] + (this.b2[i] - this.b[i]) * t;
        if (fl & F_HOT && t < 0.25) { const h = 1 - t / 0.25; r += (1 - r) * h; gg += (1 - gg) * h; b += (1 - b) * h; }
        const o = i * 7;
        g[o] = this.x[i]; g[o + 1] = this.y[i];
        g[o + 2] = this.size[i] + (this.size2[i] - this.size[i]) * t;
        g[o + 3] = r; g[o + 4] = gg; g[o + 5] = b; g[o + 6] = a < 0 ? 0 : a;
      }
      return this.n;
    }
  }

  SG.ParticlePool = ParticlePool;
  SG.PF = { FIELD: F_FIELD, DUST: F_DUST, FLICKER: F_FLICKER, TURB: F_TURB, HOT: F_HOT, STREAK: F_STREAK };
})();
