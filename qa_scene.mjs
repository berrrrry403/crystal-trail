// QA: full scene composition — sky + 3 parallax layers + terrain, per theme.
import { loadPartial, ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import path from 'node:path';
import fs from 'node:fs';

const CT = loadPartial([
  'src/core/rng.js', 'src/core/fb.js', 'src/art/palette.js',
  'src/art/artkit.js', 'src/art/gen_tiles.js', 'src/art/gen_bg.js',
]);

const TS = 16, W = 480, H = 270;
const TH = process.argv[2] || 'forest';
const CAMX = Number(process.argv[3] || 0);

const P = CT.Palette.get(TH);
const T = CT.Tiles, M = T.MASK, F = CT.BG.FACTOR;

const COLS = 30, ROWS = 17;
const solid = new Uint8Array(COLS * ROWS);
const kind = new Uint8Array(COLS * ROWS);
function set(x, y, k) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  solid[y * COLS + x] = 1; kind[y * COLS + x] = k;
}
for (let x = 0; x < COLS; x++) {
  const base = 12 + Math.round(Math.sin(x * 0.42) * 1.6 + Math.sin(x * 0.17) * 1.1);
  for (let y = base; y < ROWS; y++) set(x, y, T.KIND.GROUND);
}
for (let y = 7; y < 13; y++) set(9, y, T.KIND.GROUND);
for (let x = 13; x < 20; x++) set(x, 7, T.KIND.PLATFORM);
for (let x = 21; x < 25; x++) for (let y = 12 - (x - 21); y < ROWS; y++) set(x, y, T.KIND.GROUND);
// slope tiles on a step
for (let x = 26; x < 29; x++) set(x, 10, T.KIND.SLOPE_R);

const fb = new CT.FB(W, H);
const bg = CT.BG.build(TH);
CT.BG.drawSky(fb, bg.sky);
CT.BG.drawLayer(fb, bg.far, CAMX * F.far, false);
CT.BG.drawLayer(fb, bg.mid, CAMX * F.mid, false);

function solidAt(x, y) {
  if (x < 0 || x >= COLS) return false;
  if (y < 0) return false;
  if (y >= ROWS) return true;
  return solid[y * COLS + x] === 1;
}
for (let ty = 0; ty < ROWS; ty++) {
  for (let tx = 0; tx < COLS; tx++) {
    if (!solid[ty * COLS + tx]) continue;
    let mask = 0;
    if (solidAt(tx, ty - 1)) mask |= M.UP;
    if (solidAt(tx, ty + 1)) mask |= M.DOWN;
    if (solidAt(tx - 1, ty)) mask |= M.LEFT;
    if (solidAt(tx + 1, ty)) mask |= M.RIGHT;
    if (solidAt(tx - 1, ty - 1)) mask |= M.UL;
    if (solidAt(tx + 1, ty - 1)) mask |= M.UR;
    if (solidAt(tx - 1, ty + 1)) mask |= M.DL;
    if (solidAt(tx + 1, ty + 1)) mask |= M.DR;
    const v = CT.hash2(tx, ty, 7) & 3;
    const tile = T.getTile(TH, kind[ty * COLS + tx], mask, v);
    fb.blit(tile.d, TS, TS, tx * TS, ty * TS);
  }
}
CT.BG.drawLayer(fb, bg.near, CAMX * F.near, true);

const out = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(out, { recursive: true });
savePNG(path.join(out, `03-scene-${TH}.png`), fb.data, W, H, 3);
console.log(`scene ${TH} ok -> build/qa/03-scene-${TH}.png  (tile cache ${T.cacheSize(TH)})`);
