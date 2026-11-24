import { loadGame, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({ exclude: ['src/main.js'] });
const id = process.argv[2] || 'star-03';
const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'levels', id + '.json'), 'utf8'));
const L = new CT.Level(json);

console.log('level', id, 'w=', L.tw, 'h=', L.th, 'spawn=', JSON.stringify(json.spawn));
const X0 = Number(process.argv[3] || 12), X1 = X0 + 18;
console.log('\ntiles ' + X0 + '..' + X1 + '  (# solid, = platform, . air)');
for (let ty = 6; ty < L.th; ty++) {
  let line = '';
  for (let tx = X0; tx <= X1; tx++) {
    const c = L.codeAt(tx, ty);
    line += c === 1 ? '#' : (c === 2 ? '=' : '.');
  }
  console.log(String(ty).padStart(2) + ' ' + line);
}
let sy = [];
for (let tx = X0; tx <= X1; tx++) sy.push(L.surfaceY[tx]);
console.log('surfaceY: ' + sy.join(','));

// simulate a simple right-hold + jump and log where it stops
const p = new CT.Player();
p.reset(json.spawn[0] * 16, json.spawn[1] * 16);
const input = {
  left: false, right: true, up: false, down: false,
  upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
  stickUp: false, stickDown: false,
  jumpHeld: false, jumpPressed: false, jumpReleased: false,
  interactHeld: false, interactPressed: false, pausePressed: false, axis: 1,
};
let hold = 0, maxX = p.x;
for (let f = 0; f < 60 * 10; f++) {
  const feetTile = Math.floor((p.bottom() + 2) / 16);
  let gap = false, wall = false;
  for (let look = 1; look <= 3; look++) {
    const tx = Math.floor((p.x + p.w) / 16) + look;
    if (!L.isSolid(tx, feetTile) && !L.isSolid(tx, feetTile + 1)) gap = true;
    for (let up = 1; up <= 2; up++) {
      if (L.isSolid(tx, feetTile - up) && !L.isSolid(Math.floor((p.x + p.w) / 16), feetTile - up)) wall = true;
    }
  }
  const jp = (gap || wall) && p.onGround && hold === 0;
  if (jp) hold = 14;
  input.jumpPressed = jp;
  input.jumpHeld = hold > 0;
  if (hold > 0) hold--;
  p.step(1 / 60, L, input, null);
  if (p.x > maxX) maxX = p.x;
  if (f % 20 === 0 && f < 400) {
    console.log(`f=${f} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} vx=${p.vx.toFixed(0)} vy=${p.vy.toFixed(0)} ground=${p.onGround}`);
  }
}
console.log('maxX=', maxX.toFixed(1), 'tile', (maxX / 16).toFixed(1));
