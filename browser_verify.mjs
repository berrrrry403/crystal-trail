// 真实浏览器端验证（CDP 驱动 Edge）
// ---------------------------------------------------------------------------
// 与 tools/qa_boot.mjs 的 DOM 桩不同，这里跑的是真正的 Chromium 引擎：
//   · 真实 canvas 2D / ImageData / drawImage
//   · 真实 requestAnimationFrame 与帧率
//   · 真实键盘事件（通过 CDP Input.dispatchKeyEvent）
//   · 真实 localStorage
// 因此它回答的是「网页端到底能不能跑」，而不是「模块能不能加载」。
//
// 用法: node tools/browser_verify.mjs [--headed] [--keep]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error('未找到 Edge/Chrome');
  process.exit(2);
}

const HEADED = process.argv.includes('--headed');
const PORT = 9333;
const PROFILE = path.join(ROOT, 'build', 'browser-profile');
const QA = path.join(ROOT, 'build', 'qa');
fs.mkdirSync(QA, { recursive: true });
fs.mkdirSync(PROFILE, { recursive: true });

// 默认用 file:// 直接验证交付物；加 --url 可以改测本地服务器地址
const urlArg = (() => {
  const i = process.argv.indexOf('--url');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();
const pageUrl = urlArg || ('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/'));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name.padEnd(24)} ${detail}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ 启动
const args = [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-features=Translate,MediaRouter',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,810',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
];
if (!HEADED) args.unshift('--headless=new');
args.push(pageUrl);

const proc = spawn(EDGE, args, { stdio: 'ignore', detached: false });
const cleanup = () => { try { proc.kill(); } catch { /* 已退出 */ } };
process.on('exit', cleanup);

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('DevTools 端口没有起来');
}

async function pageTarget() {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const t = list.find((x) => x.type === 'page' && x.url.startsWith('file://'))
           || list.find((x) => x.type === 'page' && x.url.startsWith('http://127.0.0.1:'));
    if (t && t.webSocketDebuggerUrl) return t;
    await sleep(250);
  }
  throw new Error('没有找到页面 target');
}

// -------------------------------------------------------------- CDP 客户端
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 30000);
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) throw new Error('页面内异常: ' + (r.exceptionDetails.text || ''));
    return r.result.value;
  }
  async key(type, code, key, vk) {
    await this.send('Input.dispatchKeyEvent', {
      type, code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(QA, file), Buffer.from(r.data, 'base64'));
    return path.join(QA, file);
  }
}

// ------------------------------------------------------------------ 主流程
(async () => {
  const ver = await waitForDevtools();
  console.log(`浏览器: ${ver.Browser}\n`);

  const target = await pageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');

  await cdp.send('Page.navigate', { url: pageUrl });
  await sleep(2500);

  // ---- 1. 启动无错
  const bootHidden = await cdp.eval(`document.getElementById('boot').classList.contains('hidden')`);
  const title = await cdp.eval(`document.title`);
  record('页面启动', bootHidden === true, `#boot 已隐藏=${bootHidden}  title="${title}"`);

  const errs = cdp.events.filter((e) =>
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
    e.method === 'Runtime.exceptionThrown');
  record('控制台无报错', errs.length === 0,
    errs.length ? JSON.stringify(errs.slice(0, 3).map((e) => e.params.entry ? e.params.entry.text : 'exception')) : '0 条 error/exception');

  // ---- 2. 调试钩子与画布
  // 菜单界面截图：验证「设计板居中」是否生效（宽窗口下最容易看出偏）
  await sleep(600);
  await cdp.shot('40-menu-title.png');
  await cdp.eval(`(function(){var g=__CRYSTAL_TRAIL__.game; g.state=CT.Game.STATE.SETTINGS; g.render();})()`);
  await sleep(250);
  await cdp.shot('41-menu-settings.png');
  await cdp.eval(`(function(){var g=__CRYSTAL_TRAIL__.game; g.state=CT.Game.STATE.SLOTS; g.slotMode='load'; g.render();})()`);
  await sleep(250);
  await cdp.shot('42-menu-slots.png');
  await cdp.eval(`(function(){var g=__CRYSTAL_TRAIL__.game; g.state=CT.Game.STATE.TITLE; g.render();})()`);
  await sleep(200);

  const dbg = await cdp.eval(`typeof window.__CRYSTAL_TRAIL__ === 'object'`);
  const canvas = await cdp.eval(`(function(){var c=document.getElementById('screen');return c.width+'x'+c.height;})()`);
  record('调试钩子 + 画布', dbg === true, `__CRYSTAL_TRAIL__=${dbg}  canvas=${canvas}`);

  // ---- 3. localStorage 可用性（file:// 下可能被禁）
  const storage = await cdp.eval(`(function(){
    try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return 'ok'; }
    catch(e) { return 'blocked: ' + e.name; }
  })()`);
  record('localStorage', storage === 'ok', String(storage));

  // ---- 4. 真实键盘：空格两次进入游戏
  // 标题 -> 存档位（空格）-> 取名页（空格）-> 确定（回车）
  for (let i = 0; i < 2; i++) {
    await cdp.key('keyDown', 'Space', ' ', 32);
    await cdp.key('keyUp', 'Space', ' ', 32);
    await sleep(420);
  }
  // 先截一张取名页，再确认进入游戏
  await cdp.shot('36-name.png');
  const nameState = await cdp.eval(`(function(){
    var g = __CRYSTAL_TRAIL__.game;
    return g.state + '|' + (g.nameBuf || '');
  })()`);
  record('取名页', String(nameState).startsWith('name|') && String(nameState).length > 6,
    `state|预填名字 = ${nameState}`);

  await cdp.key('keyDown', 'Enter', 'Enter', 13);
  await cdp.key('keyUp', 'Enter', 'Enter', 13);
  await sleep(600);
  const state = await cdp.eval(`__CRYSTAL_TRAIL__.game.state`);
  record('键盘进入游戏', state === 'playing', `state=${state}`);

  await cdp.shot('33-browser-title.png');

  // 进关开场会弹「云絮信使」区域介绍，对话期间主角本就不该能动。
  // 介绍现在是分页的（60~100 字两行装不下），所以一直按到关闭为止。
  const dlgBefore = await cdp.eval(`__CRYSTAL_TRAIL__.game.dialogue.active`);
  let presses = 0;
  for (let i = 0; i < 16; i++) {
    if (!(await cdp.eval(`__CRYSTAL_TRAIL__.game.dialogue.active`))) break;
    await cdp.key('keyDown', 'Enter', 'Enter', 13);
    await cdp.key('keyUp', 'Enter', 'Enter', 13);
    presses++;
    await sleep(150);
  }
  const dlgAfter = await cdp.eval(`__CRYSTAL_TRAIL__.game.dialogue.active`);
  const dlgInfo = await cdp.eval(`(function(){
    var g = __CRYSTAL_TRAIL__.game, d = g.dialogue;
    return 'page=' + d.pageIdx + '/' + d.pages.length + ' revealed=' + d.revealed +
      '/' + (d.curLen ? d.curLen() : -1) + ' textInput=' + (CT.TextInput ? CT.TextInput.active : 'n/a') +
      ' tut=' + (g.tut ? g.tut.active : 'n/a') + ' state=' + g.state;
  })()`);
  record('对话锁移动', dlgBefore === true && dlgAfter === false && presses > 0,
    `开场对话激活=${dlgBefore} 按${presses}次后关闭=${dlgAfter} | ${dlgInfo}`);

  // ---- 4b. 首次出现说明条（hud_treasure 应当浮出来）
  await sleep(400);
  const toast = await cdp.eval(`(function(){
    var g = __CRYSTAL_TRAIL__.game;
    g.render();
    return g.glossaryToast ? (g.glossaryToast.name + '|' + g.glossaryToast.desc) : 'none';
  })()`);
  record('首次出现说明', toast !== 'none', String(toast));
  await cdp.shot('35-glossary.png');

  // ---- 5. 按住右方向键，确认真的能走
  const x0 = await cdp.eval(`__CRYSTAL_TRAIL__.game.player.x`);
  await cdp.key('keyDown', 'ArrowRight', 'ArrowRight', 39);
  await sleep(1400);
  await cdp.key('keyUp', 'ArrowRight', 'ArrowRight', 39);
  await sleep(150);
  const x1 = await cdp.eval(`__CRYSTAL_TRAIL__.game.player.x`);
  const moved = Math.round(x1 - x0);
  record('按键驱动移动', moved > 60, `主角位移 ${moved} px`);

  // ---- 6. 真实帧率（1.5 秒内 rAF 回调次数）
  const fps = await cdp.eval(`new Promise(function(res){
    var n = 0, t0 = performance.now();
    function tick(){ n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now()-t0)/1000))); }
    requestAnimationFrame(tick);
  })`, true);
  record('rAF 吞吐', fps >= 55, `${fps} 次/秒（无头环境不与 vsync 同步，真实窗口为 60）`);

  // ---- 7. 单帧渲染耗时（页面内实测）
  const frameMs = await cdp.eval(`(function(){
    var g = __CRYSTAL_TRAIL__.game;
    var t0 = performance.now();
    for (var i = 0; i < 120; i++) { g.step(1/60, __CRYSTAL_TRAIL__.lastInput || {axis:0,left:false,right:false,up:false,down:false,upPressed:false,downPressed:false,leftPressed:false,rightPressed:false,stickUp:false,stickDown:false,jumpHeld:false,jumpPressed:false,jumpReleased:false,interactHeld:false,interactPressed:false,pausePressed:false}); g.render(); }
    return +((performance.now() - t0) / 120).toFixed(3);
  })()`);
  record('单帧耗时', frameMs < 16.67, `${frameMs} ms（预算 16.67）`);

  // ---- 8. 玩法画面截图
  await cdp.eval(`__CRYSTAL_TRAIL__.game.dialogue.active = false; __CRYSTAL_TRAIL__.game.render();`);
  await sleep(120);
  await cdp.shot('34-browser-play.png');

  // ---- 9. 存档落盘
  const saved = await cdp.eval(`(function(){
    try { var k = Object.keys(localStorage).filter(function(x){ return x.indexOf('crystalTrail.save') === 0; });
      return k.length ? k.join(',') : 'none'; } catch(e) { return 'err'; }
  })()`);
  record('存档写入', saved !== 'none' && saved !== 'err', `key: ${saved}`);

  // ---- 9b. 掉进坑里必须复活（复现用户截图：卡在坑底）
  const pitRes = await cdp.eval(`new Promise(function(res){
    var g = __CRYSTAL_TRAIL__.game;
    var L = g.level;
    if (!L) { res('no level loaded'); return; }
    var pit = -1;
    for (var x = 2; x < L.tw - 2; x++) { if (L.surfaceY[x] < 0) { pit = x; break; } }
    if (pit < 0) { res('no pit in this level'); return; }
    var before = g.lives;
    g.invuln = 0;
    g.player.reset(pit * 16 + 5, 40);
    var n = 0;
    function tick(){
      n++;
      if (g.lives < before) {
        var atSpawn = Math.abs(g.player.x - g.respawn.x) < 2;
        res('OK lives ' + before + '->' + g.lives + ' after ' + n + ' frames, back=' + atSpawn);
        return;
      }
      if (n > 60 * 10) { res('STUCK lives=' + g.lives + ' y=' + Math.round(g.player.y) + '/' + L.pxH); return; }
      requestAnimationFrame(tick);
    }
    tick();
  })`, true);
  record('坑底必复活', String(pitRes).startsWith('OK'), String(pitRes));

  // ---- 9c. 图鉴的旅途留影页（给一枚彩晶后应当显示插画）
  await cdp.eval(`(function(){
    var g = __CRYSTAL_TRAIL__.game;
    g.save.crystals = g.save.crystals || {};
    var cid = CT.Themes.LIST[0].crystal;    // 形如 crystal-forest
    g.save.crystals[cid] = 1;
    g.state = CT.Game.STATE.CODEX;
    g.codexPage = 6;
    g.render();
  })()`);
  await sleep(300);
  await cdp.shot('37-gallery.png');
  record('图鉴插画页', true, 'codexPage=6 已渲染并截图');

  // ---- 10. 触屏控件布局能画出来（安卓端的核心）
  const touchInfo = await cdp.eval(`(function(){
    var g = __CRYSTAL_TRAIL__.game;
    g.touchActive = true;
    g.render();
    g.touchActive = false;
    return 'ok';
  })()`);
  record('触屏控件渲染', touchInfo === 'ok', 'drawTouch 无异常');

  ws.close();
  cleanup();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 项通过`);
  if (failed) {
    const late = cdp.events.filter((e) =>
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
      e.method === 'Runtime.exceptionThrown');
    console.log(`\n=== 运行期异常 ${late.length} 条 ===`);
    for (const e of late.slice(0, 6)) {
      if (e.params.entry) console.log('  [log]', e.params.entry.text);
      else {
        const d = e.params.exceptionDetails;
        const desc = d.exception && d.exception.description
          ? String(d.exception.description).split('\n').slice(0, 4).join(' / ') : '';
        console.log('  [exception]', d.text, '|', desc);
      }
    }
  }
  fs.writeFileSync(path.join(ROOT, 'build', 'browser-report.json'),
    JSON.stringify({ browser: ver.Browser, results }, null, 1));
  console.log('截图: build/qa/33-browser-title.png, 34-browser-play.png');
  if (failed) process.exitCode = 1;
})().catch((e) => {
  console.error('验证失败:', e.message);
  cleanup();
  process.exit(1);
});
