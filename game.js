/* 晶途拾光 — 游戏主逻辑
 * --------------------------------------------------------------------------
 * 串起全部子系统：状态机（标题 / 存档槽 / 游戏中 / 暂停 / 图鉴 / 设置 /
 * 结算）、世界渲染顺序、交互与收集、快速复位、关卡流转。
 *
 * 几个容易踩坑的规格点都在这里落地：
 *   §4.4 掉出关卡边界、进入无法脱离的角落 → 0.3 秒淡出快速复位，
 *        保留已收集宝物与已解机关状态
 *   §4.6 交互键统一为一个，靠近可交互物 24 像素内出现向上箭头气泡
 *   §5.4 可交互前景以 1 像素抖动轻微摆动（0.5 Hz，幅度不超过 2 像素）
 *   §4.2 拾取表现：局部像素闪光 + 短促拾取音
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var G = CT.Palette.G;
  var gc = CT.Palette.gc;
  var T = CT.I18N.T;      // 界面文案查表（中文字面量做键）
  // 逻辑分辨率跟随窗口（见 src/core/view.js）。保持不变量的写法，
  // 只在每次 render/step 开头同步一次，函数内部读到的就是最新值。
  var VW = 480, VH = 270;
  function syncView() {
    if (!CT.View) return;
    VW = CT.View.VW;
    VH = CT.View.VH;
  }
  var TS = 16;

  var STATE = {
    TITLE: 'title', SLOTS: 'slots', PLAYING: 'playing', PAUSED: 'paused',
    CODEX: 'codex', SETTINGS: 'settings', CLEAR: 'clear', ENDING: 'ending',
    NAME: 'name',
  };

  function Game(opts) {
    this.fb = opts.fb || new CT.FB(VW, VH);
    this.audio = opts.audio || new CT.Audio();
    this.particles = new CT.Particles();
    this.camera = new CT.Camera();
    this.dialogue = new CT.Dialogue();
    this.player = new CT.Player();
    this.time = 0;
    this.state = STATE.TITLE;
    this.touchActive = opts.touch || false;
    this.layoutIdx = 0;
    this.fade = 0;              // 受伤/复位的视觉过渡量 0..1（只做叠加，不冻结）
    this.fadeDir = 0;
    this.maxLives = 3;          // 一局三条命
    this.lives = 3;
    this.invuln = 0;            // 复活后的无敌时间，避免刚落地又被撞
    this.hurtFx = 0;            // 受伤闪屏计时
    this.msg = null;            // 顶部临时提示
    this.msgTimer = 0;

    this.titleIndex = 0;
    this.slotIndex = 0;
    this.pauseIndex = 0;
    this.codexPage = 0;
    this.codexTheme = 0;
    this.settingsIndex = 0;
    this.nameBuf = '';           // 名字输入的缓冲
    this.nameDice = 0;           // 骰子按钮的冷却/动画
    this.nameIndex = 0;          // 0=输入框 1=骰子 2=确定 3=返回
    this.clearTimer = 0;

    this.save = null;
    this.level = null;
    this.mech = null;
    this.themeKey = 'forest';
    this.themeCfg = null;
    this.bg = null;
    this.P = CT.Palette.get('forest');
    this.heroSprites = null;
    this.collected = {};
    this.respawn = { x: 0, y: 0 };
    this.levelTreasures = [];
    this.levelNpcs = [];
    this.levelDecor = [];
    this.talkNpc = null;
    this.checkpointTaken = false;
    this.tutorialShown = {};
    this.interactTarget = null;
    this.glossaryToast = null;   // {name, desc, t}
    this.tut = { active: false, step: 0, x0: 0, holdT: 0, jumped: false };
    this.frames = 0;
    this.fpsAcc = 0; this.fpsCount = 0; this.fps = 60;
  }

  // ---------------------------------------------------------------- 存档
  Game.prototype.newGame = function (slot, playerName) {
    var s = CT.Save.newSave(slot);
    if (playerName) s.playerName = playerName;
    s.lang = CT.I18N.lang;
    if (!s.settings) s.settings = {};
    s.settings.lang = CT.I18N.lang;
    this.save = s;
    this.enterLevel('forest-01');
    CT.Save.save(slot, s);
    this.state = STATE.PLAYING;
  };

  Game.prototype.continueSlot = function (slot) {
    var s = CT.Save.load(slot);
    if (!s) return false;
    this.save = s;
    if (s.settings) {
      this.layoutIdx = s.settings.touchLayout || 0;
      this.audio.setVolumes(s.settings.bgm, s.settings.sfx);
      this.audio.setMuted('bgm', !!s.settings.muteBgm);
      this.audio.setMuted('sfx', !!s.settings.muteSfx);
      // 语言跟着存档走
      var lg = s.settings.lang || s.lang || 'zh';
      CT.I18N.setLang(lg);
    }
    this.collected = s.collected || {};
    this.enterLevel(s.level || 'forest-01');
    this.state = STATE.PLAYING;
    return true;
  };

  Game.prototype.persist = function (writeSlot) {
    if (!this.save) return;
    var slot = writeSlot === undefined ? this.save.slot : writeSlot;
    CT.Save.save(slot, this.save);
  };

  Game.prototype.autoSave = function () {
    if (!this.save) return;
    this.save.collected = this.collected;
    this.save.level = this.level.id;
    this.save.theme = this.themeKey;
    CT.Save.save(CT.Save.AUTO_SLOT, this.save);
  };

  // ---------------------------------------------------------------- 关卡
  Game.prototype.enterLevel = function (levelId) {
    var D = CT.DATA;
    var json = D.levels[levelId];
    if (!json) {
      // 兜底：数据缺失时现场生成，保证游戏永远可玩（§1.5 离线优先）
      json = CT.LevelGen.generate(levelId);
    }
    var info = CT.Themes.levelInfo(levelId);
    this.themeCfg = info ? info.theme : CT.Themes.get('forest');
    this.themeKey = json.theme || this.themeCfg.key;
    this.P = CT.Palette.get(this.themeKey);
    this.bg = CT.BG.build(this.themeKey);
    this.level = new CT.Level(json);
    this.heroSprites = CT.Sprites.buildHero(this.themeKey);
    this.particles.clear();
    this.particles.setTheme(this.themeKey, this.P);
    this.mech = new CT.MechWorld(this.level, this.themeKey, this.particles, this.audio);
    this.levelTreasures = json.treasures || [];
    this.levelNpcs = json.npcs || [];
    this.levelDecor = this.level.decor;
    this.collected = this.collected || {};
    this.lives = this.maxLives;
    this.invuln = 0;
    this.hurtFx = 0;
    this.checkpointTaken = false;
    this.tutorialShown = this.tutorialShown || {};

    var sp = json.spawn || [4, 4];
    this.respawn = { x: sp[0] * TS, y: sp[1] * TS };
    this.player.reset(this.respawn.x, this.respawn.y);
    this.camera.snapTo(this.player, this.level);
    this.dialogue.active = false;

    this.currentLevelId = levelId;

    // 第一关首次游玩时走一遍教程（提示按键，做完一步才推进）
    var firstTime = !(this.save && this.save.tutorialDone);
    this.tut.active = (levelId === 'forest-01' && firstTime);
    this.tut.step = 0;
    this.tut.x0 = this.player.x;
    this.tut.holdT = 0;
    this.tut.jumped = false;
    if (this.save) {
      this.save.level = levelId;
      this.save.theme = this.themeKey;
      this.autoSave();
    }
    if (this.audio) {
      this.audio.init();
      this.audio.playBgm(this.themeCfg.bgm || this.themeKey);
    }
    // 关卡开场：云絮信使的区域介绍（§2.4 进入阶段）
    var C = CT.DATA.content;
    var intro = C.intros.filter(function (i) { return i.theme === json.theme; })[0];
    if (intro && !(this.tutorialShown['intro_' + levelId])) {
      this.tutorialShown['intro_' + levelId] = 1;
      // 用 openText 而不是 wrapLines：区域介绍是 60~100 字，两行装不下，
      // wrapLines 只取前两行会把后面的内容整段截掉。openText 会自动分页。
      this.dialogue.openText(intro.npc, intro.intro, null);
    }
  };

  Game.prototype.showMsg = function (text, dur) {
    this.msg = text;
    this.msgTimer = dur || 2.0;
  };

  // ---------------------------------------------------------------- 更新
  Game.prototype.step = function (dt, input) {
    syncView();
    this.time += dt;
    this.frames++;
    this.fpsAcc += dt; this.fpsCount++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsCount / this.fpsAcc);
      this.fpsAcc = 0; this.fpsCount = 0;
    }

    switch (this.state) {
      case STATE.TITLE: this.stepTitle(input); break;
      case STATE.SLOTS: this.stepSlots(input); break;
      case STATE.PLAYING: this.stepPlaying(dt, input); break;
      case STATE.PAUSED: this.stepPaused(input); break;
      case STATE.CODEX: this.stepCodex(input); break;
      case STATE.SETTINGS: this.stepSettings(input); break;
      case STATE.CLEAR: this.stepClear(dt, input); break;
      case STATE.ENDING: this.stepEnding(input); break;
      case STATE.NAME: this.stepName(dt, input); break;
    }

    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg = null;
    }
    if (this.audio) this.audio.tick();
  };

  function menuMove(input, cur, count) {
    if (input.upPressed) return (cur + count - 1) % count;
    if (input.downPressed) return (cur + 1) % count;
    return cur;
  }

  // 菜单用的上下边沿（键盘方向键 / 摇杆 / 手柄）
  function edgeUp(input) { return input.upPressed || input.stickUp; }

  Game.prototype.stepTitle = function (input) {
    var count = 4;
    if (input.upPressed || input.stickUp) { this.titleIndex = (this.titleIndex + count - 1) % count; this.audio.sfx('cursor'); }
    if (input.downPressed || input.stickDown) { this.titleIndex = (this.titleIndex + 1) % count; this.audio.sfx('cursor'); }
    if (input.interactPressed || input.jumpPressed) {
      this.audio.resume();
      this.audio.sfx('confirm');
      if (this.titleIndex === 0) { this.slotIndex = 0; this.slotMode = 'new'; this.state = STATE.SLOTS; }
      else if (this.titleIndex === 1) { this.slotIndex = 0; this.slotMode = 'load'; this.state = STATE.SLOTS; }
      else if (this.titleIndex === 2) { this.state = STATE.CODEX; this.codexPage = 0; }
      else { this.state = STATE.SETTINGS; }
    }
  };

  Game.prototype.stepSlots = function (input) {
    var list = CT.Save.list();          // 3 槽 + 自动
    var count = list.length;
    if (input.upPressed || input.stickUp) { this.slotIndex = (this.slotIndex + count - 1) % count; this.audio.sfx('cursor'); }
    if (input.downPressed || input.stickDown) { this.slotIndex = (this.slotIndex + 1) % count; this.audio.sfx('cursor'); }
    if (input.pausePressed) { this.state = STATE.TITLE; this.audio.sfx('back'); return; }
    if (input.interactPressed || input.jumpPressed) {
      var slot = this.slotIndex < 3 ? this.slotIndex + 1 : CT.Save.AUTO_SLOT;
      this.audio.resume();
      if (this.slotMode === 'new') {
        this.audio.sfx('confirm');
        // 新建存档先取名，名字确定后才真正开局
        this.pendingSlot = this.slotIndex < 3 ? this.slotIndex + 1 : 1;
        this.state = STATE.NAME;
        this.openNameInput();
        // 预填一个随机名字、光标停在「就这样」：想直接开就一路回车，
        // 想自己取就改文本框，想换一个就按「随机」。
        this.randomName();
        this.nameIndex = 1;
      } else {
        if (this.continueSlot(slot)) this.audio.sfx('confirm');
        else this.audio.sfx('back');
      }
    }
  };

  Game.prototype.stepPlaying = function (dt, input) {
    // 对话优先吃掉输入
    if (this.dialogue.active) {
      this.dialogue.update(dt, this.audio);
      this.player.updateAnim(dt, true, null);
      if (input.interactPressed || input.jumpPressed) this.dialogue.advance();
      return;
    }

    if (input.pausePressed) {
      this.state = STATE.PAUSED;
      this.pauseIndex = 0;
      this.audio.sfx('back');
      return;
    }

    // 受伤/复活不再冻结画面：复活是瞬时的，只叠一层很短的淡出做过渡。
    // （之前这里会 return，玩家会觉得「掉进沟里之后画面卡住了」。）
    if (this.hurtFx > 0) this.hurtFx = Math.max(0, this.hurtFx - dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    var p = this.player;
    var L = this.level;

    var landed = p.step(dt, L, input, this.mech);
    if (landed) this.mech.onPlayerLand(p);
    // 供装饰层判断要不要播放微动
    this.playerMoving = Math.abs(p.vx) > 6 || !p.onGround;

    this.mech.update(dt, p, this.collected);
    p.updateAnim(dt, false, null);

    // 掉出关卡边界 → 快速复位（§4.4）
    // 掉出关卡底部，或者（兜底）踩在关卡最低一行上，都按掉坑处理。
    // 正常地表最高只到 th-3，所以踩到 th-1/th-2 一定是掉进了坑。
    var belowLevel = p.y > L.pxH + 8;
    var onBottomRow = p.onGround && p.bottom() >= (L.th - 1) * 16;
    if (belowLevel || onBottomRow) this.loseLife('pit');

    // 镜头
    this.camera.update(dt, p, L);

    // 隐藏分支窥视（§4.6 镜头先向内偏移 32 像素做一次提示性窥视）
    for (var i = 0; i < this.levelDecor.length; i++) { /* 装饰不参与判定 */ }
    this.checkBranchPeek();

    // 宝物接触拾取（§3.2 拾取触发条件：接触宝物）
    this.checkHazards();
    this.checkTreasures();

    // 存档石碑
    this.checkCheckpoint();

    // 交互目标
    this.findInteractTarget();
    if (input.interactPressed && this.interactTarget) this.doInteract();

    // 出口
    this.checkExit();

    // 教程（只影响提示条的显示，不限制操作）
    this.updateTutorial(dt, input);

    // 首次出现的图标说明（不打断操作，只在顶部浮一条）
    this.checkGlossary(dt);

    // 粒子
    this.particles.ambientTick(dt, this.camera.renderX(), this.camera.renderY());
    this.particles.update(dt);
  };

  Game.prototype.doRespawn = function () {
    this.player.reset(this.respawn.x, this.respawn.y);
    this.camera.snapTo(this.player, this.level);
    // 复活后给 1 秒无敌，并让主角闪烁，避免「刚站起来又被同一个滚石撞死」
    this.invuln = 1.0;
    if (this.audio) this.audio.sfx('reset');
  };

  // 扣一条命。来源：掉出关卡边界、撞到滚石障碍物。
  Game.prototype.loseLife = function (reason) {
    if (this.invuln > 0) return;
    if (this.state !== STATE.PLAYING) return;
    this.lives--;
    this.hurtFx = 0.55;
    this.invuln = 1.0;
    if (this.audio) this.audio.sfx('reset');
    if (this.particles) {
      this.particles.sparkle(this.player.centreX(), this.player.y + this.player.h / 2, this.P.c[12]);
    }
    // 记一次失败，用于 §4.3 三级提示（3 次给第一级，6 次给第二级）
    this.pendingHint = this.mech.fail('reset:' + this.currentLevelId);

    if (this.lives <= 0) {
      this.restartLevel();
      return;
    }
    this.doRespawn();
    this.maybeShowHint();
  };

  // 三条命用完：本关从头再来（已收集的宝物保留，不做进度惩罚）
  Game.prototype.restartLevel = function () {
    var id = this.currentLevelId;
    var keep = this.collected;
    this.enterLevel(id);
    this.collected = keep;
    this.showMsg(T('力气用尽 · 本关重新开始'), 2.2);
    if (this.audio) this.audio.sfx('back');
  };

  // ---------------------------------------------------- 首次出现的图标说明
  // 规格书里每个物件都有自己的名字，但玩家第一次见到一个陌生图标时并没有
  // 任何提示。这里在物件第一次进入视野时浮一条一句话说明，只播一次，
  // 记录在存档里，不打断移动。
  Game.prototype.collectGlossaryCandidates = function () {
    var L = this.level, M = this.mech;
    var out = [];
    var px = this.player.centreX(), py = this.player.y;
    function push(key, x, y) {
      var dx = x - px, dy = y - py;
      var d2 = dx * dx + dy * dy;
      if (d2 < 190 * 190) out.push({ key: key, d2: d2 });
    }
    for (var i = 0; i < this.levelTreasures.length; i++) {
      var t = this.levelTreasures[i];
      if (this.collected[t.id]) continue;
      var key = t.kind === 'main' ? 'crystal' : (t.kind === 'mark' ? 'mark'
        : (t.kind === 'rune' ? 'rune' : 'treasure'));
      push(key, t.at[0] * 16 + 8, t.at[1] * 16 + 8);
    }
    if (L.checkpoint) push('checkpoint', L.checkpoint.at[0] * 16 + 8, L.checkpoint.at[1] * 16 + 16);
    if (L.exit) push('exit', L.exit.at[0] * 16 + 8, L.exit.at[1] * 16 + 16);
    for (var d = 0; d < M.doors.length; d++) push('door', M.doors[d].tx * 16 + 8, (M.doors[d].ty - 1) * 16 + 8);
    for (var p2 = 0; p2 < M.plates.length; p2++) push('pressure_switch', M.plates[p2].tx * 16 + 8, M.plates[p2].ty * 16 + 12);
    for (var q = 0; q < M.pads.length; q++) push('sequence_pads', M.pads[q].tx * 16 + 8, M.pads[q].ty * 16 + 12);
    for (var e = 0; e < M.emitters.length; e++) push('light_beam', M.emitters[e].tx * 16 + 8, M.emitters[e].ty * 16 + 8);
    for (var z = 0; z < M.zones.length; z++) push('wind', M.zones[z].x + M.zones[z].w / 2, M.zones[z].y + M.zones[z].h / 2);
    for (var v = 0; v < M.valves.length; v++) push('water_flow', M.valves[v].tx * 16 + 8, M.valves[v].ty * 16 + 12);
    for (var a = 0; a < M.altars.length; a++) push('rune_altar', M.altars[a].tx * 16 + 8, M.altars[a].ty * 16 + 8);
    for (var h = 0; h < M.hazards.length; h++) push('boulder', M.hazards[h].x + 7, M.hazards[h].y + 7);
    for (var n = 0; n < this.levelNpcs.length; n++) push('npc', this.levelNpcs[n].at[0] * 16 + 8, this.levelNpcs[n].at[1] * 16 + 8);
    return out;
  };

  Game.prototype.checkGlossary = function (dt) {
    if (this.glossaryToast) {
      this.glossaryToast.t -= dt;
      if (this.glossaryToast.t <= 0) this.glossaryToast = null;
    }
    if (!this.save) return;
    if (!this.save.glossary) this.save.glossary = {};
    if (this.glossaryToast) return;                    // 一次只浮一条

    var seen = this.save.glossary;
    var self2 = this;
    function pushToast(key) {
      var d0 = (CT.DATA.content.glossary || []).filter(function (g) { return g.key === key; })[0];
      if (!d0) return false;
      self2.save.glossary[key] = 1;
      self2.glossaryToast = { name: d0.name, desc: d0.desc, t: 4.0 };
      if (self2.audio) self2.audio.sfx('page');
      return true;
    }

    // 优先级最高的一条：右上角那块宝物计数牌。玩家最先看到的就是它，
    // 也最容易看不懂，所以进关后第一件事就解释它。
    if (!seen['hud_treasure'] && pushToast('hud_treasure')) return;

    var list = this.collectGlossaryCandidates();
    var best = null;
    for (var i = 0; i < list.length; i++) {
      if (seen[list[i].key]) continue;
      if (!best || list[i].d2 < best.d2) best = list[i];
    }
    if (!best) return;
    var data = (CT.DATA.content.glossary || []).filter(function (g) { return g.key === best.key; })[0];
    if (!data) return;
    seen[best.key] = 1;
    this.glossaryToast = { name: data.name, desc: data.desc, t: 4.0 };
    if (this.audio) this.audio.sfx('page');
  };

  Game.prototype.renderGlossaryToast = function () {
    var g = this.glossaryToast;
    if (!g) return;
    var fb = this.fb, P = this.P;
    var w = Math.max(CT.Font.measure(g.name), CT.Font.measure(g.desc)) + 18;
    var x = Math.round((VW - w) / 2);
    var y = 42;
    // 最后 0.6 秒用抖动淡出，保持调色板纯净
    var lv = g.t < 0.6 ? Math.max(1, Math.round((g.t / 0.6) * 16)) : 16;
    fb.fillRectDither(x, y, w, 30, gc(G.PANEL), lv);
    if (lv >= 12) {
      fb.rect(x, y, w, 30, gc(G.PANEL_HI));
      fb.fillRect(x + 2, y + 2, 4, 1, P.c[15]);
      fb.fillRect(x + 2, y + 2, 1, 4, P.c[15]);
      fb.fillRect(x + w - 6, y + 2, 4, 1, P.c[15]);
      fb.fillRect(x + w - 3, y + 2, 1, 4, P.c[15]);
    }
    CT.Font.draw(fb, g.name, x + 9, y + 4, P.c[15], { dither: lv });
    CT.Font.draw(fb, g.desc, x + 9, y + 17, gc(G.TEXT), { dither: lv });
  };

  // 滚石碰撞检测
  Game.prototype.checkHazards = function () {
    if (!this.mech.hazards.length) return;
    var p = this.player;
    for (var i = 0; i < this.mech.hazards.length; i++) {
      var h = this.mech.hazards[i];
      if (p.x < h.x + h.w - 2 && p.x + p.w > h.x + 2 &&
          p.y < h.y + h.h - 2 && p.y + p.h > h.y + 2) {
        this.loseLife('hazard');
        return;
      }
    }
  };

  // 提示文本来自构建期预生成的 hints（陈述句、单条不超过 20 字）
  Game.prototype.pickHintMech = function () {
    var kinds = (this.level.json && this.level.json.meta && this.level.json.meta.mechKinds) || [];
    return kinds.length ? kinds[0] : 'pressure_switch';
  };

  Game.prototype.maybeShowHint = function () {
    var lvl = this.pendingHint || 0;
    if (lvl <= 0) return;
    this.hintShown = this.hintShown || {};
    if (lvl <= (this.hintShown[this.currentLevelId] || 0)) return;
    var C = CT.DATA.content;
    var kind = this.pickHintMech();
    var h = C.hints.filter(function (x) { return x.mech === kind; })[0];
    if (!h || !h.levels || !h.levels.length) return;
    var text = h.levels[Math.min(lvl - 1, h.levels.length - 1)];
    this.hintShown[this.currentLevelId] = lvl;
    this.dialogue.open(T('提示'), CT.Dialogue.wrapLines(text), null, { style: 'hint' });
  };

  Game.prototype.checkBranchPeek = function () {
    // 分支平台在玩家上方且尚未看过时触发一次窥视
    if (!this.mech._peeked) this.mech._peeked = {};
    var mes = this.level.json && this.level.json.meta;
    if (!mes) return;
    var p = this.player;
    for (var i = 0; i < this.levelTreasures.length; i++) {
      var t = this.levelTreasures[i];
      if (!t.hidden) continue;
      if (this.collected[t.id]) continue;
      var tx = t.at[0] * TS;
      var ty = t.at[1] * TS;
      if (this.mech._peeked[t.id]) continue;
      var dx = tx - p.centreX();
      if (Math.abs(dx) < 72 && ty < p.y - 8) {
        this.mech._peeked[t.id] = 1;
        this.camera.startPeek(Math.max(-32, Math.min(32, dx)), -32);
        break;
      }
    }
  };

  Game.prototype.treasureBox = function (t) {
    var kind = t.kind;
    var w = kind === 'main' ? 16 : 12;
    var h = kind === 'main' ? 16 : 12;
    var cx = t.at[0] * TS + TS / 2;
    var cy = t.at[1] * TS + TS / 2;
    var bob = Math.round(Math.sin(this.time * 2 + t.at[0]) * 1.5);
    return { x: cx - w / 2, y: cy - h / 2 + bob, w: w, h: h };
  };

  Game.prototype.checkTreasures = function () {
    var p = this.player;
    var pb = { x: p.x, y: p.y, w: p.w, h: p.h };
    for (var i = 0; i < this.levelTreasures.length; i++) {
      var t = this.levelTreasures[i];
      if (this.collected[t.id]) continue;
      if (t.kind === 'rune') {
        // 符文碎片同样靠接触拾取
      }
      var b = this.treasureBox(t);
      if (pb.x < b.x + b.w && pb.x + pb.w > b.x && pb.y < b.y + b.h && pb.y + pb.h > b.y) {
        this.collect(t, b);
      }
    }
  };

  Game.prototype.collect = function (t, box) {
    var C = CT.DATA.content;
    var today = new Date();
    var ds = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    this.collected[t.id] = ds;
    this.player.pickupTimer = 0.4;
    this.audio.sfx('pickup');
    this.particles.sparkle(box.x + box.w / 2, box.y + box.h / 2, this.P.c[15]);

    if (t.kind === 'side') {
      var rec = C.treasures.filter(function (x) { return x.id === t.id; })[0];
      this.showMsg(T('拾得 ') + (rec ? rec.name : T('宝物')), 1.8);
    } else if (t.kind === 'main') {
      var cr = C.crystals.filter(function (x) { return x.id === t.id; })[0];
      this.save.crystals[t.id] = 1;
      this.showMsg(T('获得 ') + (cr ? cr.name : T('本源彩晶')), 2.6);
      this.audio.sfx('celebrate');
    } else if (t.kind === 'mark') {
      var mk = C.marks.filter(function (x) { return x.id === t.id; })[0];
      this.save.marks[t.id] = 1;
      this.showMsg(T('获得 ') + (mk ? mk.name : T('守护印记')), 2.4);
      this.audio.sfx('save_ok');
    } else if (t.kind === 'rune') {
      this.showMsg(T('拾得符文碎片'), 1.6);
    }
    if (this.save) { this.save.collected = this.collected; }
  };

  Game.prototype.checkCheckpoint = function () {
    var cp = this.level.checkpoint;
    if (!cp) return;
    var cx = cp.at[0] * TS + TS / 2;
    var p = this.player;
    if (Math.abs(p.centreX() - cx) < 20 && Math.abs(p.bottom() - cp.at[1] * TS) < 40) {
      if (!this.checkpointTaken) {
        this.checkpointTaken = true;
        this.respawn = { x: cp.respawn[0] * TS, y: cp.respawn[1] * TS };
        this.autoSave();
        this.audio.sfx('save_ok');
        this.showMsg(T('已在石碑旁留下记号'), 1.6);
      }
    }
  };

  Game.prototype.findInteractTarget = function () {
    var p = this.player;
    var best = null, bestD = 1e9;
    // §4.6 靠近可交互物 24 像素内出现向上箭头气泡
    for (var i = 0; i < this.levelNpcs.length; i++) {
      var n = this.levelNpcs[i];
      var nx = n.at[0] * TS + TS / 2;
      var ny = n.at[1] * TS + TS / 2;
      var d = Math.hypot(p.centreX() - nx, p.y + p.h / 2 - ny);
      if (d < 26 && d < bestD) { bestD = d; best = { type: 'npc', ref: n, x: nx, y: ny }; }
    }
    var cp = this.level.checkpoint;
    if (cp) {
      var cx = cp.at[0] * TS + TS / 2;
      var d2 = Math.hypot(p.centreX() - cx, (p.y + p.h / 2) - cp.at[1] * TS);
      if (d2 < 26 && d2 < bestD) { bestD = d2; best = { type: 'checkpoint', x: cx, y: cp.at[1] * TS }; }
    }
    for (var a = 0; a < this.mech.altars.length; a++) {
      var al = this.mech.altars[a];
      if (!al.near) continue;
      var ax = al.tx * TS + TS / 2;
      var ay = al.ty * TS;
      var d3 = Math.hypot(p.centreX() - ax, (p.y + p.h / 2) - ay);
      if (d3 < 30 && d3 < bestD) { bestD = d3; best = { type: 'altar', ref: al, x: ax, y: ay }; }
    }
    this.interactTarget = best;
  };

  Game.prototype.doInteract = function () {
    var t = this.interactTarget;
    if (!t) return;
    if (t.type === 'npc') {
      this.talkToNpc(t.ref);
    } else if (t.type === 'checkpoint') {
      var cp = this.level.checkpoint;
      this.respawn = { x: cp.respawn[0] * TS, y: cp.respawn[1] * TS };
      this.autoSave();
      this.audio.sfx('save_ok');
      this.showMsg(T('进度已记录'), 1.4);
    } else if (t.type === 'altar') {
      var r = this.mech.interact(this.player, this.collected);
      if (r) {
        if (r.type === 'rune_solved') this.showMsg(T('符文拼合完成'), 2.0);
        else if (r.type === 'rune_incomplete') this.showMsg(T('还缺 ') + r.need + T(' 块符文碎片'), 1.8);
        else this.showMsg(T('符文已经拼好了'), 1.4);
      }
    }
  };

  Game.prototype.talkToNpc = function (npc) {
    var C = CT.DATA.content;
    var themeKey = this.themeKey;
    var npcKind = npc.kind;
    var nameMap = {
      firefly: T('林间萤灵'), elder: T('石苔长老'), messenger: T('云絮信使'),
      clam: T('河蚌灵'), guide: T('苔痕向导'),
    };
    var name = nameMap[npcKind] || T('旅伴');
    // 每关只读一轮，最多 3 轮（§6.3）
    var key = this.currentLevelId + ':' + npc.id;
    if (!this.save.read) this.save.read = {};
    var round = this.save.read[key] || 0;
    var set = C.npcDialogue.filter(function (d) { return d.theme === themeKey && d.npc === name; })[0];
    var lines;
    if (set) {
      var r = set.rounds[Math.min(round, set.rounds.length - 1)];
      lines = r.lines.slice();
    } else {
      lines = [T('这一带的路径还算清楚。'), T('走累了就在石碑旁边停一停。')];
    }
    this.save.read[key] = Math.min(3, round + 1);
    this.audio.sfx('dialogue');
    this.dialogue.open(name, lines, null);
  };

  Game.prototype.checkExit = function () {
    var ex = this.level.exit;
    if (!ex) return;
    var p = this.player;
    var cx = ex.at[0] * TS + TS / 2;
    var cy = ex.at[1] * TS + TS / 2;
    if (Math.abs(p.centreX() - cx) < 18 && Math.abs((p.y + p.h / 2) - cy) < 34) {
      this.completeLevel();
    }
  };

  Game.prototype.completeLevel = function () {
    this.state = STATE.CLEAR;
    this.clearTimer = 0;
    this.audio.sfx('celebrate');
    this.particles.sparkle(this.player.centreX(), this.player.y, this.P.c[15]);
    var info = CT.Themes.levelInfo(this.currentLevelId);
    var li = info ? info.index : 1;
    var th = info ? info.theme : this.themeCfg;
    this.clearTitle = th.name + ' · ' + (info ? info.name : '');
    this.clearCrystal = null;
    if (li === 5) {
      var C = CT.DATA.content;
      this.clearCrystal = C.crystals.filter(function (c) { return c.id === th.crystal; })[0] || null;
      this.clearBlessing = C.blessings.filter(function (b) { return b.theme === th.key; })[0] || null;
      if (this.save) this.save.crystals[th.crystal] = 1;
    }
    if (this.save) { this.save.collected = this.collected; }
    this.autoSave();
    this.persist();
  };

  Game.prototype.stepClear = function (dt, input) {
    this.clearTimer += dt;
    this.player.updateAnim(dt, false, 'celebrate');
    this.particles.update(dt);
    if (this.clearTimer > 0.6 && (input.interactPressed || input.jumpPressed)) {
      var nxt = CT.Themes.nextLevel(this.currentLevelId);
      this.audio.sfx('confirm');
      if (nxt) {
        this.enterLevel(nxt);
        this.state = STATE.PLAYING;
      } else {
        this.state = STATE.ENDING;
      }
    }
  };

  Game.prototype.stepEnding = function (input) {
    if (input.interactPressed || input.jumpPressed || input.pausePressed) {
      this.state = STATE.TITLE;
      this.titleIndex = 0;
      this.audio.sfx('back');
    }
  };

  Game.prototype.stepPaused = function (input) {
    var items = 3;
    if (input.upPressed || input.stickUp) { this.pauseIndex = (this.pauseIndex + items - 1) % items; this.audio.sfx('cursor'); }
    if (input.downPressed || input.stickDown) { this.pauseIndex = (this.pauseIndex + 1) % items; this.audio.sfx('cursor'); }
    if (input.pausePressed) { this.state = STATE.PLAYING; this.audio.sfx('back'); return; }
    if (input.interactPressed || input.jumpPressed) {
      this.audio.sfx('confirm');
      if (this.pauseIndex === 0) this.state = STATE.PLAYING;
      else if (this.pauseIndex === 1) { this.state = STATE.CODEX; this.codexPage = 0; }
      else { this.persist(); this.state = STATE.TITLE; this.titleIndex = 0; }
    }
  };

  Game.prototype.stepCodex = function (input) {
    var C = CT.DATA.content;
    var pages = 12;   // 5 主题宝物 + 1 总览 + 5 旅途留影 + 1 故事
    if (input.leftPressed || input.upPressed) { this.codexPage = (this.codexPage + pages - 1) % pages; this.audio.sfx('page'); }
    if (input.rightPressed || input.downPressed) { this.codexPage = (this.codexPage + 1) % pages; this.audio.sfx('page'); }
    if (input.pausePressed || input.interactPressed) {
      this.audio.sfx('back');
      this.state = (this.save && this.level) ? STATE.PAUSED : STATE.TITLE;
    }
  };

  Game.prototype.stepSettings = function (input) {
    var items = 7;
    if (input.upPressed || input.stickUp) { this.settingsIndex = (this.settingsIndex + items - 1) % items; this.audio.sfx('cursor'); }
    if (input.downPressed || input.stickDown) { this.settingsIndex = (this.settingsIndex + 1) % items; this.audio.sfx('cursor'); }
    var s = this.save ? this.save.settings
      : { bgm: 70, sfx: 80, touchLayout: this.layoutIdx, muteBgm: false, muteSfx: false, lang: CT.I18N.lang };
    if (s.muteBgm === undefined) s.muteBgm = false;
    if (s.muteSfx === undefined) s.muteSfx = false;
    if (!s.lang) s.lang = CT.I18N.lang;

    function applyAudio(audio, s2) {
      audio.setVolumes(s2.bgm, s2.sfx);
      audio.setMuted('bgm', !!s2.muteBgm);
      audio.setMuted('sfx', !!s2.muteSfx);
    }
    var step = input.leftPressed ? -1 : (input.rightPressed ? 1 : 0);
    if (step !== 0) {
      if (this.settingsIndex === 0) s.bgm = Math.max(0, Math.min(100, s.bgm + step * 10));
      else if (this.settingsIndex === 1) s.sfx = Math.max(0, Math.min(100, s.sfx + step * 10));
      else if (this.settingsIndex === 2) s.muteBgm = !s.muteBgm;
      else if (this.settingsIndex === 3) s.muteSfx = !s.muteSfx;
      else if (this.settingsIndex === 4) s.touchLayout = ((s.touchLayout || 0) + step + 3) % 3;
      else if (this.settingsIndex === 5) {
        s.lang = CT.I18N.lang === 'zh' ? 'en' : 'zh';
        CT.I18N.setLang(s.lang);
        if (this.save) { this.save.lang = s.lang; }
        if (this.dialogue) this.dialogue.active = false;
      }
      applyAudio(this.audio, s);
      this.layoutIdx = s.touchLayout !== undefined ? s.touchLayout : this.layoutIdx;
      this.audio.sfx('cursor');
    }
    // 空格 / E 在开关行上也能直接切换
    if (input.interactPressed && (this.settingsIndex === 2 || this.settingsIndex === 3)) {
      if (this.settingsIndex === 2) s.muteBgm = !s.muteBgm;
      else s.muteSfx = !s.muteSfx;
      applyAudio(this.audio, s);
      this.audio.sfx('cursor');
    }
    if (input.interactPressed && this.settingsIndex === 6) {
      if (this.save) { this.save.settings = s; this.persist(); }
      this.state = (this.save && this.level) ? STATE.PAUSED : STATE.TITLE;
      this.audio.sfx('back');
    }
    if (input.pausePressed) {
      if (this.save) { this.save.settings = s; this.persist(); }
      this.state = (this.save && this.level) ? STATE.PAUSED : STATE.TITLE;
      this.audio.sfx('back');
    }
  };

  // =============================================================== 渲染
  // 窗口尺寸变化：重建画布缓冲与背景层，其余状态保持不动
  Game.prototype.onResize = function () {
    if (!CT.View) return;
    syncView();
    this.fb = new CT.FB(VW, VH);
    if (this.themeKey) this.bg = CT.BG.build(this.themeKey);
  };

  Game.prototype.render = function () {
    syncView();
    var fb = this.fb;
    switch (this.state) {
      case STATE.TITLE: this.renderTitle(); break;
      case STATE.SLOTS: this.renderSlots(); break;
      case STATE.PLAYING:
        this.renderWorld(); this.renderHud(); this.renderGlossaryToast();
        this.renderTutorial(); this.renderDialogueOverlay();
        break;
      case STATE.PAUSED: this.renderWorld(); this.renderHud(); this.renderPause(); break;
      case STATE.CODEX: this.renderCodex(); break;
      case STATE.SETTINGS: this.renderSettings(); break;
      case STATE.CLEAR: this.renderWorld(); this.renderHud(); this.renderClear(); break;
      case STATE.ENDING: this.renderEnding(); break;
      case STATE.NAME: this.renderName(); break;
    }
    if (this.msg) this.renderMsg();
  };

  Game.prototype.renderWorld = function () {
    var fb = this.fb;
    var P = this.P;
    var L = this.level;
    var camX = this.camera.renderX();
    var camY = this.camera.renderY();
    var F = CT.BG.FACTOR;

    CT.BG.drawSky(fb, this.bg.sky);
    CT.BG.drawLayer(fb, this.bg.far, camX * F.far, false);
    CT.BG.drawLayer(fb, this.bg.mid, camX * F.mid, false);

    this.renderTerrain(camX, camY);
    this.renderDecor(camX, camY);
    this.renderTreasures(camX, camY);
    this.renderNpcs(camX, camY);
    this.mech.draw(fb, camX, camY);
    this.renderPlayer(camX, camY);
    this.particles.draw(fb, camX, camY);
    CT.BG.drawLayer(fb, this.bg.near, camX * F.near, true);

    // 受伤闪屏：0~0.18 秒亮闪，之后暗闪淡出，全程不阻塞操作
    if (this.hurtFx > 0.001) {
      var hk = this.hurtFx / 0.55;
      if (hk > 0.7) fb.fillRectDither(0, 0, VW, VH, P.c[0], 11);
      else fb.fillRectDither(0, 0, VW, VH, P.c[14], Math.round(hk * 11));
    }
  };

  Game.prototype.renderTerrain = function (camX, camY) {
    var fb = this.fb;
    var L = this.level;
    var T = CT.Tiles;
    var K = T.KIND;
    var r = L.visibleTileRange(camX, camY, VW, VH);
    for (var ty = r.y0; ty <= r.y1; ty++) {
      for (var tx = r.x0; tx <= r.x1; tx++) {
        var code = L.codeAt(tx, ty);
        if (code === CT.TILE.EMPTY) continue;
        if (L.isDoorTile(tx, ty)) continue;      // 门由机关层绘制
        var kind;
        if (code === CT.TILE.SOLID) kind = K.GROUND;
        else if (code === CT.TILE.PLATFORM) kind = K.PLATFORM;
        else if (code === CT.TILE.SLOPE_R) kind = K.SLOPE_R;
        else if (code === CT.TILE.SLOPE_L) kind = K.SLOPE_L;
        else continue;
        var mask = L.neighbourMask(tx, ty);
        var v = CT.hash2(tx, ty, 0x51) & 3;
        // 埋深决定画草皮 / 土层 / 深层岩体，地面才不会是一块扁平色块
        var dc = (kind === K.GROUND) ? L.depthClass(tx, ty) : 0;
        var tile = T.getTile(this.themeKey, kind, mask, v, dc);
        fb.blit(tile.d, TS, TS, tx * TS - camX, ty * TS - camY);
      }
    }
  };

  Game.prototype.renderDecor = function (camX, camY) {
    var fb = this.fb;
    var list = this.levelDecor;
    var x0 = camX - 40, x1 = camX + VW + 40;
    // 装饰按 x 排序，二分找起点
    var lo = 0, hi = list.length - 1, start = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (list[mid].x * TS < x0) { start = mid + 1; lo = mid + 1; }
      else hi = mid - 1;
    }
    for (var i = start; i < list.length; i++) {
      var d = list[i];
      var dx = d.x * TS;
      if (dx > x1) break;
      var prop = CT.Sprites.buildProp(this.themeKey, d.set, d.v);
      var px, py;
      if (d.mode === 'hang') {
        // 悬挂件顶端贴住天花板下沿，水平居中
        px = dx + 8 - (prop.w >> 1);
        py = (d.y + 1) * TS;
      } else {
        // 落地件底边贴住地表；大件装饰宽度不一，统一居中
        px = dx + 8 - (prop.w >> 1);
        py = d.y * TS - prop.h;
      }
      // §5.4 的可交互前景微动保留，但只在主角站定时生效。
      // 走动时如果草丛还在左右摆，整排装饰会跟着镜头一起「跳」，非常晃眼；
      // 背景视差层不受影响，仍是连续滚动的。
      var sway = 0;
      if (!this.playerMoving) {
        sway = Math.round(Math.sin(this.time * Math.PI * 0.6 + d.x * 0.7));
        if (sway > 1) sway = 1;
        if (sway < -1) sway = -1;
      }
      fb.blit(prop.d, prop.w, prop.h, px - camX + sway, py - camY);
    }
  };

  Game.prototype.renderTreasures = function (camX, camY) {
    var fb = this.fb;
    var S = CT.Sprites;
    var P = this.P;
    for (var i = 0; i < this.levelTreasures.length; i++) {
      var t = this.levelTreasures[i];
      if (this.collected[t.id]) continue;
      var b = this.treasureBox(t);
      var x = Math.round(b.x) - camX;
      var y = Math.round(b.y) - camY;
      if (x < -32 || x > VW + 32 || y < -32 || y > VH + 32) continue;

      var spr;
      if (t.kind === 'main') spr = S.buildCrystal(P.c[15], P.c[0], P.c[14]);
      else if (t.kind === 'mark') spr = S.buildMark(P.c[15], P.c[0]);
      else if (t.kind === 'rune') spr = S.buildTreasure(P.c[8], P.c[0]);
      else spr = S.buildTreasure(P.c[15], P.c[0]);

      // §7.5 光晕 16 / 24 / 32 三档递减透明度（抖动实现）
      if (t.kind === 'main' || t.kind === 'mark') {
        drawGlow(fb, x + spr.w / 2, y + spr.h / 2, 32, P.c[15], P);
        drawGlow(fb, x + spr.w / 2, y + spr.h / 2, 24, P.c[1], P);
      } else {
        drawGlow(fb, x + spr.w / 2, y + spr.h / 2, 16, P.c[2], P);
      }
      fb.blit(spr.d, spr.w, spr.h, x, y);
    }
  };

  // 7 × 6 像素的心（实心 / 空心），用主题色，不引入新的调色板
  function drawHeart(fb, x, y, filled, P) {
    var c = filled ? P.c[15] : P.c[12];
    var e = filled ? P.c[12] : P.c[6];
    fb.fillRect(x + 1, y, 2, 1, e); fb.fillRect(x + 4, y, 2, 1, e);
    fb.fillRect(x, y + 1, 7, 2, e);
    fb.fillRect(x + 1, y + 3, 5, 1, e);
    fb.fillRect(x + 2, y + 4, 3, 1, e);
    fb.fillRect(x + 3, y + 5, 1, 1, e);
    if (filled) {
      fb.fillRect(x + 1, y + 1, 2, 1, c); fb.fillRect(x + 4, y + 1, 2, 1, c);
      fb.fillRect(x + 1, y + 2, 5, 1, c);
      fb.fillRect(x + 2, y + 3, 3, 1, c);
      fb.fillRect(x + 3, y + 4, 1, 1, c);
    }
  }

  function drawGlow(fb, cx, cy, radius, color, P) {
    var r = radius / 2;
    for (var y = -r; y <= r; y++) {
      for (var x = -r; x <= r; x++) {
        var d = x * x + y * y;
        if (d > r * r) continue;
        var lv = d < (r * r) / 4 ? 6 : (d < (r * r) * 0.65 ? 3 : 1);
        if (CT.BAYER4[((Math.round(cy + y)) & 3) * 4 + ((Math.round(cx + x)) & 3)] < lv) {
          fb.px(Math.round(cx + x), Math.round(cy + y), color);
        }
      }
    }
  }

  Game.prototype.renderNpcs = function (camX, camY) {
    var fb = this.fb;
    var S = CT.Sprites;
    for (var i = 0; i < this.levelNpcs.length; i++) {
      var n = this.levelNpcs[i];
      var spr = S.buildNpc(n.kind, this.P);
      var x = n.at[0] * TS + TS / 2 - (spr.w >> 1) - camX;
      var bob = Math.round(Math.sin(this.time * 1.6 + i) * 1.5);
      var y = (n.at[1] + 1) * TS - spr.h - camY + bob;
      if (x < -40 || x > VW + 40) continue;
      fb.blit(spr.d, spr.w, spr.h, x, y, n.facing < 0);
    }
    // 交互提示气泡（向上箭头）
    var t = this.interactTarget;
    if (t) {
      var bx = Math.round(t.x - camX);
      var by = Math.round(t.y - camY) - 30;
      var float = Math.round(Math.sin(this.time * 4) * 1.5);
      fb.fillRect(bx - 5, by + float, 11, 11, gc(G.PANEL_LO));
      fb.rect(bx - 5, by + float, 11, 11, gc(G.PANEL_HI));
      var c = this.P.c[15];
      fb.fillRect(bx, by + 3 + float, 1, 4, c);
      fb.fillRect(bx - 1, by + 2 + float, 3, 1, c);
      fb.fillRect(bx - 2, by + 1 + float, 5, 1, c);
      fb.fillRect(bx - 3, by + float, 7, 1, c);
    }
  };

  Game.prototype.renderPlayer = function (camX, camY) {
    var fb = this.fb;
    var p = this.player;
    var anim = this.heroSprites[p.anim] || this.heroSprites.idle;
    var frame = anim.frames[Math.min(p.animFrame, anim.frames.length - 1)];
    var sx = p.spriteX() - camX;
    var sy = p.spriteY() - camY;

    // 脚下椭圆微光（§3.1 9 × 3）
    var glowColor = this.save && this.save.crystals &&
      Object.keys(this.save.crystals).length > 0 ? this.P.c[15] : this.P.c[1];
    if (p.onGround) {
      fb.fillRectDither(p.x - 3 - camX, p.bottom() - camY - 1, 9, 3, glowColor, 6);
    }
    // 无敌期间闪烁，明确告诉玩家「现在撞不到」
    if (this.invuln > 0 && (Math.floor(this.time * 16) & 1) === 0) return;
    fb.blit(frame.d, 16, 24, sx, sy, p.facing < 0);
  };

  // ---------------------------------------------------------------- HUD
  Game.prototype.renderHud = function () {
    var fb = this.fb;
    var P = this.P;
    var C = CT.DATA.content;
    var done = 0, total = C.treasures.length;
    for (var i = 0; i < C.treasures.length; i++) if (this.collected[C.treasures[i].id]) done++;

    // 左上：主题名 + 关卡名
    var info = CT.Themes.levelInfo(this.currentLevelId);
    CT.Font.draw(fb, info ? info.theme.name : '', 6, 5, P.c[0], { outline: gc(G.OUTLINE) });
    CT.Font.draw(fb, info ? info.name : '', 6, 17, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });

    // 右上：收集进度
    var t = done + '/' + total;
    var tw = CT.Font.measure(t);
    fb.fillRect(VW - tw - 46, 3, tw + 42, 14, gc(G.PANEL_LO));
    fb.rect(VW - tw - 46, 3, tw + 42, 14, gc(G.PANEL_HI));
    fb.fillRect(VW - tw - 40, 7, 9, 7, P.c[15]);
    fb.hline(VW - tw - 40, 7, 9, P.c[0]);
    CT.Font.draw(fb, t, VW - tw - 26, 5, gc(G.TEXT), { outline: gc(G.OUTLINE) });

    // 生命值：三颗心，放在关卡名下方
    for (var li2 = 0; li2 < this.maxLives; li2++) {
      drawHeart(fb, 6 + li2 * 9, 30, li2 < this.lives, P);
    }

    // 彩晶数量
    var crystals = this.save && this.save.crystals ? Object.keys(this.save.crystals).length : 0;
    CT.Font.draw(fb, T('晶 ') + crystals + '/5', VW - 66, 20, P.c[15], { outline: gc(G.OUTLINE) });

    // 帧率（设置里可开）
    if (this.save && this.save.settings && this.save.settings.showFps) {
      CT.Font.draw(fb, this.fps + 'FPS', 6, VH - 12, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
    }

    // 触屏控件
    if (this.touchActive) {
      var lay = this.save && this.save.settings ? (this.save.settings.touchLayout || 0) : this.layoutIdx;
      CT.UI.drawTouch(fb, lay, P, CT.Input.touch, this.time, 13);
    }
  };

  Game.prototype.renderDialogueOverlay = function () {
    this.dialogue.draw(this.fb, this.P, VW, VH, this.time);
  };

  Game.prototype.renderMsg = function () {
    var fb = this.fb;
    var w = CT.Font.measure(this.msg) + 16;
    var x = Math.round((VW - w) / 2);
    var y = 26;
    fb.fillRect(x, y, w, 18, gc(G.PANEL_LO));
    fb.rect(x, y, w, 18, gc(G.PANEL_HI));
    CT.Font.drawCentered(fb, this.msg, VW / 2, y + 3, this.P.c[15], { outline: gc(G.OUTLINE) });
  };

  // ------------------------------------------------------------- 各界面
  Game.prototype.renderTitle = function () {
    var fb = this.fb;
    var P = this.P;
    // 标题用森林主题的背景（最稳，不依赖主题切换）
    CT.BG.drawSky(fb, CT.BG.build('forest').sky);
    CT.BG.drawLayer(fb, CT.BG.build('forest').far, this.time * 9, false);
    CT.BG.drawLayer(fb, CT.BG.build('forest').mid, this.time * 14, false);
    CT.BG.drawLayer(fb, CT.BG.build('forest').near, this.time * 22, true);

    // 标题字
    var t1 = T('晶途拾光');
    var scale = 2;
    drawBigText(fb, t1, VW / 2, 40, this.P.c[14], null, 2);
    CT.Font.drawCentered(fb, 'C R Y S T A L   T R A I L', VW / 2, 84, P.c[3], { outline: gc(G.OUTLINE) });

    CT.UI.panel(fb, 150, 104, 180, 96, P, P.c[15]);
    var items = [T('开始新的旅程'), T('继续旅程'), T('图鉴'), T('设置')];
    for (var i = 0; i < items.length; i++) {
      CT.UI.menuItem(fb, items[i], 190, 118 + i * 20, i === this.titleIndex, P, this.time);
    }
    CT.Font.drawCentered(fb, T('方向键选择 · 空格或 E 确认'), VW / 2, 228, gc(G.TEXT), { outline: gc(G.OUTLINE) });
    CT.Font.drawCentered(fb, T('全程无战斗 · 无死亡惩罚'), VW / 2, 250, P.c[4], { outline: gc(G.OUTLINE) });
  };

  function drawBigText(fb, text, cx, y, color, outline, scale) {
    var w = CT.Font.measure(text) * scale;
    var x = Math.round(cx - w / 2);
    // 12px 点阵字放 2 倍：直接按 2×2 像素块绘制，保持硬像素（§7.1 禁止非整数缩放）
    var tmp = new CT.FB(CT.Font.measure(text) + 2, 16);
    CT.Font.draw(tmp, text, 1, 2, color, outline === null ? {} : { outline: outline });
    for (var ty = 0; ty < tmp.h; ty++) {
      for (var tx = 0; tx < tmp.w; tx++) {
        var c = tmp.get(tx, ty);
        if (c === 0) continue;
        fb.fillRect(x + (tx - 1) * scale, y + (ty - 2) * scale, scale, scale, c);
      }
    }
  }

  Game.prototype.renderSlots = function () {
    var fb = this.fb;
    var P = this.P;
    fb.clear(gc(G.PANEL));
    CT.BG.drawSky(fb, CT.BG.build('forest').sky);
    fb.fillRectDither(0, 0, VW, VH, gc(G.PANEL), 12);
    CT.UI.title(fb, this.slotMode === 'new' ? T('选择存档位') : T('继续旅程'), VW / 2, 14, P);
    var list = CT.Save.list();
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var y = 44 + i * 44;
      var sel = i === this.slotIndex;
      CT.UI.panel(fb, 92, y, 296, 38, P, sel ? P.c[15] : P.c[7]);
      var label = i < 3 ? (T('存档 ') + (i + 1)) : T('自动存档');
      CT.Font.draw(fb, label, 104, y + 6, sel ? P.c[0] : gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
      if (s) {
        var li = CT.Themes.levelInfo(s.level || 'forest-01');
        var comp = CT.Save.completion(s);
        CT.Font.draw(fb, (li ? li.theme.name + ' · ' + li.name : T('未知')), 104, y + 21, gc(G.TEXT), { outline: gc(G.OUTLINE) });
        CT.Font.draw(fb, T('收集 ') + comp.pct + '%', 300, y + 21, P.c[15], { outline: gc(G.OUTLINE) });
      } else {
        CT.Font.draw(fb, T('空存档'), 104, y + 21, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
      }
      if (sel) {
        fb.rect(92, y, 296, 38, P.c[15]);
      }
    }
    CT.Font.drawCentered(fb, T('空格 / E 确认 · Esc 返回'), VW / 2, 240, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
  };

  Game.prototype.renderPause = function () {
    var fb = this.fb;
    var P = this.P;
    fb.fillRectDither(0, 0, VW, VH, gc(G.PANEL), 10);
    CT.UI.panel(fb, 160, 78, 160, 108, P, P.c[15]);
    CT.UI.title(fb, T('暂停'), VW / 2, 84, P);
    var items = [T('继续'), T('图鉴'), T('返回标题')];
    for (var i = 0; i < items.length; i++) {
      CT.UI.menuItem(fb, items[i], 200, 112 + i * 20, i === this.pauseIndex, P, this.time);
    }
    var comp = CT.Save.completion({ collected: this.collected });
    CT.Font.drawCentered(fb, T('收集完成度 ') + comp.pct + '%', VW / 2, 168, P.c[15], { outline: gc(G.OUTLINE) });
  };

  Game.prototype.renderCodex = function () {
    var fb = this.fb;
    var P = this.P;
    fb.clear(gc(G.PANEL));
    fb.fillRect(0, 0, VW, VH, gc(G.PANEL));
    CT.UI.title(fb, T('图鉴'), VW / 2, 8, P);

    var C = CT.DATA.content;
    var themes = CT.Themes.LIST;
    var page = this.codexPage;
    var y0 = 34;

    // ---- 旅途留影（第 6~10 页）：每枚彩晶解锁一张插画
    if (page >= 6 && page <= 10) {
      var gi = page - 6;
      var gth = themes[gi];
      var gdata = (C.gallery || []).filter(function (x) { return x.theme === gth.key; })[0];
      // themes.LIST[].crystal 存的已经是彩晶 id（如 crystal-forest）
      var crystalId = gth.crystal;
      var unlocked = !!(this.save && this.save.crystals && crystalId && this.save.crystals[crystalId]);
      CT.Font.draw(fb, T('旅途留影') + '  ' + (gi + 1) + '/5', VW / 2 - 40, 30, P.c[15], { outline: gc(G.OUTLINE) });
      if (unlocked) {
        var ill = CT.Illustration.build(gth.key);
        var ix = Math.round((VW - ill.w) / 2), iy = 46;
        fb.blitOpaque(ill.d, ill.w, ill.h, ix, iy);
        fb.rect(ix - 1, iy - 1, ill.w + 2, ill.h + 2, CT.Palette.get(gth.key).c[11]);
        if (gdata) {
          CT.Font.drawCentered(fb, gdata.title, VW / 2, iy + ill.h + 8, P.c[15], { outline: gc(G.OUTLINE) });
          // 折行宽度取 VW-30：短文案能一行放下，长文案才分成两行，
          // 避免只剩一个句号被挤到第二行。
          var cap = CT.Font.wrap(gdata.caption, VW - 30, 2);
          for (var cl = 0; cl < cap.length; cl++) {
            CT.Font.drawCentered(fb, cap[cl], VW / 2, iy + ill.h + 22 + cl * 13, gc(G.TEXT), { outline: gc(G.OUTLINE) });
          }
        }
      } else {
        // 未解锁：画一个暗色框，提示取得彩晶
        var bw2 = 192, bh2 = 128;
        var bx2 = Math.round((VW - bw2) / 2), by2 = 52;
        fb.fillRect(bx2, by2, bw2, bh2, gc(G.PANEL_LO));
        fb.rect(bx2, by2, bw2, bh2, gc(G.PANEL_HI));
        CT.Font.drawCentered(fb, T('？？？'), VW / 2, by2 + 58, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
        CT.Font.drawCentered(fb, T('取得本源彩晶后解锁'), VW / 2, by2 + 78, P.c[4], { outline: gc(G.OUTLINE) });
      }
      CT.Font.drawCentered(fb, T('←→ 翻页 · Esc 返回'), VW / 2, 252, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
      return;
    }

    // ---- 故事页（第 11 页）：五枚彩晶齐了才讲完
    if (page === 11) {
      CT.UI.title(fb, T('完整的故事'), VW / 2, 10, P);
      var allCrystals = 0;
      for (var ci = 0; ci < C.crystals.length; ci++) {
        if (this.save && this.save.crystals && this.save.crystals[C.crystals[ci].id]) allCrystals++;
      }
      if (allCrystals >= 5 && C.story) {
        var slines = CT.Font.wrap(C.story, VW - 60, 12);
        for (var si = 0; si < slines.length; si++) {
          CT.Font.drawCentered(fb, slines[si], VW / 2, 40 + si * 16, gc(G.TEXT), { outline: gc(G.OUTLINE) });
        }
      } else {
        CT.Font.drawCentered(fb, T('集齐五枚彩晶') + ' (' + allCrystals + '/5)', VW / 2, 120, P.c[15], { outline: gc(G.OUTLINE) });
        CT.Font.drawCentered(fb, T('故事才会讲完'), VW / 2, 138, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
      }
      CT.Font.drawCentered(fb, T('←→ 翻页 · Esc 返回'), VW / 2, 252, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
      return;
    }

    if (page < 5) {
      var th = themes[page];
      var TP = CT.Palette.get(th.key);
      var list = C.treasures.filter(function (t) { return t.theme === th.key; });
      CT.Font.draw(fb, th.name, 10, y0, TP.c[15], { outline: gc(G.OUTLINE) });
      var got = 0;
      for (var i = 0; i < list.length; i++) if (this.collected[list[i].id]) got++;
      CT.Font.draw(fb, got + '/' + list.length, 300, y0, gc(G.TEXT), { outline: gc(G.OUTLINE) });
      for (var r = 0; r < Math.min(8, list.length); r++) {
        var t = list[r];
        var yy = y0 + 16 + r * 26;
        var have = !!this.collected[t.id];
        CT.Font.draw(fb, have ? t.name : '？？？', 14, yy, have ? gc(G.TEXT) : gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
        if (have) {
          CT.Font.draw(fb, t.desc, 14, yy + 12, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
          CT.Font.draw(fb, t.place, 250, yy + 12, TP.c[4], { outline: gc(G.OUTLINE) });
          var d = this.collected[t.id];
          if (typeof d === 'string') CT.Font.drawRight(fb, d, 470, yy, TP.c[7], { outline: gc(G.OUTLINE) });
        } else {
          CT.Font.draw(fb, T('尚未寻得'), 14, yy + 12, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
        }
      }
    } else if (page === 5) {
      // 总览页：五枚彩晶与五枚守护印记
      CT.Font.draw(fb, T('本源彩晶'), 10, y0, P.c[15], { outline: gc(G.OUTLINE) });
      for (var k = 0; k < C.crystals.length; k++) {
        var c = C.crystals[k];
        var own = this.save && this.save.crystals && this.save.crystals[c.id];
        CT.Font.draw(fb, own ? c.name : '？？？', 16 + k * 90, y0 + 18, own ? P.c[0] : gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
      }
      CT.Font.draw(fb, T('守护印记'), 10, y0 + 42, P.c[15], { outline: gc(G.OUTLINE) });
      for (var m = 0; m < C.marks.length; m++) {
        var mk = C.marks[m];
        var ownM = this.save && this.save.marks && this.save.marks[mk.id];
        CT.Font.draw(fb, ownM ? mk.name : '？？？', 16 + m * 90, y0 + 60, ownM ? P.c[0] : gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
      }
    }
    var comp = CT.Save.completion({ collected: this.collected });
    CT.Font.drawCentered(fb, T('收集完成度 ') + comp.pct + T('%   ←→ 翻页  Esc 返回'), VW / 2, 252, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
  };

  Game.prototype.renderSettings = function () {
    var fb = this.fb;
    var P = this.P;
    fb.fillRect(0, 0, VW, VH, gc(G.PANEL));
    CT.UI.title(fb, T('设置'), VW / 2, 20, P);
    CT.UI.panel(fb, 72, 44, 336, 184, P, P.c[15]);
    var s = this.save ? this.save.settings : { bgm: 70, sfx: 80, touchLayout: this.layoutIdx };
    if (s.muteBgm === undefined) s.muteBgm = false;
    if (s.muteSfx === undefined) s.muteSfx = false;
    if (!s.lang) s.lang = CT.I18N.lang;
    var rows = [
      [T('音乐音量'), s.bgm + '%'],
      [T('音效音量'), s.sfx + '%'],
      [T('关闭音乐'), s.muteBgm ? T('开') : T('关')],
      [T('关闭音效'), s.muteSfx ? T('开') : T('关')],
      [T('触屏布局'), CT.UI.LAYOUTS[s.touchLayout || 0].name],
      [T('语言'), CT.I18N.LANG_NAMES[s.lang] || s.lang],
      [T('返回'), ''],
    ];
    for (var i = 0; i < rows.length; i++) {
      var sel = i === this.settingsIndex;
      var ry = 60 + i * 22;
      CT.UI.menuItem(fb, rows[i][0], 116, ry, sel, P, this.time);
      if (rows[i][1]) CT.Font.drawRight(fb, rows[i][1], 364, ry, sel ? P.c[0] : gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
    }
    CT.Font.drawCentered(fb, T('←→ 调整 · Esc 返回'), VW / 2, 226, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
  };

  Game.prototype.renderClear = function () {
    var fb = this.fb;
    var P = this.P;
    fb.fillRectDither(0, 0, VW, VH, gc(G.PANEL), 12);
    CT.UI.panel(fb, 100, 60, 280, 150, P, P.c[15]);
    CT.UI.title(fb, this.clearTitle || T('关卡完成'), VW / 2, 66, P);
    var comp = CT.Save.completion({ collected: this.collected });
    CT.Font.drawCentered(fb, T('收集 ') + comp.side + '/' + comp.sideTotal, VW / 2, 96, gc(G.TEXT), { outline: gc(G.OUTLINE) });
    CT.UI.bar(fb, 140, 108, 200, 8, comp.pct / 100, P);
    if (this.clearCrystal) {
      CT.Font.drawCentered(fb, T('获得 ') + this.clearCrystal.name, VW / 2, 126, P.c[15], { outline: gc(G.OUTLINE) });
      CT.Font.drawCentered(fb, this.clearCrystal.desc, VW / 2, 140, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
    }
    if (this.clearBlessing) {
      var bl = CT.Dialogue.wrapLines(this.clearBlessing.blessing);
      for (var i = 0; i < bl.length; i++) {
        CT.Font.drawCentered(fb, bl[i], VW / 2, 154 + i * 13, gc(G.TEXT), { outline: gc(G.OUTLINE) });
      }
    }
    if (this.clearTimer > 0.6) {
      var nxt = CT.Themes.nextLevel(this.currentLevelId);
      CT.Font.drawCentered(fb, nxt ? T('空格继续') : T('空格查看结局'), VW / 2, 190, P.c[0], { outline: gc(G.OUTLINE) });
    }
  };

  Game.prototype.renderEnding = function () {
    var fb = this.fb;
    var P = this.P;
    CT.BG.drawSky(fb, CT.BG.build('star').sky);
    CT.BG.drawLayer(fb, CT.BG.build('star').far, this.time * 5, false);
    CT.BG.drawLayer(fb, CT.BG.build('star').mid, this.time * 9, false);
    fb.fillRectDither(0, 0, VW, VH, gc(G.PANEL), 8);
    CT.UI.title(fb, T('旅途的尽头'), VW / 2, 42, P);
    var lines = [
      T('五枚本源彩晶回到了它们该在的位置。'),
      T('大陆的光重新连成一条线。'),
      T('拾光者把旧布包放下，坐在殿门口。'),
      T('前面的路还有很长。'),
    ];
    for (var i = 0; i < lines.length; i++) {
      CT.Font.drawCentered(fb, lines[i], VW / 2, 90 + i * 22, gc(G.TEXT), { outline: gc(G.OUTLINE) });
    }
    var comp = CT.Save.completion({ collected: this.collected });
    CT.Font.drawCentered(fb, T('收集完成度 ') + comp.pct + '%', VW / 2, 200, P.c[15], { outline: gc(G.OUTLINE) });
    CT.Font.drawCentered(fb, T('空格返回标题'), VW / 2, 228, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
  };

  // ------------------------------------------------------------ 教程
  // 只在第一关首次游玩时出现。每一步等玩家真的做出那个动作才推进，
  // 不锁操作、不打断，只是在顶部提示该按哪个键。
  Game.prototype.updateTutorial = function (dt, input) {
    var T2 = this.tut;
    if (!T2.active) return;
    var p = this.player;
    switch (T2.step) {
      case 0:   // 向右走 3 格
        if (p.x > T2.x0 + 48) { T2.step = 1; this.audio.sfx('cursor'); }
        break;
      case 1:   // 跳一次
        if (input.jumpPressed || p.vy < -40) { T2.step = 2; this.audio.sfx('cursor'); }
        break;
      case 2:   // 按住空格跳得更高
        if (input.jumpHeld && p.vy < 0) T2.holdT += dt;
        if (T2.holdT > 0.14) { T2.step = 3; this.audio.sfx('cursor'); }
        break;
      case 3:   // 落地即完成
        if (p.onGround && p.vy === 0) {
          T2.step = 4;
          this.showMsg(T('教程结束，慢慢走'), 2.0);
          if (this.save) this.save.tutorialDone = true;
          var self = this;
          setTimeout(function () { self.tut.active = false; }, 1200);
        }
        break;
    }
  };

  Game.prototype.renderTutorial = function () {
    var T2 = this.tut;
    if (!T2.active || T2.step > 3) return;
    var fb = this.fb, P = this.P;
    var prompts = [T('按 ← → 向右走'), T('按空格跳一下'), T('按住空格能跳得更高')];
    var keys = ['← →', 'Space', 'Space'];
    var idx = Math.min(T2.step, prompts.length - 1);
    var label = prompts[idx];
    var kw = CT.Font.measure(keys[idx]) + 10;
    var tw = CT.Font.measure(label);
    var w = tw + kw + 26;
    // 放在 y=100：y=42 处是首次出现说明条，两者不能叠在一起
    var x = Math.round((VW - w) / 2), y = 100;
    fb.fillRect(x, y, w, 26, gc(G.PANEL));
    fb.rect(x, y, w, 26, gc(G.PANEL_HI));
    // 按键提示：一个高亮键帽
    fb.fillRect(x + 6, y + 5, kw, 16, P.c[15]);
    fb.rect(x + 6, y + 5, kw, 16, P.c[0]);
    CT.Font.drawCentered(fb, keys[idx], x + 6 + kw / 2, y + 7, P.c[14]);
    CT.Font.draw(fb, label, x + kw + 14, y + 7, gc(G.TEXT), { outline: gc(G.OUTLINE) });
  };

  // ------------------------------------------------------------ 取名
  // 名字池分中英两套，按当前语言取。骰子按钮从这里随机抽。
  var NAME_POOL = {
    zh: ['拾光', '阿蘅', '苔生', '沐雨', '石青', '灯灯', '云舟', '星禾', '林间', '小满',
         '浅溪', '松间', '芜生', '垂露', '眠石', '听风', '白苓', '长茧'],
    en: ['Wisp', 'Fern', 'Amber', 'Juno', 'Moss', 'Pike', 'Lumen', 'Ash', 'Rill',
         'Kite', 'Nim', 'Fen', 'Tinder', 'Sable', 'Corrie', 'Marlow', 'Sedge', 'Brine'],
  };

  Game.prototype.randomName = function () {
    var pool = NAME_POOL[CT.I18N.lang] || NAME_POOL.zh;
    var n = pool[(Math.random() * pool.length) | 0];
    if (CT.TextInput) CT.TextInput.setValue(n);
    this.nameBuf = n;
    if (this.audio) this.audio.sfx('cursor');
    return n;
  };

  Game.prototype.openNameInput = function () {
    var self = this;
    this.nameBuf = '';
    if (CT.TextInput) {
      CT.TextInput.open('', function (v) { self.nameBuf = v; });
    }
  };

  Game.prototype.stepName = function (dt, input) {
    // 把文本框里的内容同步进状态
    if (CT.TextInput) this.nameBuf = CT.TextInput.value();
    var items = 3;                                   // 0=骰子 1=确定 2=返回
    if (input.leftPressed) { this.nameIndex = (this.nameIndex + items - 1) % items; this.audio.sfx('cursor'); }
    if (input.rightPressed) { this.nameIndex = (this.nameIndex + 1) % items; this.audio.sfx('cursor'); }
    if (input.upPressed || input.downPressed) { this.nameIndex = (this.nameIndex + 1) % items; this.audio.sfx('cursor'); }

    if (input.pausePressed) {
      if (CT.TextInput) CT.TextInput.close();
      this.state = STATE.SLOTS;
      this.audio.sfx('back');
      return;
    }
    if (input.interactPressed || input.jumpPressed) {
      if (this.nameIndex === 0) { this.randomName(); return; }
      if (this.nameIndex === 2) {
        if (CT.TextInput) CT.TextInput.close();
        this.state = STATE.SLOTS;
        this.audio.sfx('back');
        return;
      }
      // 确定
      var nm = (this.nameBuf || '').trim();
      if (!nm) { this.randomName(); nm = this.nameBuf; }
      if (CT.TextInput) CT.TextInput.close();
      this.audio.sfx('confirm');
      var slot = this.pendingSlot || 1;
      this.newGame(slot, nm);
      return;
    }
  };

  Game.prototype.renderName = function () {
    var fb = this.fb, P = this.P;
    fb.fillRect(0, 0, VW, VH, gc(G.PANEL));
    // 顶部一层很淡的光带、底部压暗，保持界面干净
    for (var gy = 0; gy < 96; gy++) {
      var lv = Math.round(4 * (1 - gy / 96));
      fb.fillRectDither(0, gy, VW, 1, P.c[6], lv);
    }
    fb.fillRectDither(0, 150, VW, VH - 150, gc(G.BLACK), 6);
    CT.UI.title(fb, T('给拾光者起个名字'), VW / 2, 18, P);

    // 输入框
    var bw = 220, bh = 30;
    var bx = Math.round((VW - bw) / 2), by = 62;
    fb.fillRect(bx, by, bw, bh, gc(G.PANEL));
    fb.rect(bx, by, bw, bh, this.nameIndex === 0 || this.nameIndex === 1 ? gc(G.ACCENT) : gc(G.PANEL_HI));
    fb.rect(bx + 1, by + 1, bw - 2, bh - 2, gc(G.PANEL_LO));
    var shown = this.nameBuf || '';
    if (!shown) {
      CT.Font.drawCentered(fb, T('还没有名字'), VW / 2, by + 9, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
    } else {
      CT.Font.drawCentered(fb, shown, VW / 2, by + 9, gc(G.TEXT), { outline: gc(G.OUTLINE) });
      // 光标
      var w = CT.Font.measure(shown);
      if ((Math.floor(this.time * 3) & 1) === 0) {
        fb.fillRect(Math.round(VW / 2 + w / 2) + 2, by + 8, 2, 14, P.c[15]);
      }
    }

    // 三个按钮：随机（骰子） / 就这样 / 返回
    var labels = [T('随机'), T('就这样'), T('返回')];
    var totalW = 0;
    for (var i = 0; i < labels.length; i++) totalW += CT.Font.measure(labels[i]) + (i === 0 ? 26 : 18) + 12;
    var cx = Math.round((VW - totalW) / 2);
    for (var k = 0; k < labels.length; k++) {
      var w2 = CT.Font.measure(labels[k]) + (k === 0 ? 26 : 18);
      var sel = k === this.nameIndex;
      // 选中：浅底 + 深字（原来是浅底浅字，完全看不清）
      fb.fillRect(cx, 112, w2, 22, sel ? gc(G.PANEL_HI) : gc(G.PANEL_LO));
      fb.rect(cx, 112, w2, 22, sel ? gc(G.ACCENT) : gc(G.PANEL_HI));
      if (k === 0) {
        drawDice(fb, cx + 6, 117, sel ? P.c[15] : gc(G.TEXT_DIM),
                 sel ? gc(G.PANEL_HI) : gc(G.PANEL_LO));
      }
      CT.Font.draw(fb, labels[k], cx + (k === 0 ? 22 : 9), 117,
        sel ? gc(G.PANEL) : gc(G.TEXT_DIM),
        sel ? null : { outline: gc(G.OUTLINE) });
      cx += w2 + 12;
    }
    CT.Font.drawCentered(fb, T('直接敲键盘输入 · 回车确定'), VW / 2, 152, gc(G.TEXT_DIM), { outline: gc(G.OUTLINE) });
  };

  // 骰子图标：方框 + 三点
  function drawDice(fb, x, y, color, pipColor) {
    fb.fillRect(x, y, 13, 13, color);
    var pc = pipColor || gc(G.PANEL);
    fb.fillRect(x + 2, y + 2, 3, 3, pc);
    fb.fillRect(x + 8, y + 2, 3, 3, pc);
    fb.fillRect(x + 5, y + 5, 3, 3, pc);
    fb.fillRect(x + 2, y + 8, 3, 3, pc);
    fb.fillRect(x + 8, y + 8, 3, 3, pc);
  }

  Game.STATE = STATE;
  CT.Game = Game;
})();
