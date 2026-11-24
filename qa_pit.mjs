// 回归测试：掉进坑里必须扣命复活，不能卡在坑底
// 复现用户截图的情形：主角落进一个深坑，最终停在关卡最低一行上不动。
import { loadGame, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({ exclude: ['src/main.js'] });
const TS = 16;

const idle = {
  left: false, right: false, up: false, down: false,
  upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
  stickUp: false, stickDown: false,
  jumpHeld: false, jumpPressed: false, jumpReleased: false,
  interactHeld: false, interactPressed: false, pausePressed: false, axis: 0,
};

function mkGame(id) {
  const fb = new CT.FB(480, 270);
  const game = new CT.Game({ fb, audio: new CT.Audio(), touch: false });
  game.save = CT.Save.newSave(1);
  game.enterLevel(id);
  game.state = CT.Game.STATE.PLAYING;
  game.dialogue.active = false;
  return game;
}

// 找一关里最深的那个坑
function deepestPit(level) {
  let best = null;
  for (let x = 2; x < level.tw - 2; x++) {
    if (level.surfaceY[x] >= 0) continue;          // 这一列有地，不是坑
    if (level.surfaceY[x - 1] < 0 && level.surfaceY[x - 2] < 0) continue;
    // 坑的左右应当有地
    let leftOk = false, rightOk = false;
    for (let k = 1; k <= 4; k++) {
      if (x - k >= 0 && level.surfaceY[x - k] >= 0) { leftOk = true; break; }
    }
    for (let k = 1; k <= 4; k++) {
      if (x + k < level.tw && level.surfaceY[x + k] >= 0) { rightOk = true; break; }
    }
    if (leftOk && rightOk) { best = x; break; }
  }
  return best;
}

const results = [];
let fails = 0;

for (const id of CT.Themes.ORDER) {
  const game = mkGame(id);
  const L = game.level;
  const pitX = deepestPit(L);
  if (pitX === null) continue;

  const lives0 = game.lives;
  // 直接丢到坑的正中央上空
  game.player.reset(pitX * TS + TS / 2 - 5, 40);

  let lostAt = -1;
  for (let f = 0; f < 60 * 6; f++) {
    game.step(1 / 60, idle);
    if (game.lives < lives0) { lostAt = f; break; }
  }
  const ok = game.lives === lives0 - 1 && lostAt >= 0;
  const back = Math.abs(game.player.x - game.respawn.x) < 2;
  if (!ok || !back) fails++;
  results.push({
    id,
    pitTile: pitX,
    ok: ok && back,
    detail: ok ? `第 ${lostAt} 帧扣命，命 ${lives0}->${game.lives}，回重生点=${back}`
               : `未扣命（命仍为 ${game.lives}，y=${Math.round(game.player.y)} pxH=${L.pxH}）`,
  });
}

console.log('\n=== 掉坑必扣命（逐关取最深坑） ===');
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.id.padEnd(12)} 坑在 tile ${String(r.pitTile).padEnd(4)} ${r.detail}`);
}
console.log(`\n${results.length - fails}/${results.length} 通过`);

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'pit-death.json'), JSON.stringify(results, null, 1));
if (fails) { console.error('FAIL: 有坑不会触发扣命'); process.exitCode = 1; }
