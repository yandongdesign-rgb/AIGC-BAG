/** 握拳 → 闪爆：冲击波环 + 火花碎片 + 屏幕震动/闪光；握住期间余烬飘升 */
import { Mode } from '../mode.js';
import { rand, randRange, lerp, clamp, paletteAt, TAU } from '../../core/math.js';
import { KIND } from '../pool.js';

export class BurstMode extends Mode {
  constructor(...a) { super(...a); this.lastFire = -10; }

  onEnter(h) {
    if (!h || this.ctx.time - this.lastFire < this.p.cooldown) return;
    this.lastFire = this.ctx.time;
    this.fire(h);
  }

  fire(h) {
    const { pool, theme, renderer, quality } = this.ctx, p = this.p;
    const pal = theme.burst, q = quality.emission;
    const k = this.ctx.dualScale * (0.85 + clamp(h.speed / (h.handSize * 10)) * 0.5);
    const c = h.palm;
    this.ctx.audioParams.burstSize = k;

    // 核心闪光
    pool.emit({ x: c.x, y: c.y, life: 0.2, size: 120 * k, size1: 300 * k, color: pal[0], color1: pal[1], alpha: 1, drag: 0 });
    // 冲击波环（两层）
    for (const [mul, cnt, sz] of [[1, p.ring, 6], [0.62, p.ring * 0.6, 4]]) {
      const N = Math.floor(cnt * q);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU + rand(-0.01, 0.01);
        const sp = p.ringSpeed * mul * k * rand(0.96, 1.04);
        pool.emit({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.5, 0.7), size: sz * k, size1: 1, color: pal[0], color1: pal[1], alpha: 1, drag: 2.2 });
        if (i % 3 === 0) pool.emit({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.45, size: sz * 4 * k, size1: sz, color: pal[1], alpha: 0.22, drag: 2.2 });
      }
    }
    // 碎片
    const N = Math.floor(p.debris * q * k);
    for (let i = 0; i < N; i++) {
      const a = rand(0, TAU), sp = lerp(p.speed[0], p.speed[1], Math.pow(Math.random(), 2.2)) * k;
      pool.emit({
        x: c.x + rand(-6, 6), y: c.y + rand(-6, 6), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: randRange(p.life), size: rand(2, 7), size1: 0.5,
        color: paletteAt(pal, rand(0, 0.55)), color1: pal[2], alpha: rand(0.6, 1), drag: 1.6, grav: p.gravity,
      });
    }
    // 高速火花
    const S = Math.floor(p.sparks * q);
    for (let i = 0; i < S; i++) {
      const a = rand(0, TAU), sp = rand(1200, 2300) * k;
      pool.emit({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.45), size: 1.8, size1: 0.5, color: [1, 1, 1], color1: pal[1], alpha: 1, drag: 3.2, kind: KIND.FLICKER });
    }
    renderer.shake(p.shake * k);
    renderer.flash(p.flash * k, pal[1]);
    this.ctx.sound('burst', 'boom', { intensity: clamp(k / 1.4, 0.3, 1.3), x: c.x / this.ctx.W });
  }

  update(dt, h, w) {
    if (!h) return;
    const { pool, theme } = this.ctx, p = this.p;
    const n = this.count(p.embersPerSec * w * (h.frozen ? 0 : 1), dt);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = rand(0, h.handSize * 0.6);
      pool.emit({
        x: h.palm.x + Math.cos(a) * r, y: h.palm.y + Math.sin(a) * r,
        vx: rand(-25, 25), vy: -rand(30, 100), life: rand(0.6, 1.3), size: rand(2, 3.5), size1: 0.5,
        color: theme.burst[1], color1: theme.burst[2], alpha: 0.8 * w, drag: 0.6, grav: -30, kind: KIND.TWINKLE,
      });
    }
  }
}
