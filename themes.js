/* 晶途拾光 — 主题定义
 * --------------------------------------------------------------------------
 * §5.2 五个主题场景：每换一个主题，调色板、瓦片集、装饰物、机关类型、背景音乐
 * 必须整套更换，只保留主角与 UI 框架不变。
 * §5.1 25 个关卡按 5 个主题单元组织，每个单元固定 5 关。
 * §5.5 难度曲线：前两个主题跳跃容错宽度不小于 3 格；第三个主题起降到 2 格。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var THEMES = [
    {
      key: 'forest', index: 1, name: '青藓初林',
      levels: ['苔径初见', '溪畔折枝', '树洞回响', '蕨影深处', '林心守望'],
      npcs: ['firefly', 'guide'],
      // 表 5-2：踩压开关、浮动树叶平台；表 4-3 首现：踩压开关
      mechs: ['pressure_switch'],
      bgm: 'forest',
      // 表 5-5：前两个主题只要求看懂规则，跳跃容错不小于 3 格
      difficulty: { maxGap: 3, maxStepUp: 2, minEdgeMargin: 3, mechGroups: [3, 3, 4, 4, 4] },
      crystal: 'crystal-forest',
      guardian: 'elder',
    },
    {
      key: 'amber', index: 2, name: '琥珀岩窟',
      levels: ['洞口微光', '石乳低廊', '晶簇岔道', '灼灼深层', '守窟之试'],
      npcs: ['elder', 'guide'],
      // 表 5-2：光路方块、时序踏板
      mechs: ['pressure_switch', 'light_beam', 'sequence_pads'],
      bgm: 'amber',
      difficulty: { maxGap: 3, maxStepUp: 2, minEdgeMargin: 3, mechGroups: [3, 4, 5, 5, 5] },
      crystal: 'crystal-amber',
      guardian: 'elder',
    },
    {
      key: 'cloud', index: 3, name: '云漫高台',
      levels: ['云阶初升', '断桥风起', '浮岛花圃', '高台回廊', '云心守望'],
      npcs: ['messenger', 'guide'],
      // 表 5-2：风场推力、浮台
      mechs: ['pressure_switch', 'light_beam', 'wind'],
      bgm: 'cloud',
      difficulty: { maxGap: 3, maxStepUp: 2, minEdgeMargin: 2, mechGroups: [3, 4, 5, 6, 5] },
      crystal: 'crystal-cloud',
      guardian: 'messenger',
    },
    {
      key: 'water', index: 4, name: '碧泽水庭',
      levels: ['浅滩石阶', '莲叶回廊', '闸口低语', '水庭深处', '澜光之试'],
      npcs: ['clam', 'guide'],
      // 表 5-2：水流转向、水位升降
      mechs: ['pressure_switch', 'sequence_pads', 'water_flow'],
      bgm: 'water',
      difficulty: { maxGap: 3, maxStepUp: 2, minEdgeMargin: 2, mechGroups: [3, 4, 5, 6, 5] },
      crystal: 'crystal-water',
      guardian: 'clam',
    },
    {
      key: 'star', index: 5, name: '星纹古殿',
      levels: ['殿门星痕', '回廊低光', '符文残壁', '星象中庭', '星核终章'],
      npcs: ['elder', 'guide'],
      // 表 5-2：符文拼图、组合时序；表 5-5：只组合已知机关，难度来自谜题链长度
      mechs: ['light_beam', 'sequence_pads', 'rune_puzzle'],
      bgm: 'star',
      difficulty: { maxGap: 3, maxStepUp: 2, minEdgeMargin: 2, mechGroups: [3, 4, 5, 6, 6] },
      crystal: 'crystal-star',
      guardian: 'elder',
    },
  ];

  var byKey = {};
  var byLevel = {};
  THEMES.forEach(function (t) {
    byKey[t.key] = t;
    t.levels.forEach(function (name, i) {
      byLevel[t.key + '-' + String(i + 1).padStart(2, '0')] = {
        theme: t, index: i + 1, name: name,
      };
    });
  });

  // 关卡线性顺序（§5.1：25 关，5 单元 × 5 关）
  var ORDER = [];
  THEMES.forEach(function (t) {
    for (var i = 1; i <= 5; i++) ORDER.push(t.key + '-' + String(i).padStart(2, '0'));
  });

  var MECH_NAMES = {
    pressure_switch: '踩压开关',
    light_beam: '光路方块',
    sequence_pads: '时序踏板',
    wind: '风场推力',
    water_flow: '水流转向',
    rune_puzzle: '符文拼图',
  };

  function themeOf(levelId) {
    var e = byLevel[levelId];
    return e ? e.theme : null;
  }
  function levelInfo(levelId) { return byLevel[levelId] || null; }
  function nextLevel(levelId) {
    var i = ORDER.indexOf(levelId);
    return i >= 0 && i + 1 < ORDER.length ? ORDER[i + 1] : null;
  }

  CT.Themes = {
    LIST: THEMES,
    byKey: byKey,
    byLevel: byLevel,
    ORDER: ORDER,
    MECH_NAMES: MECH_NAMES,
    get: function (k) { return byKey[k]; },
    themeOf: themeOf,
    levelInfo: levelInfo,
    nextLevel: nextLevel,
  };
})();
