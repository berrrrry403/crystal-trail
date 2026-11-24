// QA: terrain tile sheet in situ, per theme. Verifies caps, edges, corners, slopes.
import { loadPartial, ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import path from 'node:path';
import fs from 'node:fs';

const CT = loadPartial([
  'src/core/rng.js', 'src/core/fb.js', 'src/art/palette.js',
  'src/art/artkit.js', 'src/art/gen_tiles.js',
]);

const TS = 16;
const W = 480, H = 270;
const TH = process.argv[2] || 'forest';

const P = CT.Palette.get(TH);
const T = CT.Tiles;
const M = T.MASK;

// Build a synthetic 30 x 17 tile map with the interesting shapes:
// rolling ground, a pillar, a floating platform, and both slope directions.
const COLS = 30, ROWS = 17;
const solid = new Uint8Array(COLS * ROWS);
const kind = new Uint8Array(COLS * ROWS); // 0 ground, 1 platform, 3 slopeR, 4 slopeL

function set(x, y, k) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  solid[y * COLS + x] = 1;
  kind[y * COLS + x] = k;
}

// rolling ground: height varies
for (let x = 0; x < COLS; x++) {
  const base = 12 + Math.round(Math.sin(x * 0.42) * 1.6 + Math.sin(x * 0.17) * 1.1);
  for (let y = base; y < ROWS; y++) set(x, y, T.KIND.GROUND);
}
// pillar
for (let y = 6; y < 13; y++) set(8, y, T.KIND.GROUND);
// floating platform (one-way)
for (let x = 12; x < 19; x++) set(x, 7, T.KIND.PLATFORM);
// slopes bridging a gap
for (let x = 20; x < 24; x++) for (let y = 12 - (x - 20); y < ROWS; y++) set(x, y, T.KIND.GROUND);
// a wall region behind
for (let x = 24; x < COLS; x++) for (let y = 8; y < ROWS; y++) if (!solid[y * COLS + x]) set(x, y, T.KIND.WALL);

const fb = new CT.FB(W, H);
// dithered sky
for (let y = 0; y < H; y++) {
  const lv = Math.round((y / H) * 16);
  fb.fillRect(0, y, W, 1, P.c[P.meta.skyTop]);
  fb.fillRectDither(0, y, W, 1, P.c[P.meta.skyBot], lv);
}

function isSolid(x, y) {
  if (x < 0 || x >= COLS) return true;  // treat outside as solid so no edge lines at border
  if (y < 0) return false;
  if (y >= ROWS) return true;
  return solid[y * COLS + x] === 1;
}

for (let ty = 0; ty < ROWS; ty++) {
  for (let tx = 0; tx < COLS; tx++) {
    if (!solid[ty * COLS + tx]) continue;
    let mask = 0;
    if (isSolid(tx, ty - 1)) mask |= M.UP;
    if (isSolid(tx, ty + 1)) mask |= M.DOWN;
    if (isSolid(tx - 1, ty)) mask |= M.LEFT;
    if (isSolid(tx + 1, ty)) mask |= M.RIGHT;
    if (isSolid(tx - 1, ty - 1)) mask |= M.UL;
    if (isSolid(tx + 1, ty - 1)) mask |= M.UR;
    if (isSolid(tx - 1, ty + 1)) mask |= M.DL;
    if (isSolid(tx + 1, ty + 1)) mask |= M.DR;
    const variant = CT.hash2(tx, ty, 7) & 3;
    const tile = T.getTile(TH, kind[ty * COLS + tx], mask, variant);
    fb.blit(tile.d, TS, TS, tx * TS, ty * TS);
  }
}

const out = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(out, { recursive: true });
savePNG(path.join(out, `02-tiles-${TH}.png`), fb.data, W, H, 3);
console.log(`theme ${TH} ok, tile cache ${T.cacheSize(TH)} entries -> build/qa/02-tiles-${TH}.png`);
