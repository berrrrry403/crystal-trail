// Smoke test: framebuffer primitives + PNG round-trip.
import { loadPartial } from './harness.mjs';
import { savePNG } from './png.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from './harness.mjs';

const CT = loadPartial(['src/core/rng.js', 'src/core/fb.js']);
const fb = new CT.FB(480, 270);

// Test pattern: palette ramp, dither ladder, ellipse, blit, flip blit.
const W = 480, H = 270;
fb.clear(CT.rgba(24, 20, 34));
for (let i = 0; i < 16; i++) {
  fb.fillRect(i * 30, 0, 30, 40, CT.rgba(i * 16, 96 + i * 8, 200 - i * 12));
}
for (let lv = 0; lv <= 16; lv += 2) {
  fb.fillRectDither(lv * 28, 48, 28, 40, CT.rgba(255, 240, 180), lv);
}
fb.ellipse(60, 130, 40, 18, CT.rgba(120, 220, 140));
fb.rect(120, 110, 80, 50, CT.rgba(240, 200, 120));
fb.hline(120, 112, 80, CT.rgba(255, 255, 255));

// small sprite to test blit + flip
const spr = new Uint32Array(8 * 8);
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  if ((x - 3.5) ** 2 + (y - 3.5) ** 2 < 12) spr[y * 8 + x] = CT.rgba(255, 120, 200);
}
fb.blit(spr, 8, 8, 230, 120);
fb.blit(spr, 8, 8, 250, 120, true);

// rng sanity
const rng = new CT.Rng(CT.seedOf('crystal-trail'));
let acc = 0;
for (let i = 0; i < 1000; i++) acc += rng.f();
if (acc < 400 || acc > 600) throw new Error('rng distribution off: ' + acc);

const out = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(out, { recursive: true });
savePNG(path.join(out, '00-smoke.png'), fb.data, W, H, 2);
console.log('smoke ok; rng mean', (acc / 1000).toFixed(4), '-> build/qa/00-smoke.png');
