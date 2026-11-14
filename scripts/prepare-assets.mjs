// Copies the MediaPipe WASM runtime out of node_modules and downloads the
// Face Landmarker model once, so the app and the extension can run fully
// self-hosted (no video or model requests to third parties at runtime).
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const exists = (p) => stat(p).then(() => true, () => false);

const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/mediapipe/face_landmarker.task');

await mkdir(wasmDst, { recursive: true });
await cp(wasmSrc, wasmDst, { recursive: true });
console.log('[assets] MediaPipe wasm copied to public/mediapipe/wasm');

if (await exists(modelDst)) {
  console.log('[assets] face_landmarker.task already present');
} else {
  console.log('[assets] downloading face_landmarker.task ...');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
  await writeFile(modelDst, Buffer.from(await res.arrayBuffer()));
  console.log('[assets] model saved to public/mediapipe/face_landmarker.task');
}
