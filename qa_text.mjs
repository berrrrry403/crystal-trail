// QA: font + palette + dither integration shot.
import { loadPartial, ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import path from 'node:path';
import fs from 'node:fs';

const CT = loadPartial([
  'src/core/rng.js', 'src/core/fb.js',
  'src/art/palette.js', 'src/generated/font.js', 'src/art/font.js',
]);

const W = 480, H = 270;
const fb = new CT.FB(W, H);
const P = CT.Palette.get('forest');
const G = CT.Palette.G;
const gc = CT.Palette.gc;

// dithered sky gradient (two colours, checkerboard transition — §7.2)
for (let y = 0; y < 150; y++) {
  const lv = Math.max(0, Math.min(16, Math.round((y / 150) * 16)));
  fb.fillRect(0, y, W, 1, P.c[2]);
  fb.fillRectDither(0, y, W, 1, P.c[3], lv);
}
// a fake ground band
fb.fillRect(0, 200, W, 70, P.c[5]);
fb.fillRect(0, 200, W, 3, P.c[1]);
fb.fillRect(0, 203, W, 2, P.c[2]);

// treasure glow tiers (16/24/32 px — §7.5)
const cx = 240, cy = 120;
for (const [r, lv] of [[32, 4], [24, 7], [16, 11]]) {
  fb.ellipse(cx, cy, r, r * 0.7, P.c[15]);
  fb.fillRectDither(cx - r, cy - r * 0.7, r * 2, r * 1.4, P.c[0], 0);
}
fb.ellipse(cx, cy, 6, 6, P.c[15]);
fb.ellipse(cx, cy, 3, 3, gc(G.WHITE));

// dialogue panel 160 x 64 (§6.3)
const dw = 160, dh = 64;
const dx = Math.round((W - dw) / 2), dy = H - dh - 8;
fb.fillRect(dx, dy, dw, dh, gc(G.PANEL));
fb.rect(dx, dy, dw, dh, gc(G.PANEL_HI));
fb.rect(dx + 1, dy + 1, dw - 2, dh - 2, gc(G.PANEL_LO));

const maxW = dw - 12;
const lines = CT.Font.wrap('把左边那块反光石推到光路上，光好像没有照到那个台座。', maxW, 3);
let ty = dy + 6;
CT.Font.draw(fb, '林间萤灵', dx + 6, ty, P.c[15], { outline: gc(G.OUTLINE) });
ty += 14;
for (const ln of lines) {
  CT.Font.draw(fb, ln, dx + 6, ty, gc(G.TEXT), { outline: gc(G.OUTLINE) });
  ty += 13;
}
// latin line
CT.Font.draw(fb, 'FPS 60  12/60  hp:none', 6, 6, gc(G.WHITE), { outline: gc(G.OUTLINE) });

console.log('font wrap ->', JSON.stringify(lines, null, 0));
console.log('measure 18 cjk =', CT.Font.measure('把左边那块反光石推到光路上了呢哦'));
const out = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(out, { recursive: true });
savePNG(path.join(out, '01-text.png'), fb.data, W, H, 3);
console.log('ok -> build/qa/01-text.png');
