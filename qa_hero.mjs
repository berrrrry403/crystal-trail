// 主角放大审视：逐帧排开，6 倍最近邻放大，方便肉眼检查像素细节
import { loadPartial, ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import path from 'node:path';
import fs from 'node:fs';

const CT = loadPartial([
  'src/core/rng.js', 'src/core/fb.js', 'src/art/palette.js',
  'src/art/artkit.js', 'src/art/gen_sprites.js',
  'src/generated/font.js', 'src/art/font.js',
]);

const TH = process.argv[2] || 'forest';
const ZOOM = 6;
const P = CT.Palette.get(TH);
const S = CT.Sprites;
const hero = S.buildHero(TH);

const ANIMS = ['idle', 'walk', 'jump', 'pickup', 'talk', 'celebrate'];
const maxFrames = Math.max(...ANIMS.map((a) => hero[a].frames.length));
const CELL = 20;
const W = CELL * maxFrames + 8;
const H = CELL * ANIMS.length + 8;

const fb = new CT.FB(W, H);
fb.clear(CT.Palette.gc(CT.Palette.G.PANEL));
ANIMS.forEach((a, row) => {
  hero[a].frames.forEach((f, col) => {
    fb.blit(f.d, 16, 24, 4 + col * CELL + 2, 4 + row * CELL + 2);
  });
});

const out = path.join(ROOT, 'build', 'qa', '05-hero-zoom.png');
savePNG(out, fb.data, W, H, ZOOM);
console.log(`hero sheet ${W}x${H} @${ZOOM}x ->`, out);

// 顺带报告每帧色数（§3.1 上限 12）
const counts = {};
for (const a of ANIMS) {
  counts[a] = hero[a].frames.map((f) => CT.Art.countColors(f));
}
console.log('逐帧色数:', JSON.stringify(counts));
