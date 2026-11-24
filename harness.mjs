// Headless harness: runs the *unmodified* browser source inside a bare V8
// context so the QA renderer draws through exactly the same code path the
// player sees. No DOM shims are provided on purpose — if a module needs the
// DOM it cannot be verified here, so art/physics code must stay DOM-free.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function manifest() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  return m.files.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

export function loadGame(opts = {}) {
  const exclude = opts.exclude || [];
  const files = (opts.files || manifest()).filter((f) => exclude.indexOf(f) < 0);
  const sandbox = {
    console,
    Math,
    JSON,
    Date,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Error,
    TypeError,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    Uint8Array,
    Uint8ClampedArray,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    Map,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.performance = { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 };
  sandbox.navigator = { userAgent: 'node-qa', maxTouchPoints: 0 };
  if (opts.extra) Object.assign(sandbox, opts.extra);

  const ctx = vm.createContext(sandbox);
  for (const rel of files) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    try {
      vm.runInContext(code, ctx, { filename: rel });
    } catch (e) {
      console.error(`\n[harness] FAILED loading ${rel}\n`, e);
      throw e;
    }
  }
  if (!sandbox.CT) throw new Error('harness: window.CT was never created');
  return sandbox.CT;
}

// Load selected files only (for unit-testing a single module early on).
export function loadPartial(rels, extra) {
  return loadGame({ files: rels, extra });
}
