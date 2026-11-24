// 生成离线依赖包：把 MediaPipe Tasks Vision、WASM 与手部模型打包成可在 file:// 下直接加载的 JS 文件。
// 用法：node tools/build-vendor.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const VERSION = '0.10.22-rc.20250304';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const assets = {
  bundle: [`${CDN}/vision_bundle.cjs`, null],
  loader: [`${CDN}/wasm/vision_wasm_internal.js`, null],
  wasm: [`${CDN}/wasm/vision_wasm_internal.wasm`, 'f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7'],
  model: ['https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'],
};
const out = new URL('../js/vendor/', import.meta.url);
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function get(name) {
  const [url, hash] = assets[name];
  console.log('下载', url);
  const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (hash && sha(buf) !== hash) throw new Error('SHA-256 校验失败: ' + name);
  return buf;
}

await mkdir(out, { recursive: true });
const bundle = (await get('bundle')).toString('utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
await writeFile(new URL('vision_bundle.js', out),
  `/* @mediapipe/tasks-vision ${VERSION} (Apache-2.0)，CommonJS 包装为全局 window.MPVision */\n` +
  `(function(){var exports={};var module={exports:exports};\n${bundle}\n;window.MPVision=module.exports;})();\n`);
const loader = (await get('loader')).toString('utf8');
await writeFile(new URL('vision_wasm_internal.js', out), loader + '\nwindow.__SorceryModuleFactory = ModuleFactory;\n');
const wasm = await get('wasm');
await writeFile(new URL('wasm-pack.js', out), `window.SORCERY_WASM_B64="${wasm.toString('base64')}";\n`);
const model = await get('model');
await writeFile(new URL('model-pack.js', out), `window.SORCERY_MODEL_B64="${model.toString('base64')}";\n`);
console.log('完成：js/vendor/ 已生成');
