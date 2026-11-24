// Full-traversal proof: with every door forced open, can a simple bot walk from
// the spawn all the way to the level exit? This isolates level geometry from
// puzzle solving, which is what actually needs to be proven traversable.
import { loadGame, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({ exclude: ['src/main.js'] });
const TS = 16;

function mkInput(o) {
  return Object.assign({
    left: false, right: false, up: false, down: false,
    upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
    stickUp: false, stickDown: false,
    jumpHeld: false, jumpPressed: false, jumpReleased: false,
    interactHeld: false, interactPressed: false, pausePressed: false, axis: 0,
  }, o);
}

const rows = [];
let failures = 0;

for (const id of CT.Themes.ORDER) {
  const fb = new CT.FB(480, 270);
  const game = new CT.Game({ fb, audio: new CT.Audio(), touch: false });
  game.save = CT.Save.newSave(1);
  game.enterLevel(id);
  game.state = CT.Game.STATE.PLAYING;
  game.dialogue.active = false;

  const mech = game.mech;
  // 开门：把谜题这一层因素排除掉，只考察地形连通性
  for (const d of mech.doors) {
    mech._setDoor(d.id, true);
    mech._holdDoor(d.id, true);
  }

  const L = game.level;
  const p = game.player;
  let hold = 0;
  let maxX = p.x;
  let stuck = 0;
  let reachedExit = false;
  let frames = 0;

  const exitX = L.exit.at[0] * TS + TS / 2;

  for (let f = 0; f < 60 * 300; f++) {
    frames = f;
    // 在坑沿起跳：看紧邻的下一格。提前起跳会落进坑里。
    const feetTile = Math.floor((p.bottom() + 2) / TS);
    const selfTile = Math.floor((p.x + p.w) / TS);
    const nt = selfTile + 1;
    const gapEdge = !L.isSolid(nt, feetTile) && !L.isSolid(nt, feetTile + 1);
    const wallEdge = L.isSolid(nt, feetTile - 1) && !L.isSolid(selfTile, feetTile - 1);
    const jp = (gapEdge || wallEdge || stuck > 10) && p.onGround;
    if (jp) hold = 18;
    game.step(1 / 60, mkInput({
      right: true, axis: 1,
      jumpHeld: hold > 0, jumpPressed: jp,
    }));
    if (hold > 0) hold--;
    // 机关每帧会重新判定门的状态，因此这里每帧都要再强制一次
    for (const d of mech.doors) { mech._holdDoor(d.id, true); mech._setDoor(d.id, true); }

    if (p.x > maxX + 0.4) { maxX = p.x; stuck = 0; } else stuck++;

    if (game.state === CT.Game.STATE.CLEAR) { reachedExit = true; break; }
    if (stuck > 60 * 20) break;
    if (p.centreX() > exitX + 40) break;
  }

  if (!reachedExit) failures++;
  rows.push({
    id,
    reachedExit,
    progress: ((maxX / L.pxW) * 100).toFixed(1) + '%',
    tile: Math.round(maxX / TS),
    width: L.tw,
    seconds: (frames / 60).toFixed(0),
  });
}

console.log('\n=== full traversal with doors forced open ===');
console.log('level'.padEnd(12) + 'reached'.padEnd(10) + 'tile/width'.padEnd(14) + 'time');
for (const r of rows) {
  console.log(r.id.padEnd(12) + String(r.reachedExit).padEnd(10) +
    (r.tile + '/' + r.width).padEnd(14) + r.seconds + 's');
}
console.log(`\n${rows.length - failures}/${rows.length} levels fully traversable end-to-end`);

fs.writeFileSync(path.join(ROOT, 'build', 'traversal.json'), JSON.stringify(rows, null, 1));
if (failures) {
  console.error('FAIL: some levels cannot be walked end-to-end');
  process.exitCode = 1;
} else {
  console.log('PASS: every level is traversable from spawn to exit');
}
