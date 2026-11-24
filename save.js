/* 晶途拾光 — 存档
 * --------------------------------------------------------------------------
 * §4.5 存档与进度
 *   单文件 JSON，字段包含当前主题、当前关卡、已收集宝物 ID 列表、
 *   已解机关 ID 列表、对话已读标记、设置项与存档版本号。
 *   触发点：进入关卡时自动存档、触碰存档石碑时手动存档、通关结算后存档。
 *   存档槽位为 3 个，另加 1 个自动存档位，界面显示收集完成度百分比。
 * §10.5 两端共用同一套存档结构，字段中包含 save_version，大版本升级提供迁移。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var KEY_PREFIX = 'crystalTrail.save.';
  var VERSION = 1;
  var SLOTS = 3;
  var AUTO_SLOT = 'auto';

  var memory = {};          // localStorage 不可用时的内存兜底

  function hasStorage() {
    try {
      if (typeof localStorage === 'undefined') return false;
      var k = KEY_PREFIX + '__probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }
  var STORAGE_OK = hasStorage();

  function readRaw(slot) {
    var key = KEY_PREFIX + slot;
    try {
      if (STORAGE_OK) return localStorage.getItem(key);
    } catch (e) { /* 忽略，走内存 */ }
    return memory[key] || null;
  }
  function writeRaw(slot, text) {
    var key = KEY_PREFIX + slot;
    try {
      if (STORAGE_OK) { localStorage.setItem(key, text); return true; }
    } catch (e) { /* 忽略 */ }
    memory[key] = text;
    return false;
  }
  function removeRaw(slot) {
    var key = KEY_PREFIX + slot;
    try { if (STORAGE_OK) localStorage.removeItem(key); } catch (e) {}
    delete memory[key];
  }

  function newSave(slot) {
    return {
      save_version: VERSION,
      slot: slot,
      theme: 'forest',
      level: 'forest-01',
      levelIndex: 0,
      collected: {},          // 已收集宝物 ID 列表
      solved: {},             // 已解机关 ID 列表
      read: {},               // 对话已读标记
      crystals: {},           // 已获得本源彩晶
      marks: {},              // 已获得守护印记
      glossary: {},           // 已介绍过的图标（首次出现说明只弹一次）
      tutorialDone: false,    // 第一关教程是否已完成
      playerName: '',         // 玩家输入或随机生成的主角名字
      lang: 'zh',             // 该存档使用的语言
      playTime: 0,
      saveTime: 0,
      settings: {
        bgm: 70,              // §8.5 默认 BGM 70%
        sfx: 80,              // §8.5 默认 SFX 80%
        touchLayout: 0,       // §10.4 三种预设布局
        showFps: false,
      },
    };
  }

  // 版本迁移：读取旧存档，补齐新字段，写回新格式（§10.5）
  function migrate(data) {
    if (!data || typeof data !== 'object') return null;
    var v = data.save_version || 0;
    if (v > VERSION) return null;               // 来自更新版本的存档，不降级读取
    var base = newSave(data.slot === undefined ? 0 : data.slot);
    for (var k in base) if (data[k] === undefined) data[k] = base[k];
    if (!data.settings) data.settings = base.settings;
    else for (var s in base.settings) if (data.settings[s] === undefined) data.settings[s] = base.settings[s];
    if (!data.collected) data.collected = {};
    if (!data.solved) data.solved = {};
    if (!data.read) data.read = {};
    if (!data.crystals) data.crystals = {};
    if (!data.marks) data.marks = {};
    data.save_version = VERSION;
    return data;
  }

  function load(slot) {
    var raw = readRaw(slot);
    if (!raw) return null;
    try {
      return migrate(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function save(slot, data) {
    // 注意：绝不在这里改写 data.slot。
    // 自动存档会拿同一份存档对象往 auto 槽写一次；如果顺手把 data.slot 改成
    // 'auto'，之后玩家的手动存档就会静默写到自动槽里，三个槽位全失效。
    data.save_version = VERSION;
    data.saveTime = Date.now();
    var text;
    try { text = JSON.stringify(data); } catch (e) { return false; }
    writeRaw(slot, text);
    return true;
  }

  function remove(slot) { removeRaw(slot); }

  // 收集完成度百分比（§4.5 界面显示收集完成度百分比）
  function completion(data) {
    var D = CT.DATA && CT.DATA.content;
    if (!D) return { side: 0, sideTotal: 60, pct: 0 };
    var total = D.treasures.length;
    var got = 0;
    for (var i = 0; i < D.treasures.length; i++) {
      if (data.collected && data.collected[D.treasures[i].id]) got++;
    }
    return {
      side: got,
      sideTotal: total,
      pct: total ? Math.round((got / total) * 100) : 0,
    };
  }

  CT.Save = {
    VERSION: VERSION,
    SLOTS: SLOTS,
    AUTO_SLOT: AUTO_SLOT,
    newSave: newSave,
    load: load,
    save: save,
    remove: remove,
    completion: completion,
    list: function () {
      var out = [];
      for (var i = 1; i <= SLOTS; i++) out.push(load(i));
      out.push(load(AUTO_SLOT));
      return out;
    },
    storageAvailable: function () { return STORAGE_OK; },
  };
})();
