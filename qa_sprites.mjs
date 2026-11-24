// QA: sprite sheet — hero animation frames, NPCs, treasures, decoration props.
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
const P = CT.Palette.get(TH);
const S = CT.Sprites;
const W = 480, H = 270;
const fb = new CT.FB(W, H);
fb.clear(CT.Palette.gc(CT.Palette.G.PANEL));

function label(t, x, y) {
  CT.Font.draw(fb, t, x, y, CT.Palette.gc(CT.Palette.G.TEXT_DIM));
}

// hero: all 6 animations, frames laid out left to right
const hero = S.buildHero(TH);
let x = 6, y = 10;
label('IDLE4 WALK6 JUMP4 PICK4 TALK2 CELEB6', 6, 2);
for (const name of ['idle', 'walk', 'jump', 'pickup', 'talk', 'celebrate']) {
  for (const f of hero[name].frames) {
    fb.blit(f.d, 16, 24, x, y);
    x += 18;
    if (x > W - 20) { x = 6; y += 28; }
  }
  x += 4;
}

// npcs
y += 34;
label('NPC', 6, y - 10);
x = 6;
for (const k of ['firefly', 'elder', 'messenger', 'clam', 'guide']) {
  const n = S.buildNpc(k, P);
  fb.blit(n.d, n.w, n.h, x, y);
  x += n.w + 8;
}

// treasures
y += 30;
label('TREASURE', 6, y - 10);
const cr = S.buildCrystal(P.c[15], P.c[0], P.c[14]);
fb.blit(cr.d, cr.w, cr.h, 6, y);
const tr = S.buildTreasure(P.c[15], P.c[0]);
fb.blit(tr.d, tr.w, tr.h, 28, y);
const mk = S.buildMark(P.c[15], P.c[0]);
fb.blit(mk.d, mk.w, mk.h, 46, y);

// props: every set, 3 variants each
y += 24;
label('PROPS (set x variant)', 6, y - 10);
x = 6;
const setCount = S.propSetCount(TH);
for (let si = 0; si < setCount; si++) {
  for (let v = 0; v < 3; v++) {
    const p = S.buildProp(TH, si, v);
    if (x + p.w > W - 4) { x = 6; y += 22; }
    fb.blit(p.d, p.w, p.h, x, y);
    x += p.w + 6;
  }
  x += 4;
}

// panel
y += 26;
label('PANEL', 6, y - 10);
const pn = S.buildPanel(120, 34, P, P.c[15]);
fb.blit(pn.d, pn.w, pn.h, 6, y);

// colour-count audit (§7.7 / §3.1)
const counts = {};
for (const name in hero) counts['hero.' + name] = CT.Art.countColors(hero[name].frames[0]);
counts['crystal'] = CT.Art.countColors(cr);
counts['treasure'] = CT.Art.countColors(tr);
counts['mark'] = CT.Art.countColors(mk);
console.log('colour counts:', JSON.stringify(counts));
console.log('max hero colours:', Math.max(...Object.keys(counts).filter(k => k.startsWith('hero')).map(k => counts[k])));

const out = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(out, { recursive: true });
savePNG(path.join(out, `04-sprites-${TH}.png`), fb.data, W, H, 3);
console.log(`sprites ${TH} ok -> build/qa/04-sprites-${TH}.png`);
