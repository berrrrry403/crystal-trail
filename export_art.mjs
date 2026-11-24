// Exports the procedurally generated art to real PNG files under assets/art/.
// Two reasons: §9.7 requires deliverable art sources, and §7.7 requires a Pillow
// validator to inspect actual image files (colour count, alpha, integer scale).
import { loadGame, ROOT } from './harness.mjs';
import { encodePNG, savePNG } from './png.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({ exclude: ['src/main.js'] });

const TS = 16;
const ATLAS = 1024;
const COLS = ATLAS / TS;

function bufToPNG(b, scale) {
  const w = b.w, h = b.h;
  const out = new Uint32Array(w * h);
  // Art buffers use .d; FB buffers use .data
  const src = b.d || b.data;
  out.set(src.subarray(0, w * h));
  return encodePNG(out, w, h, scale || 1);
}

function blit(dst, dstW, dx, dy, src, sw, sh) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const c = src[y * sw + x];
      if (c === 0) continue;
      const tx = dx + x, ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dstW) continue;
      dst[ty * dstW + tx] = c;
    }
  }
}

const tileDir = path.join(ROOT, 'assets', 'art', 'tiles');
const spriteDir = path.join(ROOT, 'assets', 'art', 'sprites');
fs.mkdirSync(tileDir, { recursive: true });
fs.mkdirSync(spriteDir, { recursive: true });

// ---------------------------------------------------------------- tilesets
// Collect every (kind, mask, variant, depth) combination the 5 levels of a
// theme actually use, then lay them out in a 1024 × 1024 atlas (§7.3).
const report = {};
for (const th of CT.Themes.LIST) {
  const seen = new Map();
  const K = CT.Tiles.KIND;
  for (let li = 1; li <= 5; li++) {
    const id = th.key + '-' + String(li).padStart(2, '0');
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'levels', id + '.json'), 'utf8'));
    const level = new CT.Level(json);
    for (let ty = 0; ty < level.th; ty++) {
      for (let tx = 0; tx < level.tw; tx++) {
        const code = level.codeAt(tx, ty);
        if (code === 0) continue;
        let kind = K.GROUND;
        if (code === 2) kind = K.PLATFORM;
        else if (code === 3) kind = K.SLOPE_R;
        else if (code === 4) kind = K.SLOPE_L;
        const mask = level.neighbourMask(tx, ty);
        const v = CT.hash2(tx, ty, 0x51) & 3;
        const dc = kind === K.GROUND ? level.depthClass(tx, ty) : 0;
        const key = kind + ':' + mask + ':' + v + ':' + dc;
        if (!seen.has(key)) seen.set(key, { kind, mask, v, dc });
      }
    }
  }
  const list = [...seen.values()];
  if (list.length > COLS * COLS) throw new Error(`${th.key}: ${list.length} tiles > atlas capacity`);

  const atlasPx = new Uint32Array(ATLAS * ATLAS);
  list.forEach((t, i) => {
    const tile = CT.Tiles.getTile(th.key, t.kind, t.mask, t.v, t.dc);
    const cx = (i % COLS) * TS;
    const cy = Math.floor(i / COLS) * TS;
    blit(atlasPx, ATLAS, cx, cy, tile.d, TS, TS);
  });
  fs.writeFileSync(path.join(tileDir, `${th.key}-tileset.png`), encodePNG(atlasPx, ATLAS, ATLAS, 1));
  report[th.key + '-tileset'] = list.length;

  // 三层视差条带单独导出，方便美术复核
  const bg = CT.BG.build(th.key);
  savePNG(path.join(tileDir, `${th.key}-parallax-far.png`), bg.far.d, bg.far.w, bg.far.h, 1);
  savePNG(path.join(tileDir, `${th.key}-parallax-mid.png`), bg.mid.d, bg.mid.w, bg.mid.h, 1);
  savePNG(path.join(tileDir, `${th.key}-parallax-near.png`), bg.near.d, bg.near.w, bg.near.h, 1);
}

// ---------------------------------------------------------------- sprites
// hero sheets: 16 × 24 cells padded to 24 × 32 so the sheet is 8-aligned
const ANIMS = ['idle', 'walk', 'jump', 'pickup', 'talk', 'celebrate'];
for (const th of CT.Themes.LIST) {
  const hero = CT.Sprites.buildHero(th.key);
  const CELL_W = 24, CELL_H = 32;
  const maxFrames = Math.max(...ANIMS.map((a) => hero[a].frames.length));
  const w = CELL_W * maxFrames, h = CELL_H * ANIMS.length;
  const sheet = new Uint32Array(w * h);
  ANIMS.forEach((a, row) => {
    hero[a].frames.forEach((f, col) => {
      blit(sheet, w, col * CELL_W + 4, row * CELL_H + 4, f.d, 16, 24);
    });
  });
  fs.writeFileSync(path.join(spriteDir, `${th.key}-hero.png`), encodePNG(sheet, w, h, 1));
}

// npc + treasure + prop sheets (per theme, since props are theme-tinted)
for (const th of CT.Themes.LIST) {
  const P = CT.Palette.get(th.key);
  const S = CT.Sprites;
  const npcs = ['firefly', 'elder', 'messenger', 'clam', 'guide'].map((k) => S.buildNpc(k, P));
  const nw = npcs.reduce((a, b) => a + b.w + 8, 8);
  const nh = Math.max(...npcs.map((b) => b.h)) + 16;
  const npcSheet = new Uint32Array(((nw + 7) >> 3 << 3) * ((nh + 7) >> 3 << 3));
  const NW = (nw + 7) >> 3 << 3, NH = (nh + 7) >> 3 << 3;
  let nx = 4;
  for (const n of npcs) { blit(npcSheet, NW, nx, 8, n.d, n.w, n.h); nx += n.w + 8; }
  fs.writeFileSync(path.join(spriteDir, `${th.key}-npc.png`), encodePNG(npcSheet, NW, NH, 1));

  // props: 7 sets × 3 variants in a grid of 40 × 40 cells
  const PW = 40, PH = 40, PC = 3;
  const setCount = S.propSetCount(th.key);
  const ph = PH * setCount, pw = PW * PC;
  const propSheet = new Uint32Array(pw * ph);
  for (let si = 0; si < setCount; si++) {
    for (let v = 0; v < 3; v++) {
      const p = S.buildProp(th.key, si, v);
      blit(propSheet, pw, v * PW + ((PW - p.w) >> 1), si * PH + (PH - p.h), p.d, p.w, p.h);
    }
  }
  fs.writeFileSync(path.join(spriteDir, `${th.key}-props.png`), encodePNG(propSheet, pw, ph, 1));
}

// treasure / ui sheet
{
  const P = CT.Palette.get('star');
  const S = CT.Sprites;
  const items = [
    S.buildCrystal(P.c[15], P.c[0], P.c[14]),
    S.buildTreasure(P.c[15], P.c[0]),
    S.buildMark(P.c[15], P.c[0]),
  ];
  const W = 32 * items.length, H = 32;
  const sheet = new Uint32Array(W * H);
  items.forEach((it, i) => blit(sheet, W, i * 32 + 8, 8, it.d, it.w, it.h));
  fs.writeFileSync(path.join(spriteDir, 'items.png'), encodePNG(sheet, W, H, 1));
}

// font atlases for reference (1-bit masks expanded to white)
{
  const chars = CT.FONT_DATA.cjk.chars;
  const cell = CT.FONT_DATA.cjk.cell;
  const perRow = 64;
  const rows = Math.ceil(chars.length / perRow);
  const W = perRow * cell, H = rows * cell;
  const img = new Uint32Array(W * H);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    // reuse the runtime decoder via a throwaway framebuffer
    const fb = new CT.FB(W, H);
    CT.Font.draw(fb, ch, (i % perRow) * cell, Math.floor(i / perRow) * cell, 0xffffffff);
    img.set(fb.data);
  }
  savePNG(path.join(ROOT, 'build', 'qa', 'font-cjk-atlas.png'), img, W, H, 1);
}

console.log('exported art:', JSON.stringify(report));
const walk = (dir) => fs.readdirSync(dir).map((f) => {
  const p = path.join(dir, f);
  return { name: path.relative(ROOT, p), kb: +(fs.statSync(p).size / 1024).toFixed(1) };
});
console.log('tiles:', walk(tileDir).map((f) => `${path.basename(f.name)} ${f.kb}KB`).join(', '));
console.log('sprites:', walk(spriteDir).length, 'files');
