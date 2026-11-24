// Boots the *real* browser entry point (src/main.js) against a minimal DOM stub.
// This is the only path that cannot be covered by the headless game harness, so
// it gets its own check: if boot() throws or no pixels get drawn, the shipped
// index.html is broken even though every module loads.
import { ROOT } from './harness.mjs';
import { savePNG } from './png.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.files.filter((f) => fs.existsSync(path.join(ROOT, f)));

function makeCanvas(w, h) {
  const canvas = {
    width: w, height: h,
    style: {},
    _pixels: new Uint8ClampedArray(w * h * 4),
    _draws: 0,
    getContext() {
      return {
        imageSmoothingEnabled: true,
        fillStyle: '#000',
        createImageData(cw, ch) {
          return { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
        },
        putImageData(img) {
          canvas._lastImage = img;
        },
        drawImage(src) {
          canvas._draws++;
          if (src && src._lastImage) canvas._lastImage = src._lastImage;
        },
        fillRect() {}, clearRect() {},
      };
    },
    addEventListener() {}, removeEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
    focus() {},
  };
  return canvas;
}

const screen = makeCanvas(1440, 810);
const listeners = {};
const rafQueue = [];

const sandbox = {
  console, Math, JSON, Date, Object, Array, Number, String, Boolean, Error, TypeError,
  isNaN, isFinite, parseInt, parseFloat, Map, Set, Promise, setTimeout, clearTimeout,
  Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array, Float32Array, Float64Array, ArrayBuffer,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.performance = { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 };
sandbox.navigator = { userAgent: 'node-qa (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0, getGamepads: () => [] };
sandbox.innerWidth = 1440;
sandbox.innerHeight = 810;
sandbox.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
sandbox.removeEventListener = () => {};
sandbox.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
sandbox.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
})();
sandbox.document = {
  readyState: 'complete',
  hidden: false,
  getElementById: (id) => (id === 'screen' ? screen : { classList: { add() {}, remove() {} }, textContent: '' }),
  createElement: (tag) => (tag === 'canvas' ? makeCanvas(480, 270) : {}),
  addEventListener: sandbox.addEventListener,
  body: { appendChild() {} },
};
sandbox.AudioContext = undefined;   // 无音频环境的降级路径也要能跑

const ctx = vm.createContext(sandbox);
for (const rel of files) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try {
    vm.runInContext(code, ctx, { filename: rel });
  } catch (e) {
    console.error(`[boot] failed loading ${rel}`);
    throw e;
  }
}

if (!sandbox.CT || !sandbox.CT._debug) throw new Error('boot: CT._debug missing — main.js did not initialise');
const dbg = sandbox.CT._debug;

// drive a few frames through the real rAF loop
let frames = 0;
for (let i = 0; i < 5; i++) {
  const fn = rafQueue.shift();
  if (!fn) break;
  fn(1000 + i * 16.7);
  frames++;
}
console.log(`boot ok: ${files.length} scripts, ${frames} rAF frames, offscreen drawImage calls=${screen._draws}`);

// the framebuffer must contain more than one colour, otherwise nothing rendered
const fb = dbg.fb;
const colours = new Set();
for (let i = 0; i < fb.data.length; i += 7) colours.add(fb.data[i]);
console.log(`framebuffer colours sampled: ${colours.size}`);
if (colours.size < 3) throw new Error('boot: framebuffer appears blank');

const outDir = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(outDir, { recursive: true });
savePNG(path.join(outDir, '20-boot.png'), fb.data, 480, 270, 3);

// exercise the debug entry points the README tells people to use
dbg.startAt('cloud-02');
dbg.stepOnce(120);
dbg.game.render();
savePNG(path.join(outDir, '21-boot-play.png'), fb.data, 480, 270, 3);
console.log('debug.startAt + stepOnce ok');
