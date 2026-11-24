// 用游戏自己的像素美术生成站点图标（favicon.ico 的多尺寸源）
// 直接调用 src/art 里的同一套绘制代码，保证图标和游戏里的彩晶长得一样。
import { loadPartial, ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadPartial([
  'src/core/rng.js', 'src/core/fb.js', 'src/art/palette.js',
  'src/art/artkit.js', 'src/art/gen_sprites.js',
]);

const P = CT.Palette.get('star');
const S = CT.Sprites;

// 主线彩晶（星纹古殿配色），14 × 13 像素
const crystal = S.buildCrystal(P.c[15], P.c[0], P.c[14]);

// 16 × 16 画布居中，底部加一枚小小的抖动光晕，缩到任务栏大小也认得出
const base = new CT.FB(16, 16);
base.clear(CT.Palette.gc(CT.Palette.G.PANEL));
for (let y = -7; y <= 7; y++) {
  for (let x = -7; x <= 7; x++) {
    const d = x * x + y * y;
    if (d > 42) continue;
    if (CT.BAYER4[((8 + y) & 3) * 4 + ((8 + x) & 3)] < (d < 20 ? 5 : 2)) {
      base.px(8 + x, 8 + y, P.c[15]);
    }
  }
}
base.blit(crystal.d, crystal.w, crystal.h,
  Math.round((16 - crystal.w) / 2), Math.round((16 - crystal.h) / 2));

const outDir = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(outDir, { recursive: true });
savePNG(path.join(outDir, 'icon-16.png'), base.data, 16, 16, 1);

// 2 倍最近邻，供 ico 打包出 32 × 32
const big = new Uint32Array(32 * 32);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    big[y * 32 + x] = base.data[(y >> 1) * 16 + (x >> 1)];
  }
}
savePNG(path.join(outDir, 'icon-32.png'), big, 32, 32, 1);
console.log('icon source written:', path.join(outDir, 'icon-16.png'), path.join(outDir, 'icon-32.png'));
