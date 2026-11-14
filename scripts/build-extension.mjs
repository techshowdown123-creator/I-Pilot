// Builds the Chrome extension (Manifest V3) into dist-extension/.
// Content scripts cannot be ES modules, so content.js is bundled as an IIFE;
// the other entry points are ES modules.
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-extension');
const watch = process.argv.includes('--watch');

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'icons'), { recursive: true });

const common = {
  bundle: true,
  target: 'chrome116',
  sourcemap: true,
  alias: { '@core': join(root, 'src/core') },
  logLevel: 'info',
  minify: !watch,
};

await build({ ...common, entryPoints: { content: join(root, 'extension/src/content.ts') }, outdir: out, format: 'iife' });
await build({
  ...common,
  entryPoints: {
    background: join(root, 'extension/src/background.ts'),
    offscreen: join(root, 'extension/src/offscreen.ts'),
    popup: join(root, 'extension/src/popup.ts'),
    permission: join(root, 'extension/src/permission.ts'),
  },
  outdir: out,
  format: 'esm',
});

for (const f of ['manifest.json', 'popup.html', 'offscreen.html', 'permission.html']) await copyFile(join(root, 'extension', f), join(out, f));
await cp(join(root, 'public/mediapipe'), join(out, 'mediapipe'), { recursive: true });

// ---- icons: draw a simple eye glyph and encode PNGs without dependencies
function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const s = size;
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0;
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s,
        v = (y + 0.5) / s;
      // rounded square background
      const r = 0.22,
        dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0),
        dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
      const inBg = Math.hypot(dx, dy) <= r;
      // almond eye shape: two circle arcs
      const eye = Math.hypot(u - 0.5, v - 0.5 + 0.55) < 0.8 && Math.hypot(u - 0.5, v - 0.5 - 0.55) < 0.8 && Math.abs(u - 0.5) < 0.38;
      const pupil = Math.hypot(u - 0.5, v - 0.5) < 0.14;
      const glint = Math.hypot(u - 0.545, v - 0.455) < 0.045;
      let px = [0, 0, 0, 0];
      if (inBg) px = [29, 78, 216, 255];
      if (inBg && eye) px = [255, 255, 255, 255];
      if (inBg && pupil) px = [29, 78, 216, 255];
      if (inBg && glint) px = [255, 255, 255, 255];
      raw.set(px, y * (s * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 48, 128]) await writeFile(join(out, 'icons', `icon${s}.png`), icon(s));

console.log('\nExtension built → dist-extension/ (load it via chrome://extensions → Developer mode → Load unpacked)');
