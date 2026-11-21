// 将 MediaPipe WASM 复制到 public/mediapipe，并下载手部模型到 public/models（离线可用）
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/models/hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true });
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log('[setup] MediaPipe WASM -> public/mediapipe/wasm');
} else {
  console.warn('[setup] 未找到 @mediapipe/tasks-vision，请先 npm install');
}

if (existsSync(modelDst) && statSync(modelDst).size > 1_000_000) {
  console.log('[setup] 手部模型已存在');
} else {
  try {
    mkdirSync(dirname(modelDst), { recursive: true });
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log('[setup] 手部模型 -> public/models/hand_landmarker.task');
  } catch (err) {
    console.warn(`[setup] 模型下载失败（${err.message}），运行时将回退到在线地址`);
  }
}
