// CPU 粒子模拟基准：node tests/bench_pool.mjs
import { ParticlePool, KIND } from '../src/particles/pool.js';
for (const N of [10000, 20000, 40000, 60000]) {
  const pool = new ParticlePool(N);
  for (let i = 0; i < N; i++) pool.emit({ x: Math.random() * 1920, y: Math.random() * 1080, vx: 10, vy: -5, life: 1e9, size: 3, color: [1, .5, .2], drag: .5, kind: i % 3 === 0 ? KIND.TURB : 0 });
  let t = 0; for (let f = 0; f < 30; f++) pool.update(1 / 60, f / 60, 1920, 1080); // 预热
  const F = 300, t0 = performance.now();
  for (let f = 0; f < F; f++) pool.update(1 / 60, (f + 30) / 60, 1920, 1080);
  const ms = (performance.now() - t0) / F;
  console.log(`${String(N).padStart(6)} 粒子：${ms.toFixed(2)} ms/帧（模拟+渲染缓冲），存活 ${pool.count}`);
}
