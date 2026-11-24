/* 晶途拾光 — 调色板
 * --------------------------------------------------------------------------
 * §7.2 调色板规则
 *   · 每个主题独立一张 16 色主调色板：4 色亮部、8 色中间色、3 色暗部、1 色自发光高光
 *   · 全局公共色板 32 色，用于主角、UI、通用特效
 *   · 任何单张瓦片集不得超过 24 色
 *   · 渐变只用抖动实现：两色之间用 50% 棋盘抖动过渡
 *   · 透明度只允许 0%、50%、100% 三档
 *
 * 16 个槽位的语义在五个主题间固定，美术代码因此可以只写 P.c[M2] 而不关心
 * 具体是哪个主题。色数上限由数据结构本身保证 —— 索引越界即报错。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  function packHex(hex) {
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  // 固定槽位语义
  var SLOT = {
    L0: 0, L1: 1, L2: 2, L3: 3,     // 亮部 4 色
    M0: 4, M1: 5, M2: 6, M3: 7,     // 中间色 8 色
    M4: 8, M5: 9, M6: 10, M7: 11,
    D0: 12, D1: 13, D2: 14,         // 暗部 3 色
    E: 15,                          // 自发光高光 1 色
  };

  /*
   * 槽位用途说明（五个主题一致）：
   *  L0 地形顶面高光   L1 地形顶面     L2 装饰亮部/云     L3 柔和亮部
   *  M0 地形主体亮     M1 地形主体     M2 地形阴影/纹理   M3 装饰主色
   *  M4 装饰次色(木/沙/土)  M5 装饰暗部   M6 远景层色      M7 石/结构色
   *  D0 暗部           D1 深暗         D2 最深(描边)
   *  E  自发光高光（彩晶、萤灵、琥珀、星尘）
   */

  var THEME_HEX = {
    // 1 青藓初林：草绿、浅棕、米白、淡青（低饱和）
    forest: [
      '#F1F6DF', '#DAE7BC', '#C0D7A2', '#A2C287',
      '#84A86C', '#6B9557', '#547E48', '#42663C',
      '#8E7448', '#745B36', '#57442A', '#6E8578',
      '#33472C', '#24331F', '#172115',
      '#F2F59A',
    ],
    // 2 琥珀岩窟：暖橙、土黄、暗赭、琥珀黄
    amber: [
      '#FFEBCC', '#F7CF97', '#E4AE68', '#CB8C49',
      '#AC7031', '#8D5827', '#70461F', '#573419',
      '#DCAE55', '#B67F33', '#7D3F1E', '#E9C673',
      '#3E2413', '#2C1A0E', '#1C1008',
      '#FFD98A',
    ],
    // 3 云漫高台：浅天蓝、奶白、淡紫、浅灰
    cloud: [
      '#FBFDFF', '#E9F3FB', '#D4E5F4', '#B8D0E7',
      '#98B6D5', '#7F9CBF', '#6681A9', '#51698F',
      '#B7ABD1', '#978AB7', '#7B6F9B', '#C9D7E1',
      '#3D4F6B', '#2B384F', '#1B2434',
      '#FFF6C9',
    ],
    // 4 碧泽水庭：湖蓝、水绿、珍珠白、浅沙
    water: [
      '#F4FCF9', '#D6EFEA', '#AEDDD9', '#83C6C6',
      '#5CAAB1', '#458A92', '#356F77', '#285760',
      '#93D4AC', '#72B792', '#55987A', '#DACFA9',
      '#1F454C', '#163135', '#0D1F22',
      '#B8FBE4',
    ],
    // 5 星纹古殿：暗靛蓝、银白、淡金
    star: [
      '#F4F6FC', '#D6DCF0', '#B2BBDE', '#8E97C7',
      '#6F77A9', '#585F8D', '#454B71', '#353A5A',
      '#CDB97B', '#AB995E', '#877742', '#7D85B8',
      '#232745', '#181B33', '#0E1022',
      '#E8E0FF',
    ],
  };

  // 主题专属的氛围色（远景天空与主题强调），仍从 16 色板内部取值
  var THEME_META = {
    forest: { key: 'forest', name: '青藓初林', index: 1, skyTop: 2, skyBot: 3, accent: 15 },
    amber: { key: 'amber', name: '琥珀岩窟', index: 2, skyTop: 13, skyBot: 14, accent: 15 },
    cloud: { key: 'cloud', name: '云漫高台', index: 3, skyTop: 1, skyBot: 3, accent: 15 },
    water: { key: 'water', name: '碧泽水庭', index: 4, skyTop: 2, skyBot: 4, accent: 15 },
    star: { key: 'star', name: '星纹古殿', index: 5, skyTop: 13, skyBot: 14, accent: 15 },
  };

  // §7.2 全局公共色板 32 色
  var GLOBAL_HEX = [
    '#FFFFFF', // 0  白
    '#E6E9F2', // 1  浅灰
    '#B9C0D4', // 2  中灰
    '#7C86A0', // 3  深灰
    '#3D4460', // 4  暗灰
    '#161A28', // 5  描边最深

    '#F4F1E2', // 6  米白兜帽
    '#DCD6C0', // 7
    '#B5AB92', // 8
    '#9CC4BE', // 9  浅青上衣
    '#7EA6A0', // 10
    '#5E827E', // 11
    '#7E6A44', // 12 深卡其短裤
    '#635236', // 13
    '#4A3D28', // 14
    '#8A5E36', // 15 棕色短靴
    '#6B4526', // 16
    '#4E311A', // 17
    '#E8C39A', // 18 肤色
    '#C79C74', // 19 肤色暗
    '#1E2333', // 20 UI 面板底
    '#C7D2E8', // 21 UI 面板亮边
    '#141827', // 22 UI 面板暗边
    '#F2F4FB', // 23 UI 文字亮
    '#AAB4CE', // 24 UI 文字暗
    '#F2D98A', // 25 UI 强调/光标
    '#F6D06A', // 26 金（宝物）
    '#FFF3CF', // 27 暖白
    '#E8A0B8', // 28 粉
    '#8FD8E0', // 29 青
    '#8FCB9B', // 30 绿
    '#2A2140', // 31 阴影紫
  ];

  var G = {
    WHITE: 0, LIGHT: 1, MID: 2, DARK: 3, DARKER: 4, OUTLINE: 5,
    HOOD: 6, HOOD_M: 7, HOOD_D: 8,
    SHIRT: 9, SHIRT_M: 10, SHIRT_D: 11,
    PANTS: 12, PANTS_M: 13, PANTS_D: 14,
    BOOT: 15, BOOT_M: 16, BOOT_D: 17,
    SKIN: 18, SKIN_D: 19,
    PANEL: 20, PANEL_HI: 21, PANEL_LO: 22, TEXT: 23, TEXT_DIM: 24, ACCENT: 25,
    GOLD: 26, WARM: 27, PINK: 28, CYAN: 29, GREEN: 30, SHADE: 31,
  };

  function makeTheme(key) {
    var hex = THEME_HEX[key];
    if (!hex) throw new Error('palette: unknown theme ' + key);
    if (hex.length !== 16) throw new Error('palette: ' + key + ' must have exactly 16 colours');
    var c = hex.map(packHex);
    var t = {
      key: key,
      hex: hex,
      c: c,
      meta: THEME_META[key],
      slot: SLOT,
      // 常用快捷访问
      L0: c[0], L1: c[1], L2: c[2], L3: c[3],
      M0: c[4], M1: c[5], M2: c[6], M3: c[7],
      M4: c[8], M5: c[9], M6: c[10], M7: c[11],
      D0: c[12], D1: c[13], D2: c[14], E: c[15],
    };
    return t;
  }

  var cache = {};
  function get(key) {
    if (!cache[key]) cache[key] = makeTheme(key);
    return cache[key];
  }

  var globalPacked = GLOBAL_HEX.map(packHex);

  CT.Palette = {
    SLOT: SLOT,
    G: G,
    themes: THEME_HEX,
    meta: THEME_META,
    get: get,
    global: globalPacked,
    gc: function (slot) { return globalPacked[slot]; },
    packHex: packHex,
    THEME_KEYS: ['forest', 'amber', 'cloud', 'water', 'star'],
  };
  // 便捷全局色
  for (var k in G) CT.Palette[k] = globalPacked[G[k]];
})();
