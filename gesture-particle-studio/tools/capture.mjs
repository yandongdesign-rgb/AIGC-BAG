// 验证脚本：连接已运行的 Chrome（CDP），逐个手势截图、录一段完整巡演 WebM，并记录帧率 / 延迟 / 粒子数 / 音频峰值。
// 用法：先 npm run dev，再用 --remote-debugging-port=9222 启动 Chrome，然后
//   node tools/capture.mjs [页面地址] [CDP 地址] [录屏秒数]
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const cdp = process.argv[3] || 'http://localhost:9222';
const recSeconds = Number(process.argv[4] || 31);
const out = new URL('../docs/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.connectOverCDP(cdp);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] || (await ctx.newPage());
await page.bringToFront();
await page.setViewportSize({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

const sample = async (ms) => {
  const xs = [];
  for (let t = 0; t < ms; t += 500) {
    await page.waitForTimeout(500);
    xs.push(await page.evaluate(() => window.__metrics));
  }
  const avg = (k) => xs.reduce((a, m) => a + (m[k] || 0), 0) / xs.length;
  const last = xs[xs.length - 1];
  return { fps: avg('fps'), frameMs: avg('frameMs'), latencyMs: avg('latencyMs'), alive: Math.max(...xs.map((m) => m.alive)), limit: last.limit, quality: last.quality, states: [...new Set(xs.flatMap((m) => m.hands.map((h) => h.state)))], dualMax: Math.max(0, ...xs.map((m) => m.dual ?? 0)) };
};

const gestures = ['open_palm', 'fist', 'point', 'pinch', 'palm_up', 'dual', 'none'];
const report = {};
// 同一页面内切换手势，让自动降级先稳定下来（与真实使用一致）
await page.goto(`${url}?demo=open_palm&lock&hidepanel&skeleton`, { waitUntil: 'networkidle' });
await page.waitForTimeout(8000);
for (const g of gestures) {
  await page.evaluate((g) => { window.__app.sim.jump(g); window.__app.sim.hold = true; }, g);
  await page.waitForTimeout(1200);
  report[g] = await sample(g === 'fist' ? 1800 : 2500);
  if (g === 'fist') await page.waitForFunction(() => window.__app.engine.flash > 0.3, null, { timeout: 4000, polling: 'raf' }).catch(() => {});
  await page.screenshot({ path: `${out}screenshot-${g}.png` });
  const r = report[g];
  console.log(g.padEnd(10), `fps=${r.fps.toFixed(1)} frame=${r.frameMs.toFixed(1)}ms latency=${r.latencyMs.toFixed(1)}ms particles<=${r.alive}/${r.limit} q=${r.quality} states=${r.states} dual=${r.dualMax.toFixed(2)}`);
}

// 完整巡演录屏（帧率 / 延迟标注由程序内录屏器叠加）
await page.evaluate(() => { window.__app.sim.hold = false; window.__app.sim.jump('open_palm'); });
const b64 = await page.evaluate(async (sec) => {
  const blob = await window.__app.recorder.record(sec, null, { save: false });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}, recSeconds);
writeFileSync(`${out}demo-recording.webm`, Buffer.from(b64, 'base64'));
const tour = await page.evaluate(() => window.__metrics);

writeFileSync(`${out}demo-metrics.json`, JSON.stringify({ capturedAt: new Date().toISOString(), userAgent: await page.evaluate(() => navigator.userAgent), gpu: await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }), viewport: '1280x720', perGesture: report, afterRecording: tour, errors }, null, 2));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
