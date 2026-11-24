// Debug: run one level's traversal bot and dump the final seconds of state.
import { loadGame } from './harness.mjs';

const CT = loadGame({ exclude: ['src/main.js'] });
const TS = 16;
const id = process.argv[2] || 'cloud-03';

const fb = new CT.FB(480, 270);
const game = new CT.Game({ fb, audio: new CT.Audio(), touch: false });
game.save = CT.Save.newSave(1);
game.enterLevel(id);
game.state = CT.Game.STATE.PLAYING;
game.dialogue.active = false;
for (const d of game.mech.doors) { game.mech._setDoor(d.id, true); game.mech._holdDoor(d.id, true); }

const L = game.level, p = game.player;
let hold = 0, maxX = p.x, stuck = 0;
const trail = [];

for (let f = 0; f < 60 * 120; f++) {
  const feetTile = Math.floor((p.bottom() + 2) / TS);
  const selfTile = Math.floor((p.x + p.w) / TS);
  const nt = selfTile + 1;
  const gapEdge = !L.isSolid(nt, feetTile) && !L.isSolid(nt, feetTile + 1);
  const wallEdge = L.isSolid(nt, feetTile - 1) && !L.isSolid(selfTile, feetTile - 1);
  const jp = (gapEdge || wallEdge || stuck > 10) && p.onGround;
  if (jp) hold = 18;

  game.step(1 / 60, {
    left: false, right: true, up: false, down: false,
    upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
    stickUp: false, stickDown: false,
    jumpHeld: hold > 0, jumpPressed: jp, jumpReleased: false,
    interactHeld: false, interactPressed: false, pausePressed: false, axis: 1,
  });
  if (hold > 0) hold--;
  for (const d of game.mech.doors) { game.mech._holdDoor(d.id, true); game.mech._setDoor(d.id, true); }

  trail.push({ f, x: +p.x.toFixed(1), y: +p.y.toFixed(1), vy: +p.vy.toFixed(0), g: p.onGround, st: game.state, fade: +game.fade.toFixed(2) });
  if (trail.length > 400) trail.shift();

  if (p.x > maxX + 0.4) { maxX = p.x; stuck = 0; } else stuck++;
  if (game.state === CT.Game.STATE.CLEAR) { console.log('cleared at frame', f); break; }
  if (stuck > 60 * 25) { console.log('stuck at frame', f, 'x=', p.x.toFixed(1), 'tile', (p.x / TS).toFixed(1)); break; }
}

console.log('maxX tile', (maxX / TS).toFixed(1), 'of', L.tw);
console.log('surfaceY around stop:', Array.from(L.surfaceY.slice(Math.floor(maxX / TS) - 4, Math.floor(maxX / TS) + 6)).join(','));
console.log('\nlast 40 samples:');
for (const t of trail.slice(-40).filter((_, i) => i % 4 === 0)) {
  console.log(`f=${t.f} x=${t.x} y=${t.y} vy=${t.vy} ground=${t.g} state=${t.st} fade=${t.fade}`);
}
const st = Math.floor(maxX / TS);
for (let ty = Math.max(0, L.surfaceY[st] - 6); ty < Math.min(L.th, L.surfaceY[st] + 3); ty++) {
  let line = '';
  for (let tx = st - 4; tx <= st + 8; tx++) line += L.isSolid(tx, ty) ? '#' : '.';
  console.log(String(ty).padStart(2) + ' ' + line);
}
