// 生成多尺寸 Windows 图标（.ico），供 electron-builder / NSIS 使用
// ---------------------------------------------------------------------------
// 用游戏自己的彩晶美术，按 16/32/48/64/128/256 六个尺寸做「整数倍最近邻」放大，
// 每个尺寸单独编码成 PNG，再手工拼进 ICO 容器。
// 这样每个尺寸都是干净的像素放大，而不是从大图缩下来的糊图。
import { loadPartial, ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CT = loadPartial([
  'src/core/rng.js', 'src/core/fb.js', 'src/art/palette.js',
  'src/art/artkit.js', 'src/art/gen_sprites.js',
]);

const P = CT.Palette.get('star');
const S = CT.Sprites;
const crystal = S.buildCrystal(P.c[15], P.c[0], P.c[14]);

// 16 × 16 母版
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

const SIZES = [16, 32, 48, 64, 128, 256];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ico-'));
const pngs = [];

for (const sz of SIZES) {
  const f = sz / 16;                       // 整数倍
  const buf = new Uint32Array(sz * sz);
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      buf[y * sz + x] = base.data[((y / f) | 0) * 16 + ((x / f) | 0)];
    }
  }
  const file = path.join(tmp, `icon-${sz}.png`);
  savePNG(file, buf, sz, sz, 1);
  pngs.push({ size: sz, bytes: fs.readFileSync(file) });
}

// ---- 手工拼 ICO 容器（Vista+ 支持 PNG 负载）
const count = pngs.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);   // reserved
header.writeUInt16LE(1, 2);   // type = icon
header.writeUInt16LE(count, 4);

const dirs = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
pngs.forEach((p, i) => {
  const o = i * 16;
  dirs.writeUInt8(p.size >= 256 ? 0 : p.size, o + 0);       // width（0 表示 256）
  dirs.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);       // height
  dirs.writeUInt8(0, o + 2);                                // 调色板数
  dirs.writeUInt8(0, o + 3);                                // reserved
  dirs.writeUInt16LE(1, o + 4);                             // color planes
  dirs.writeUInt16LE(32, o + 6);                            // bpp
  dirs.writeUInt32LE(p.bytes.length, o + 8);                // 数据长度
  dirs.writeUInt32LE(offset, o + 12);                       // 数据偏移
  offset += p.bytes.length;
});

const ico = Buffer.concat([header, dirs, ...pngs.map((p) => p.bytes)]);

const outDir = path.join(ROOT, 'desktop', 'resources');
fs.mkdirSync(outDir, { recursive: true });
const icoPath = path.join(outDir, 'icon.ico');
fs.writeFileSync(icoPath, ico);

// 顺带一张 256 PNG，给报告和商店页用
const big = path.join(ROOT, 'build', 'qa', 'icon-256.png');
fs.copyFileSync(path.join(tmp, 'icon-256.png'), big);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`icon.ico -> ${icoPath}`);
console.log(`  尺寸: ${SIZES.join('/')}  总大小 ${(ico.length / 1024).toFixed(1)} KB`);
console.log(`icon-256.png -> ${big}`);
