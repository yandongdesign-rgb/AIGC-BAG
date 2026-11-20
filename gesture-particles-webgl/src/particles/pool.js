/**
 * 粒子池：结构化数组（SoA）+ 紧凑存活区（swap-remove），零 GC。
 * CPU 负责模拟，GPU 负责实例化绘制（见 renderer.js）。
 */
import { flowAngle } from '../core/math.js';

export const KIND = { NORMAL: 0, TURB: 1, FLICKER: 2, TWINKLE: 3 };

export class ParticlePool {
  constructor(capacity) {
    this.capacity = capacity;
    this.limit = capacity; // 运行时上限（由性能档位调整）
    this.count = 0;
    const F = () => new Float32Array(capacity);
    this.x = F(); this.y = F(); this.vx = F(); this.vy = F();
    this.life = F(); this.maxLife = F();
    this.s0 = F(); this.s1 = F();
    this.r = F(); this.g = F(); this.b = F();
    this.r1 = F(); this.g1 = F(); this.b1 = F();
    this.a0 = F(); this.drag = F(); this.grav = F(); this.seed = F();
    this.kind = new Uint8Array(capacity);
    this.render = new Float32Array(capacity * 7); // x y size r g b a
    this.renderCount = 0;
  }

  /**
   * 发射一个粒子；返回索引或 -1（池满）
   * o: { x, y, vx, vy, life, size, size1, color:[r,g,b], color1, alpha, drag, grav, kind }
   */
  emit(o) {
    if (this.count >= this.limit) return -1;
    const i = this.count++;
    this.x[i] = o.x; this.y[i] = o.y;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0;
    this.life[i] = 0; this.maxLife[i] = o.life || 1;
    this.s0[i] = o.size || 3; this.s1[i] = o.size1 ?? 0;
    const c = o.color || [1, 1, 1], c1 = o.color1 || c;
    this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
    this.r1[i] = c1[0]; this.g1[i] = c1[1]; this.b1[i] = c1[2];
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0.5;
    this.grav[i] = o.grav ?? 0;
    this.kind[i] = o.kind || 0;
    this.seed[i] = Math.random() * 100;
    return i;
  }

  kill(i) { this.life[i] = this.maxLife[i] + 1; }

  removeAt(i) {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.r[i] = this.r[j]; this.g[i] = this.g[j]; this.b[i] = this.b[j];
    this.r1[i] = this.r1[j]; this.g1[i] = this.g1[j]; this.b1[i] = this.b1[j];
    this.a0[i] = this.a0[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
    this.kind[i] = this.kind[j]; this.seed[i] = this.seed[j];
  }

  /** 积分 + 生成渲染缓冲 */
  update(dt, t, W, H) {
    const R = this.render;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      // 用“本帧开始时的年龄”判定死亡与插值 → 极短命粒子在低帧率下也至少显示一帧
      const age = this.life[i];
      const ml = this.maxLife[i];
      if (age >= ml) { this.removeAt(i); i--; continue; }
      this.life[i] = age + dt;
      const k = this.kind[i];
      if (k === KIND.TURB) {
        const a = flowAngle(this.x[i], this.y[i], t);
        this.vx[i] += Math.cos(a) * 38 * dt;
        this.vy[i] += Math.sin(a) * 38 * dt;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr;
      this.vy[i] = this.vy[i] * dr + this.grav[i] * dt;
      const x = (this.x[i] += this.vx[i] * dt);
      const y = (this.y[i] += this.vy[i] * dt);
      if (x < -200 || x > W + 200 || y < -300 || y > H + 300) { this.removeAt(i); i--; continue; }

      const u = age / ml;
      // 透明度：快速淡入（30ms）+ 平滑衰减
      let a = this.a0[i] * Math.min(1, (age + dt) / 0.03) * (1 - u) * (1 - u * 0.3);
      if (k === KIND.FLICKER) a *= 0.55 + 0.45 * Math.sin(t * 90 + this.seed[i] * 10);
      else if (k === KIND.TWINKLE) a *= 0.6 + 0.4 * Math.sin(t * 6 + this.seed[i]);
      const o = n * 7;
      R[o] = x; R[o + 1] = y;
      R[o + 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
      R[o + 3] = this.r[i] + (this.r1[i] - this.r[i]) * u;
      R[o + 4] = this.g[i] + (this.g1[i] - this.g[i]) * u;
      R[o + 5] = this.b[i] + (this.b1[i] - this.b[i]) * u;
      R[o + 6] = a;
      n++;
    }
    this.renderCount = n;
  }
}
