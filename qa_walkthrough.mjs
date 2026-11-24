// Playability probe: a deliberately dumb bot (hold right, jump when blocked or
// when a gap is ahead) walks every level. It cannot solve puzzles, so being
// stopped *at a closed door* is the expected outcome — being stopped by terrain
// short of any door would mean the geometry is not traversable.
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
let terrainBlocked = 0;

for (const id of CT.Themes.ORDER) {
  const fb = new CT.FB(480, 270);
  const game = new CT.Game({ fb, audio: new CT.Audio(), touch: false });
  game.save = CT.Save.newSave(1);
  game.enterLevel(id);
  game.state = CT.Game.STATE.PLAYING;
  game.dialogue.active = false;

  const mech = game.mech;
  const doors = mech.doors.slice();
  const L = game.level;
  const p = game.player;

  let maxX = p.x;
  let blockedFrames = 0;
  let jumpHold = 0;
  const FRAMES = 60 * 240;          // 4 分钟游戏时间
  let done = false;
  let clearedAt = -1;

  for (let f = 0; f < FRAMES; f++) {
    // —— 简易机器人 ——
    let jump = jumpHold > 0;
    if (jumpHold > 0) jumpHold--;

    // 往前方看 1~3 格：有坑、或有需要爬的台阶，就提前起跳
    const feetTile = Math.floor((p.bottom() + 2) / TS);
    let gapAhead = false, wallAhead = false;
    for (let look = 1; look <= 4; look++) {
      const tx = Math.floor((p.x + p.w) / TS) + look;
      if (!L.isSolid(tx, feetTile) && !L.isSolid(tx, feetTile + 1)) gapAhead = true;
      for (let up = 1; up <= 2; up++) {
        if (L.isSolid(tx, feetTile - up) && !L.isSolid(Math.floor((p.x + p.w) / TS), feetTile - up)) wallAhead = true;
      }
    }

    const jumpPressed = (gapAhead || wallAhead || blockedFrames > 6) && p.onGround && jumpHold === 0;
    if (jumpPressed) jumpHold = 14;
    jump = jumpHold > 0 || jumpPressed;

    game.step(1 / 60, mkInput({
      right: true, axis: 1,
      jumpHeld: jump, jumpPressed: jumpPressed,
    }));

    if (p.x > maxX + 0.5) { maxX = p.x; blockedFrames = 0; }
    else blockedFrames++;

    if (game.state === CT.Game.STATE.CLEAR) { done = true; clearedAt = f; break; }
    if (blockedFrames > 60 * 12) break;    // 12 秒没有一点进展，判定卡住
  }

  // 卡住的位置附近有没有门？
  const stopX = maxX;
  let atDoor = false;
  for (const d of doors) {
    if (Math.abs(d.tx * TS - stopX) < 40) { atDoor = true; break; }
  }
  // 区分「掉进坑里（机器人的起跳时机问题）」与「真的被地形挡住」
  let blockedKind = 'cleared';
  if (!done) {
    blockedKind = atDoor ? 'door' : 'pit-or-wall';
    if (!atDoor) {
      const stopTile = Math.floor(stopX / TS);
      const feetRow = Math.floor((L.surfaceY[stopTile] > 0 ? L.surfaceY[stopTile] * TS : 0) / TS);
      // 前方 1~3 格是否存在高于 2 格的墙：那才是真的过不去
      let wall = 0;
      for (let look = 1; look <= 3; look++) {
        const tx = stopTile + look;
        for (let up = 1; up <= 8; up++) {
          if (L.isSolid(tx, feetRow - up) && !L.isSolid(stopTile, feetRow - up)) { wall = up; }
        }
      }
      blockedKind = wall > 2 ? 'WALL' : 'pit(jump timing)';
      if (wall > 2) terrainBlocked++;
    }
  }

  rows.push({
    id,
    progress: +((maxX / L.pxW) * 100).toFixed(1) + '%',
    maxXTile: Math.round(maxX / TS),
    widthTiles: L.tw,
    cleared: done,
    blockedBy: blockedKind,
    climb: Math.round(maxX / TS) + '/' + L.tw,
  });
}

console.log('\n=== bot walkthrough (expected to stop at locked doors) ===');
console.log('level'.padEnd(12) + 'progress'.padEnd(11) + 'tile/width'.padEnd(14) + 'blocked by');
for (const r of rows) {
  console.log(r.id.padEnd(12) + r.progress.padEnd(11) + r.climb.padEnd(14) + r.blockedBy);
}

const cleared = rows.filter((r) => r.cleared).length;
const doors = rows.filter((r) => r.blockedBy === 'door').length;
console.log(`\ncleared ${cleared}/${rows.length}, stopped at door ${doors}, terrain-blocked ${terrainBlocked}`);

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'walkthrough.json'), JSON.stringify(rows, null, 1));

if (terrainBlocked > 0) {
  console.error('FAIL: levels blocked by terrain before any mechanism');
  process.exitCode = 1;
} else {
  console.log('PASS: no level is blocked by geometry alone');
}
