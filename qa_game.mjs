// Full-game integration QA: boots every module, plays a level headlessly, and
// writes real frames through the exact same render path the browser uses.
import { loadGame, ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({ exclude: ['src/main.js'] });

const outDir = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(outDir, { recursive: true });

const VW = 480, VH = 270;

function mkGame() {
  const fb = new CT.FB(VW, VH);
  const audio = new CT.Audio();          // 无 AudioContext 时全部 no-op
  const game = new CT.Game({ fb, audio, touch: false });
  return { fb, game };
}

// deterministic input stub so headless play is reproducible
function makeInput(over) {
  const base = {
    left: false, right: false, up: false, down: false,
    upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
    stickUp: false, stickDown: false,
    jumpHeld: false, jumpPressed: false, jumpReleased: false,
    interactHeld: false, interactPressed: false, pausePressed: false, axis: 0,
  };
  return Object.assign(base, over || {});
}

const results = [];
function shot(name, scale) {
  savePNG(path.join(outDir, name + '.png'), resultsLastFb.data, VW, VH, scale || 3);
}
let resultsLastFb = null;

// ---------------------------------------------------------------- 1. title
{
  const { fb, game } = mkGame();
  resultsLastFb = fb;
  game.save = CT.Save.newSave(1);
  game.render();
  shot('10-title');
  console.log('title ok');
}

// ---------------------------------------------------------------- 2. gameplay
const levelsToShoot = process.argv[2]
  ? [process.argv[2]]
  : ['forest-01', 'forest-03', 'amber-02', 'amber-05', 'cloud-03', 'water-04', 'star-05'];

for (const id of levelsToShoot) {
  const { fb, game } = mkGame();
  resultsLastFb = fb;
  game.save = CT.Save.newSave(1);
  game.collected = {};
  game.enterLevel(id);
  game.state = CT.Game.STATE.PLAYING;
  // 关掉开场对话，直接看世界
  game.dialogue.active = false;

  // 走 90 帧让镜头落位；向右推进以看到更多地形
  for (let i = 0; i < 90; i++) {
    game.step(1 / 60, makeInput({ right: true, axis: 1 }));
  }
  game.render();
  shot('11-play-' + id);
  console.log(`play ${id} ok  state=${game.state} playerX=${Math.round(game.player.x)} fps=${game.fps}`);
}

// ---------------------------------------------------------------- 3. dialogue
{
  const { fb, game } = mkGame();
  resultsLastFb = fb;
  game.save = CT.Save.newSave(1);
  game.enterLevel('forest-01');
  game.state = CT.Game.STATE.PLAYING;
  const C = CT.DATA.content;
  const intro = C.intros[0];
  game.dialogue.open('云絮信使', CT.Dialogue.wrapLines(intro.intro));
  for (let i = 0; i < 40; i++) game.step(1 / 60, makeInput());
  game.render();
  shot('12-dialogue');
  console.log('dialogue ok');
}

// ---------------------------------------------------------------- 4. pause / codex / settings / clear
for (const [st, name] of [
  [CT.Game.STATE.PAUSED, '13-pause'],
  [CT.Game.STATE.CODEX, '14-codex'],
  [CT.Game.STATE.SETTINGS, '15-settings'],
]) {
  const { fb, game } = mkGame();
  resultsLastFb = fb;
  game.save = CT.Save.newSave(1);
  game.enterLevel('amber-03');
  game.autoSave();
  game.state = st;
  game.render();
  shot(name);
  console.log(name + ' ok');
}

// ---------------------------------------------------------------- 5. level clear with crystal
{
  const { fb, game } = mkGame();
  resultsLastFb = fb;
  game.save = CT.Save.newSave(1);
  game.enterLevel('star-05');
  game.state = CT.Game.STATE.PLAYING;
  game.completeLevel();
  for (let i = 0; i < 60; i++) game.step(1 / 60, makeInput());
  game.render();
  shot('16-clear');
  console.log('clear ok, crystal=' + (game.clearCrystal ? game.clearCrystal.name : 'none'));
}

// ---------------------------------------------------------------- 6. touch layout
{
  const { fb, game } = mkGame();
  resultsLastFb = fb;
  game.touchActive = true;
  game.save = CT.Save.newSave(1);
  game.enterLevel('water-02');
  game.state = CT.Game.STATE.PLAYING;
  game.dialogue.active = false;
  for (let i = 0; i < 20; i++) game.step(1 / 60, makeInput());
  game.render();
  shot('17-touch');
  console.log('touch ok');
}

// ---------------------------------------------------------------- 7. 逐主题通走一遍，抓异常
{
  let bad = 0;
  for (const id of CT.Themes.ORDER) {
    const { game } = mkGame();
    game.save = CT.Save.newSave(1);
    game.enterLevel(id);
    game.state = CT.Game.STATE.PLAYING;
    try {
      for (let i = 0; i < 180; i++) {
        // 交替右走/跳，尽量触发各种状态
        const jump = (i % 40 < 16);
        game.step(1 / 60, makeInput({ right: true, axis: 1, jumpHeld: jump, jumpPressed: i % 40 === 0 }));
      }
      game.render();
    } catch (e) {
      bad++;
      console.error(`FAIL ${id}: ${e.message}`);
    }
  }
  console.log(bad === 0 ? 'all 25 levels simulate clean' : `${bad} levels threw`);
  if (bad) process.exitCode = 1;
}

console.log('\nQA frames written to build/qa/');
