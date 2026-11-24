// Build-time level generation + validation (§5.3 / §5.4 gates).
import { loadGame, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({
  files: [
    'src/core/rng.js', 'src/core/fb.js',
    'src/art/palette.js', 'src/art/artkit.js', 'src/art/gen_tiles.js', 'src/art/gen_sprites.js',
    'src/world/themes.js', 'src/world/level.js', 'src/world/levelgen.js',
  ],
});

// inject the text corpus so treasure ids line up with generated level content
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'text', 'content.json'), 'utf8'));
CT.DATA = { content };

const outDir = path.join(ROOT, 'data', 'levels');
fs.mkdirSync(outDir, { recursive: true });

const rows = [];
let failures = 0;
for (const id of CT.Themes.ORDER) {
  const json = CT.LevelGen.generate(id);
  const res = CT.LevelGen.validate(json);
  if (!res.ok) {
    failures++;
    console.error(`\n[${id}] FAILED:`);
    for (const e of res.errors) console.error('   - ' + e);
  }
  fs.writeFileSync(path.join(outDir, id + '.json'), JSON.stringify(json, null, 1) + '\n');
  rows.push({
    id,
    W: res.stats.W, H: res.stats.H,
    drop: res.stats.maxDrop, gap: res.stats.maxGap, step: res.stats.maxStepUp,
    mech: `${res.stats.mechGroups}/${res.stats.mechKinds}`,
    tr: res.stats.sideTreasures,
    dec: res.stats.decor, minDec: res.stats.minDecorPerScreen,
    br: res.stats.branches,
    layout: (json.meta && json.meta.layout) || '-',
    haz: res.stats.hazards,
    ok: res.ok ? 'OK' : 'FAIL',
  });
}

const cols = ['id', 'W', 'H', 'drop', 'gap', 'step', 'mech', 'tr', 'dec', 'minDec', 'br', 'haz', 'layout', 'ok'];
console.log('\n' + cols.map(c => c.padEnd(7)).join(''));
for (const r of rows) console.log(cols.map(c => String(r[c]).padEnd(c === 'layout' ? 10 : 7)).join(''));

const tots = {
  levels: rows.length,
  decorMin: Math.min(...rows.map(r => r.dec)),
  decorMax: Math.max(...rows.map(r => r.dec)),
  perScreenMin: Math.min(...rows.map(r => r.minDec)),
  widthRange: [Math.min(...rows.map(r => r.W)), Math.max(...rows.map(r => r.W))],
  heightRange: [Math.min(...rows.map(r => r.H)), Math.max(...rows.map(r => r.H))],
};
console.log('\nsummary:', JSON.stringify(tots));
if (failures) { console.error(`\n${failures} level(s) failed validation`); process.exit(1); }
console.log('all 25 levels generated and validated');
