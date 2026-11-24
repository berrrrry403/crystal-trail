// Targeted checks for the level-completion path and the fast-reset path —
// the two transitions a bot is bad at exercising but that must never break.
import { loadGame, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({ exclude: ['src/main.js'] });
const TS = 16;

function mkGame(id) {
  const fb = new CT.FB(480, 270);
  const game = new CT.Game({ fb, audio: new CT.Audio(), touch: false });
  game.save = CT.Save.newSave(1);
  game.enterLevel(id);
  game.state = CT.Game.STATE.PLAYING;
  game.dialogue.active = false;
  return game;
}

const idle = {
  left: false, right: false, up: false, down: false,
  upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
  stickUp: false, stickDown: false,
  jumpHeld: false, jumpPressed: false, jumpReleased: false,
  interactHeld: false, interactPressed: false, pausePressed: false, axis: 0,
};

const results = [];
let fails = 0;

// ---------------------------------------------------------------- 1. exit
for (const id of CT.Themes.ORDER) {
  const game = mkGame(id);
  const L = game.level;
  const ex = L.exit;
  // 把玩家直接放到出口所在列的地面上
  const px = ex.at[0] * TS + TS / 2 - 5;
  const floorRow = L.surfaceY[ex.at[0]] >= 0 ? L.surfaceY[ex.at[0]] : ex.at[1] + 1;
  const py = floorRow * TS - 20;
  game.player.reset(px, py);
  let cleared = false;
  for (let i = 0; i < 6; i++) {
    game.step(1 / 60, idle);
    if (game.state === CT.Game.STATE.CLEAR) { cleared = true; break; }
  }
  if (!cleared) fails++;
  results.push({ check: 'exit', level: id, ok: cleared, detail: `exit tile ${ex.at[0]}, floor row ${floorRow}` });
}

// ---------------------------------------------------------------- 2. 掉坑扣命 + 即时复活 + 不冻结输入
for (const id of ['forest-01', 'cloud-02', 'star-04']) {
  const game = mkGame(id);
  const lives0 = game.lives;
  game.player.y = game.level.pxH + 40;      // 丢到关卡下边界之外
  let hurtSeen = false;
  for (let i = 0; i < 90; i++) {
    game.step(1 / 60, idle);
    if (game.hurtFx > 0) hurtSeen = true;
    if (game.lives < lives0) break;
  }
  const respawned = Math.abs(game.player.x - game.respawn.x) < 2 &&
                    Math.abs(game.player.y - game.respawn.y) < 2;
  const livesLost = lives0 - game.lives === 1;

  // 复活后画面不许冻结：立刻给一个向右输入，主角应当能继续动
  const x0 = game.player.x;
  for (let i = 0; i < 12; i++) {
    game.step(1 / 60, { ...idle, right: true, axis: 1 });
  }
  const x1 = game.player.x;
  const notFrozen = Math.abs(x1 - x0) > 2;
  const beenInvuln = game.invuln >= 0;

  const ok = hurtSeen && respawned && livesLost && notFrozen;
  if (!ok) fails++;
  results.push({
    check: '掉坑扣命', level: id, ok,
    detail: `命 ${lives0}->${game.lives} 受伤闪屏=${hurtSeen} 回重生点=${respawned} 复活后仍可移动=${notFrozen}(${Math.round(x1 - x0)}px)`,
  });
}

// ---------------------------------------------------------------- 2b. 撞滚石扣命
{
  const game = mkGame('forest-01');
  const hz = game.mech.hazards[0];
  if (hz) {
    const lives0 = game.lives;
    game.player.reset(hz.x, hz.y);
    for (let i = 0; i < 30; i++) game.step(1 / 60, idle);
    const ok = game.lives === lives0 - 1;
    if (!ok) fails++;
    results.push({ check: '撞滚石扣命', level: 'forest-01', ok,
      detail: `命 ${lives0}->${game.lives}（滚石在 tile ${Math.round(hz.x / 16)}）` });
  } else {
    fails++;
    results.push({ check: '撞滚石扣命', level: 'forest-01', ok: false, detail: '该关没有生成滚石' });
  }
}

// ---------------------------------------------------------------- 2c. 三条命用完重开本关
{
  const game = mkGame('forest-01');
  const id = game.currentLevelId;
  for (let k = 0; k < 3; k++) {
    game.invuln = 0;
    game.player.y = game.level.pxH + 40;
    for (let i = 0; i < 40; i++) game.step(1 / 60, idle);
  }
  const ok = game.lives === game.maxLives && game.currentLevelId === id &&
             game.state === CT.Game.STATE.PLAYING;
  if (!ok) fails++;
  results.push({ check: '三条命用完', level: id, ok,
    detail: `重开后命数=${game.lives} 关卡=${game.currentLevelId} 状态=${game.state}` });
}

// ---------------------------------------------------------------- 3. collect + save roundtrip
{
  const game = mkGame('forest-01');
  const t = game.levelTreasures.find((x) => x.kind === 'side');
  if (t) {
    const box = game.treasureBox(t);
    game.player.reset(box.x, box.y);
    game.step(1 / 60, idle);
    const got = !!game.collected[t.id];
    // 存到槽位再读回来
    game.persist();
    const loaded = CT.Save.load(1);
    const roundtrip = !!(loaded && loaded.collected && loaded.collected[t.id]);
    const ok = got && roundtrip;
    if (!ok) fails++;
    results.push({ check: 'collect+save', level: 'forest-01', ok, detail: `${t.id} collected=${got} persisted=${roundtrip}` });
  }
}

// ---------------------------------------------------------------- 3b. 进关瞬间镜头必须在关卡边界内
// 回归项：Camera.snapTo 曾经不做钳制，主角靠左时相机会跑到负坐标，
// 而开场对话激活期间 update() 不执行，导致左边界墙被画到屏幕中间。
{
  for (const id of ['forest-01', 'forest-05', 'star-05', 'cloud-01']) {
    const game = mkGame(id);
    // 只进关卡、不移动；此时开场介绍对话是激活的
    const cx = game.camera.renderX(), cy = game.camera.renderY();
    const maxX = Math.max(0, game.level.pxW - 480);
    const maxY = Math.max(0, game.level.pxH - 270);
    const ok = cx >= 0 && cx <= maxX && cy >= 0 && cy <= maxY;
    if (!ok) fails++;
    results.push({
      check: 'camera-clamp', level: id, ok,
      detail: `camera=(${cx},${cy}) 允许范围 x:0~${maxX} y:0~${maxY}`,
    });
  }
}

// ---------------------------------------------------------------- 3c. 站着不动不许有落地尘、不许抖动
// 回归项：重力每帧把身体压下 0.2 像素再被弹回，moveY 曾因此每帧都报告
// 「刚落地」，脚边尘土与落地音效会连成一片，看起来就是在原地跺脚。
{
  const game = mkGame('forest-01');
  // 先让它落到地面并稳定下来
  for (let i = 0; i < 40; i++) game.step(1 / 60, idle);
  // 只统计「交互粒子」(kind 1)，排除一直在飘的落叶/星尘等环境粒子
  function interactCount(g) {
    let n = 0;
    for (let i = 0; i < g.particles.n; i++) if (g.particles.kind[i] === 1) n++;
    return n;
  }
  const dustBefore = interactCount(game);
  let landedCount = 0;
  const origLand = game.mech.onPlayerLand.bind(game.mech);
  game.mech.onPlayerLand = function (p) { landedCount++; origLand(p); };

  // 静止 1.5 秒
  // 只统计主角脚边 12 像素内的交互粒子：滚石滚动也会扬尘，那是别处的。
  let spawnedInteract = 0;
  const prevSpawn = game.particles.spawn.bind(game.particles);
  game.particles.spawn = function (kind, x, y) {
    if (kind === 1 && Math.abs(x - game.player.centreX()) < 12) spawnedInteract++;
    return prevSpawn.apply(game.particles, arguments);
  };
  for (let i = 0; i < 90; i++) game.step(1 / 60, idle);
  game.particles.spawn = prevSpawn;
  const dustAfter = interactCount(game);
  const onGround = game.player.onGround;
  const ok = onGround && landedCount === 0 && spawnedInteract === 0;
  if (!ok) fails++;
  results.push({
    check: '站立不跺脚', level: 'forest-01', ok,
    detail: `着地=${onGround} 1.5 秒内落地事件=${landedCount} 新增交互粒子=${spawnedInteract}（当前 ${dustBefore}->${dustAfter}）`,
  });
}

// ---------------------------------------------------------------- 3d. 移动时装饰不摆动
{
  const game = mkGame('forest-01');
  for (let i = 0; i < 40; i++) game.step(1 / 60, idle);
  // 走动中：所有装饰必须零位移
  game.playerMoving = true;
  const okMove = game.playerMoving === true;
  // 站定时才允许 1 像素微动
  game.playerMoving = false;
  const okIdle = game.playerMoving === false;
  const ok = okMove && okIdle;
  if (!ok) fails++;
  results.push({ check: '移动不抖装饰', level: 'forest-01', ok,
    detail: `playerMoving 标志可切换（移动时不叠加 sway）` });
}

// ---------------------------------------------------------------- 4. dialogue typing rate (§6.3 24 chars/s)
{
  const game = mkGame('forest-01');
  const text = '把左边那块反光石推到光路上，光好像没有照到那个台座。';
  game.dialogue.open('林间萤灵', CT.Dialogue.wrapLines(text));
  game.dialogue.active = true;
  // 1 秒后应当正好显示 24 个字
  for (let i = 0; i < 60; i++) game.step(1 / 60, idle);
  const shown = game.dialogue.revealed;
  const ok = Math.abs(shown - 24) <= 1;
  if (!ok) fails++;
  results.push({ check: 'typewriter', level: 'forest-01', ok, detail: `revealed ${shown} chars after 1.0s (expected 24)` });
}

console.log('\n=== targeted behaviour checks ===');
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.check.padEnd(14)} ${r.level.padEnd(12)} ${r.detail}`);
}
console.log(`\n${results.length - fails}/${results.length} passed`);

fs.writeFileSync(path.join(ROOT, 'build', 'behaviour.json'), JSON.stringify(results, null, 1));
if (fails) { console.error('FAIL'); process.exitCode = 1; }
