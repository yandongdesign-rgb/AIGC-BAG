/**
 * 插件示例：新增一个“剪刀手 ✌ → 涟漪 + 水滴音”的完整链路。
 * 复制本文件改名即可做自己的扩展，然后加入 config.plugins 列表。
 *
 * 一个插件 = 默认导出一个 install(api) 函数，api 包含：
 *   Registry   注册中心（registerGesture / registerMode / registerSound）
 *   Mode       粒子模式基类        SoundLayer 音效层基类
 *   KIND       粒子类型常量        math       数学工具
 *   config     全局配置（可在这里补默认映射与参数）
 */
export default function install({ Registry, Mode, SoundLayer, math, config }) {
  const { rand, TAU, paletteAt } = math;

  // 1) 新手势：食指 + 中指伸直，无名指/小指弯曲
  Registry.registerGesture({
    id: 'VICTORY',
    priority: 35, // 高于 POINT(30)，低于 FIST(40)
    test: (f) => f.ext[1] && f.ext[2] && f.curl[3] && f.curl[4],
  });

  // 2) 新粒子模式：周期性扩散的同心圆环
  class RippleMode extends Mode {
    onEnter() { this.timer = 0; }
    update(dt, h, w) {
      if (!h) return;
      this.timer -= dt;
      if (this.timer > 0 || h.frozen) return;
      this.timer = 0.45;
      const { pool, theme } = this.ctx;
      const N = Math.floor(160 * this.ctx.quality.emission);
      const c = { x: (h.tips[1].x + h.tips[2].x) / 2, y: (h.tips[1].y + h.tips[2].y) / 2 };
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU, sp = 260 * rand(0.97, 1.03);
        pool.emit({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.1, size: 5 * w, size1: 1, color: paletteAt(theme.link, i / N), alpha: 0.9 * w, drag: 1.1 });
      }
      this.ctx.sound('ripple', 'drop', { x: c.x / this.ctx.W });
    }
  }
  Registry.registerMode('ripple', RippleMode);

  // 3) 新音效层：水滴“叮”
  class RippleSound extends SoundLayer {
    trigger(ev, p) {
      const t = this.now + 0.003, g = this.gain(0, this.panner(p.x));
      const o = this.osc('sine', 900, g);
      o.frequency.setValueAtTime(1300, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.18);
      this.env(g.gain, t, 0.004, 0.18, 0.5); o.start(t); o.stop(t + 0.7);
    }
  }
  Registry.registerSound('ripple', RippleSound);

  // 4) 若用户配置里没写映射，补一个默认值
  config.mapping.VICTORY ??= { label: '剪刀手(插件)', modes: ['ripple'], sounds: ['ripple'] };
  config.particles.ripple ??= {};
}
