// Performance measurement: real step+render timings against the §9.8 budget.
// Node timings are not browser timings, but they exercise the identical hot path
// (software framebuffer + tile blits + text), so regressions show up here.
import { loadGame, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({ exclude: ['src/main.js'] });

const input = {
  left: false, right: false, up: false, down: false,
  upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
  stickUp: false, stickDown: false,
  jumpHeld: false, jumpPressed: false, jumpReleased: false,
  interactHeld: false, interactPressed: false, pausePressed: false, axis: 0,
};

function mkGame(levelId) {
  const fb = new CT.FB(480, 270);
  const audio = new CT.Audio();
  const game = new CT.Game({ fb, audio, touch: false });
  game.save = CT.Save.newSave(1);
  game.enterLevel(levelId);
  game.state = CT.Game.STATE.PLAYING;
  game.dialogue.active = false;
  return game;
}

function pct(arr, p) {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
}

const levels = ['forest-01', 'amber-02', 'cloud-03', 'water-04', 'star-05'];
const FRAMES = 600;
const rows = [];
let worstP99 = 0;

for (const id of levels) {
  const game = mkGame(id);
  // warm-up: forces tile/parasprite caches to fill (this is the cold-start cost)
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 60; i++) {
    input.axis = (i % 40 < 20) ? 1 : 1;
    input.right = true;
    input.jumpHeld = (i % 40) < 18;
    input.jumpPressed = (i % 40) === 0;
    game.step(1 / 60, input);
    game.render();
  }
  const coldMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const stepMs = [], renderMs = [], totalMs = [];
  for (let i = 0; i < FRAMES; i++) {
    input.right = true;
    input.axis = 1;
    input.jumpHeld = (i % 50) < 22;
    input.jumpPressed = (i % 50) === 0;

    let a = process.hrtime.bigint();
    game.step(1 / 60, input);
    let b = process.hrtime.bigint();
    game.render();
    let c = process.hrtime.bigint();

    stepMs.push(Number(b - a) / 1e6);
    renderMs.push(Number(c - b) / 1e6);
    totalMs.push(Number(c - a) / 1e6);
  }

  const over = totalMs.filter((v) => v > 16.667).length;
  const p99 = pct(totalMs, 0.99);
  worstP99 = Math.max(worstP99, p99);
  rows.push({
    level: id,
    coldFirstFrame: +(coldMs / 60).toFixed(2),
    stepP50: +pct(stepMs, 0.5).toFixed(3),
    renderP50: +pct(renderMs, 0.5).toFixed(3),
    totalP50: +pct(totalMs, 0.5).toFixed(3),
    totalP95: +pct(totalMs, 0.95).toFixed(3),
    totalP99: +pct(totalMs, 0.99).toFixed(3),
    max: +Math.max(...totalMs).toFixed(3),
    over16ms: over,
  });
}

console.log('\n=== per-level frame cost (ms, step+render) ===');
const cols = ['level', 'totalP50', 'totalP95', 'totalP99', 'max', 'stepP50', 'renderP50', 'over16ms'];
console.log(cols.map((c) => c.padEnd(12)).join(''));
for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(12)).join(''));

// heap churn: play 600 frames and see whether the hot path allocates unbounded
if (global.gc) global.gc();
const heapBefore = process.memoryUsage().heapUsed;
{
  const game = mkGame('forest-03');
  for (let i = 0; i < 600; i++) {
    input.right = true; input.axis = 1;
    input.jumpHeld = (i % 50) < 22; input.jumpPressed = (i % 50) === 0;
    game.step(1 / 60, input);
  }
}
if (global.gc) global.gc();
const heapAfter = process.memoryUsage().heapUsed;
const heapDelta = (heapAfter - heapBefore) / 1024 / 1024;

const verdict = {
  allFramesUnder16_7ms: rows.every((r) => r.over16ms === 0),
  worstP99: +worstP99.toFixed(3),
  budgetMs: 16.667,
  headroomP50: +(16.667 - Math.max(...rows.map((r) => r.totalP50))).toFixed(2),
  heapDeltaMB: +heapDelta.toFixed(2),
};
console.log('\n=== verdict ===');
console.log(JSON.stringify(verdict, null, 1));

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'perf-report.json'),
  JSON.stringify({ rows, verdict }, null, 1));

if (!verdict.allFramesUnder16_7ms) {
  console.error('\nFAIL: some frames exceeded the 16.67 ms budget');
  process.exitCode = 1;
} else {
  console.log('\nPASS: every measured frame fits the 60 fps budget');
}
