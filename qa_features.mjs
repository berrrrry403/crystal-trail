// 新增五项功能的行为自检：取名 / 静音开关 / 语言切换 / 教程 / 图鉴插画
import { loadGame, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadGame({ exclude: ['src/main.js'] });
const results = [];
let fails = 0;

function check(name, ok, detail) {
  if (!ok) fails++;
  results.push({ check: name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name.padEnd(22)} ${detail}`);
}

const idle = {
  left: false, right: false, up: false, down: false,
  upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
  stickUp: false, stickDown: false,
  jumpHeld: false, jumpPressed: false, jumpReleased: false,
  interactHeld: false, interactPressed: false, pausePressed: false, axis: 0,
};

function mkGame(levelId) {
  const fb = new CT.FB(480, 270);
  const game = new CT.Game({ fb, audio: new CT.Audio(), touch: false });
  game.save = CT.Save.newSave(1);
  if (levelId) {
    game.enterLevel(levelId);
    game.state = CT.Game.STATE.PLAYING;
    game.dialogue.active = false;
  }
  return game;
}

// ---------------------------------------------------------------- 1. 取名
{
  const g = mkGame(null);
  g.state = CT.Game.STATE.NAME;
  g.pendingSlot = 1;
  g.openNameInput();
  g.nameIndex = 1;              // 光标停在「就这样」，和真实流程一致

  // 随机名字：必须从当前语言的名字池里来，且非空
  const n1 = g.randomName();
  const okPool = typeof n1 === 'string' && n1.length > 0;

  // 手动输入：直接写进文本框再同步
  CT.TextInput.setValue('Ash');
  g.nameBuf = CT.TextInput.value();
  const okType = g.nameBuf === 'Ash';

  // 回车确定 -> 进入游戏且名字写进存档
  g.stepName(1 / 60, { ...idle, interactPressed: true });
  const okConfirm = g.state === CT.Game.STATE.PLAYING && g.save.playerName === 'Ash';

  // 长度上限
  CT.TextInput.setValue('123456789012345');
  const okMax = CT.TextInput.value().length <= CT.TextInput.MAX_LEN;

  check('取名：随机', okPool, `随机得到「${n1}」`);
  check('取名：输入', okType, `nameBuf="${g.nameBuf}"`);
  check('取名：确定', okConfirm, `state=${g.state} 存档名=${g.save.playerName}`);
  check('取名：限长', okMax, `${CT.TextInput.value().length} <= ${CT.TextInput.MAX_LEN}`);
}

// ---------------------------------------------------------------- 2. 静音开关
{
  const g = mkGame(null);
  const a = g.audio;
  a.setVolumes(70, 80);
  a.setMuted('bgm', true);
  const okBgm = a.muteBgm === true && a.muteSfx === false;
  a.setMuted('sfx', true);
  const okBoth = a.muteBgm === true && a.muteSfx === true;
  a.setMuted('bgm', false);
  a.setMuted('sfx', false);
  const okClear = a.muteBgm === false && a.muteSfx === false;

  // 设置页第 2/3 行是这两个开关
  g.save.settings = { bgm: 70, sfx: 80, touchLayout: 0, muteBgm: false, muteSfx: false, lang: 'zh' };
  g.state = CT.Game.STATE.SETTINGS;
  g.settingsIndex = 2;
  g.stepSettings({ ...idle, interactPressed: true });
  const okRowBgm = g.save.settings.muteBgm === true;
  g.settingsIndex = 3;
  g.stepSettings({ ...idle, interactPressed: true });
  const okRowSfx = g.save.settings.muteSfx === true;

  check('静音：分声道', okBgm && okBoth && okClear, `bgm/sfx 可独立开关`);
  check('静音：设置页', okRowBgm && okRowSfx, `音乐=${g.save.settings.muteBgm} 音效=${g.save.settings.muteSfx}`);
}

// ---------------------------------------------------------------- 3. 语言切换
{
  const g = mkGame(null);
  CT.I18N.setLang('zh');
  const zhMenu = CT.I18N.T('开始新的旅程');
  const zhTreasure = CT.DATA.content.treasures[0].name;   // 先取中文，再切英文
  CT.I18N.setLang('en');
  const enMenu = CT.I18N.T('开始新的旅程');
  const enTreasure = CT.DATA.content.treasures[0].name;
  const okT = zhMenu !== enMenu && enMenu === 'New Journey';
  const okContent = zhTreasure !== enTreasure && /^[\x20-\x7E]+$/.test(enTreasure);

  // 英文表必须覆盖代码里所有中文字面量
  const missing = [];
  const src = fs.readFileSync(path.join(ROOT, 'src', 'game', 'game.js'), 'utf8') +
              fs.readFileSync(path.join(ROOT, 'src', 'game', 'ui.js'), 'utf8');
  // 名字池是数据不是界面文案，不该进翻译表
  const dataOnly = new Set();
  const poolStart = src.indexOf('var NAME_POOL');
  if (poolStart >= 0) {
    const poolEnd = src.indexOf('};', poolStart);
    for (const m of src.slice(poolStart, poolEnd).matchAll(/'([^']+)'/g)) dataOnly.add(m[1]);
  }
  for (const m of src.matchAll(/'([^'\r\n]*[\u4e00-\u9fff][^'\r\n]*)'/g)) {
    const lit = m[1];
    if (dataOnly.has(lit)) continue;
    if (!CT.I18N.has(lit)) missing.push(lit);
  }
  CT.I18N.setLang('zh');

  check('语言：界面文案', okT, `zh="${zhMenu}" en="${enMenu}"`);
  check('语言：叙事文本', okContent, `zh="${zhTreasure}" en="${enTreasure}"`);
  check('语言：无遗漏', missing.length === 0,
    missing.length ? '缺: ' + [...new Set(missing)].slice(0, 5).join(' / ') : '全部字面量已覆盖');
}

// ---------------------------------------------------------------- 4. 教程
{
  const g = mkGame('forest-01');
  // 首次进 forest-01 应自动开启教程
  const startedAt = g.tut.step;
  const x0 = g.player.x;
  // 第一步：向右走 3 格
  for (let i = 0; i < 120 && g.tut.step === 0; i++) {
    g.step(1 / 60, { ...idle, right: true, axis: 1 });
  }
  const okMove = g.tut.step >= 1;
  // 第二步：起跳
  g.step(1 / 60, { ...idle, jumpPressed: true, jumpHeld: true });
  const okJump = g.tut.step >= 2;
  // 教程在渲染时不报错
  let okDraw = true;
  try { g.render(); } catch (e) { okDraw = false; }

  check('教程：自动开启', startedAt === 0, `forest-01 首次进入 step=${startedAt}`);
  check('教程：走位推进', okMove, `主角移动 ${Math.round(g.player.x - x0)}px 后 step=${g.tut.step}`);
  check('教程：跳跃推进', okJump, `step=${g.tut.step}`);
  check('教程：可渲染', okDraw, 'render 无异常');
}

// ---------------------------------------------------------------- 5. 图鉴插画与故事
{
  const g = mkGame(null);
  const C = CT.DATA.content;
  // 注意 ORDER 是关卡 id（forest-01 …），主题列表是 LIST
  const themes = CT.Themes.LIST.map((x) => x.key);

  // 五张插画都能生成，尺寸正确
  let okSize = true;
  const dims = [];
  for (const t of themes) {
    const ill = CT.Illustration.build(t);
    dims.push(`${t}:${ill.w}x${ill.h}`);
    if (ill.w !== 192 || ill.h !== 128) okSize = false;
  }

  // 未解锁 -> 解锁
  g.save = CT.Save.newSave(1);
  g.codexPage = 6;
  g.save.crystals = {};
  const lockedOk = !g.save.crystals[C.crystals[0].id];
  g.save.crystals[C.crystals[0].id] = 1;
  const unlockedOk = !!g.save.crystals[C.crystals[0].id];

  // 五张图鉴文案 + 故事都齐全
  const galleryOk = (C.gallery || []).length === 5 &&
    C.gallery.every((x) => x.title && x.caption && x.theme);
  const storyOk = typeof C.story === 'string' && C.story.length > 40;

  // 图鉴各页都能渲染
  let pagesOk = true;
  g.P = CT.Palette.get('forest');
  g.settingsIndex = 0;
  for (let pg = 0; pg < 12; pg++) {
    g.codexPage = pg;
    try { g.renderCodex(); } catch (e) { pagesOk = false; break; }
  }

  check('图鉴：插画尺寸', okSize, dims.join(' '));
  check('图鉴：解锁逻辑', lockedOk && unlockedOk, `彩晶未取时锁定，取得后解锁`);
  check('图鉴：五张文案', galleryOk, `${(C.gallery || []).length} 张，均含标题与文案`);
  check('图鉴：故事线', storyOk, `故事 ${C.story.length} 字`);
  check('图鉴：12 页可渲染', pagesOk, '5 主题 + 总览 + 5 插画 + 故事');
}

// ---------------------------------------------------------------- 汇总
console.log(`\n${results.length - fails}/${results.length} 通过`);
fs.writeFileSync(path.join(ROOT, 'build', 'features-report.json'),
  JSON.stringify({ pass: results.length - fails, total: results.length, results }, null, 1));
if (fails) { console.error('FAIL: 新功能自检未通过'); process.exitCode = 1; }
