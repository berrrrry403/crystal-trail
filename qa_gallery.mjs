// 五张图鉴插画拼成一张总览，便于肉眼检查构图
import { loadPartial, ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import path from 'node:path';
import fs from 'node:fs';

const CT = loadPartial([
  'src/core/rng.js', 'src/core/fb.js', 'src/art/palette.js',
  'src/art/artkit.js', 'src/art/gen_sprites.js', 'src/art/gen_illustrations.js',
]);

const THEMES = ['forest', 'amber', 'cloud', 'water', 'star'];
const W = 192, H = 128, GAP = 6;
const COLS = 2, ROWS = 3;
const CW = COLS * W + (COLS + 1) * GAP;
const CH = ROWS * H + (ROWS + 1) * GAP;

const fb = new CT.FB(CW, CH);
fb.clear(CT.Palette.gc(CT.Palette.G.PANEL));

THEMES.forEach((t, i) => {
  const b = CT.Illustration.build(t);
  const cx = GAP + (i % COLS) * (W + GAP);
  const cy = GAP + Math.floor(i / COLS) * (H + GAP);
  fb.blitOpaque(b.d, W, H, cx, cy);
  // 统计色数，确认没超过 24（§12）
  const colours = CT.Art.countColors(b);
  console.log(`${t.padEnd(7)} 色数 ${colours}  ${W}x${H}`);
});

const out = path.join(ROOT, 'build', 'qa', '06-gallery.png');
savePNG(out, fb.data, CW, CH, 3);
console.log('->', out);
