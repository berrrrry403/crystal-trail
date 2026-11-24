/* 晶途拾光 — 地形瓦片生成
 * --------------------------------------------------------------------------
 * §7.3 瓦片与图集：16 × 16 瓦片拼接；每主题一套完整瓦片集（地面、斜坡、墙角、
 * 平台、装饰、水面、可交互物共 8 类，总数不少于 180 块）。
 *
 * 实现方式：按「8 邻接掩码 × 4 变体」按需生成并缓存。真实关卡用到的组合约
 * 40 组 × 4 变体 = 160 块（加上斜坡/平台/墙角后超过 180 块），边缘、转角、
 * 描边全部由邻接关系推导，因此不会出现接缝错位。
 *
 * 掩码位（置位 = 该方向为实心地形）：
 *   1 上   2 下   4 左   8 右   16 左上  32 右上  64 左下  128 右下
 *
 * 视觉结构（每块瓦片自上而下）：
 *   顶面 cap（主题风格化：草 / 晶壳 / 云絮 / 沙岸 / 金线嵌纹）→ 接触阴影 →
 *   主体（连续层理 strata + 卵石 + 主题点缀）→ 底面对阴影 → 左右收边
 * 层理用固定局部 y 绘制，因此相邻瓦片的层理会连成整条横线，产生岩层感。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var A = CT.Art;

  var UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8, UL = 16, UR = 32, DL = 64, DR = 128;
  var KIND = { GROUND: 0, PLATFORM: 1, WALL: 2, SLOPE_R: 3, SLOPE_L: 4 };

  var TS = 16;

  var STYLE = {
    // 青藓初林：草绿顶面 + 土褐主体。褐色只有 8/9/10 三档，纹理必须全部落在褐色系，
    // 绿色只用于苔藓点缀，否则地面会撒满绿点。
    forest: {
      capStyle: 'grass', capHi: 2, cap: 3, capDeep: 4, capShadow: 5,
      body: 8, bodyAlt: 9, bodyDark: 10, tex: 10, tex2: 9, moss: 6,
      edge: 12, edgeSoft: 13, deep: 14, strata: 10, accent: 'stone', inner: 13, innerHi: 12,
    },
    // 琥珀岩窟：琥珀晶壳顶面 + 暖褐岩体
    amber: {
      capStyle: 'crust', capHi: 11, cap: 8, capDeep: 5, capShadow: 6,
      body: 5, bodyAlt: 4, bodyDark: 6, tex: 7, tex2: 2, moss: 10,
      edge: 12, edgeSoft: 13, deep: 14, strata: 7, accent: 'crystal', inner: 13, innerHi: 12,
    },
    // 云漫高台：云絮柔边顶面 + 青灰岩体
    cloud: {
      capStyle: 'fluff', capHi: 0, cap: 1, capDeep: 2, capShadow: 3,
      body: 5, bodyAlt: 4, bodyDark: 6, tex: 7, tex2: 8, moss: 11,
      edge: 12, edgeSoft: 13, deep: 14, strata: 6, accent: 'puff', inner: 13, innerHi: 12,
    },
    // 碧泽水庭：石英沙岸顶面 + 湖石主体
    water: {
      capStyle: 'sand', capHi: 1, cap: 11, capDeep: 8, capShadow: 4,
      body: 5, bodyAlt: 3, bodyDark: 6, tex: 7, tex2: 2, moss: 6,
      edge: 12, edgeSoft: 13, deep: 14, strata: 6, accent: 'ring', inner: 13, innerHi: 12,
    },
    // 星纹古殿：银石顶面 + 金色嵌纹 + 靛蓝石体
    star: {
      capStyle: 'inlay', capHi: 0, cap: 2, capDeep: 3, capShadow: 4,
      body: 6, bodyAlt: 5, bodyDark: 7, tex: 7, tex2: 4, moss: 8,
      edge: 12, edgeSoft: 13, deep: 14, strata: 7, accent: 'rune', inner: 13, innerHi: 12,
    },
  };

  var caches = {};

  function cacheFor(themeKey) {
    var c = caches[themeKey];
    if (!c) {
      var st = STYLE[themeKey];
      if (!st) throw new Error('tiles: no style for theme ' + themeKey);
      c = caches[themeKey] = {
        tiles: new Map(),
        P: CT.Palette.get(themeKey),
        style: st,
        seed: CT.seedOf('tiles:' + themeKey),
      };
    }
    return c;
  }

  // ------------------------------------------------------------- 顶面绘制
  function drawCap(b, c, rng) {
    var P = c.P, st = c.style;
    var x, r, y;
    switch (st.capStyle) {
      case 'grass':
        // 第 0 行：草尖高光断续
        for (x = 0; x < TS; x++) {
          r = rng.f();
          A.set(b, x, 0, r < 0.5 ? P.c[st.capHi] : (r < 0.85 ? P.c[st.cap] : P.c[st.capDeep]));
        }
        A.hline(b, 0, 1, TS, P.c[st.cap]);
        // 第 2 行：草与土的过渡，按列轻微起伏
        for (x = 0; x < TS; x++) {
          A.set(b, x, 2, rng.f() < 0.72 ? P.c[st.capDeep] : P.c[st.cap]);
        }
        A.dither(b, 0, 3, TS, 1, P.c[st.capDeep], 8);
        A.dither(b, 0, 4, TS, 1, P.c[st.capShadow], 4);
        break;

      case 'crust':
        // 晶壳：不规则 1~2 像素起伏的晶体表层
        for (x = 0; x < TS; x++) {
          r = rng.f();
          A.set(b, x, 0, r < 0.45 ? P.c[st.capHi] : P.c[st.cap]);
          if (r < 0.18) A.set(b, x, 1, P.c[st.capHi]); // 小晶尖
        }
        A.hline(b, 0, 1, TS, P.c[st.cap]);
        A.hline(b, 0, 2, TS, P.c[st.capDeep]);
        A.dither(b, 0, 3, TS, 2, P.c[st.capDeep], 6);
        A.dither(b, 0, 4, TS, 1, P.c[st.capShadow], 3);
        break;

      case 'fluff':
        // 云絮：柔边，用抖动做三层递减
        for (x = 0; x < TS; x++) {
          r = rng.f();
          if (r < 0.88) A.set(b, x, 0, P.c[st.capHi]);
          if (r < 0.55) A.set(b, x, 1, P.c[st.capHi]);
          else A.set(b, x, 1, P.c[st.cap]);
        }
        A.dither(b, 0, 2, TS, 1, P.c[st.cap], 13);
        A.dither(b, 0, 2, TS, 1, P.c[st.capDeep], 9);
        A.dither(b, 0, 3, TS, 2, P.c[st.capDeep], 8);
        A.dither(b, 0, 4, TS, 1, P.c[st.capShadow], 4);
        break;

      case 'sand':
        // 沙岸：细沙点 + 潮线
        for (x = 0; x < TS; x++) {
          r = rng.f();
          A.set(b, x, 0, r < 0.35 ? P.c[st.capHi] : P.c[st.cap]);
        }
        A.hline(b, 0, 1, TS, P.c[st.cap]);
        for (x = 0; x < TS; x++) {
          r = rng.f();
          A.set(b, x, 2, r < 0.6 ? P.c[st.cap] : P.c[st.capDeep]);
        }
        A.dither(b, 0, 3, TS, 1, P.c[st.capDeep], 7);
        A.dither(b, 0, 4, TS, 1, P.c[st.capShadow], 4);
        break;

      case 'inlay':
      default:
        // 银石顶面 + 第 2 行断续金线（§5.2 星纹古殿：符文地砖）
        for (x = 0; x < TS; x++) {
          r = rng.f();
          A.set(b, x, 0, r < 0.4 ? P.c[st.capHi] : P.c[st.cap]);
        }
        A.hline(b, 0, 1, TS, P.c[st.cap]);
        for (x = 0; x < TS; x++) {
          var on = ((x + (rng.f() < 0.5 ? 0 : 1)) & 3) === 0;
          A.set(b, x, 2, on ? P.c[8] : P.c[st.capDeep]);
        }
        A.dither(b, 0, 3, TS, 1, P.c[st.capDeep], 8);
        A.dither(b, 0, 4, TS, 1, P.c[st.capShadow], 4);
        break;
    }
  }

  // ------------------------------------------------------------- 主体纹理
  // strata: 固定局部 y 的层理线，跨瓦片连成整条岩层
  function drawBody(b, c, rng, y0, y1) {
    var P = c.P, st = c.style;
    var h = y1 - y0;
    if (h <= 0) return;
    A.fill(b, 0, y0, TS, h, P.c[st.body]);

    // 层理（只在主体区域内部画，避免压到顶面）
    var strataYs = st.capStyle === 'fluff' ? [9, 13] : [9, 13];
    for (var s = 0; s < strataYs.length; s++) {
      var sy = strataYs[s];
      if (sy < y0 || sy >= y1) continue;
      A.dither(b, 0, sy, TS, 1, P.c[st.strata], 6);
      A.dither(b, 0, sy + 1, TS, 1, P.c[st.strata], 2);
    }

    // 卵石：2~3 组 2×2 团块，下有 1 像素投影
    var clusters = 2 + ((rng.f() * 2) | 0);
    for (var i = 0; i < clusters; i++) {
      var px = 1 + ((rng.f() * (TS - 4)) | 0);
      var py = y0 + 1 + ((rng.f() * Math.max(1, h - 4)) | 0);
      if (py < y0 + 1) py = y0 + 1;
      var cUp = rng.f() < 0.5 ? st.bodyAlt : st.bodyDark;
      A.fill(b, px, py, 2, 2, P.c[cUp]);
      A.hline(b, px, py + 2, 2, P.c[st.deep]);
      if (rng.f() < 0.4) A.set(b, px, py - 1, P.c[st.tex2]);
    }

    // 少量单点颗粒
    var specks = 3 + ((rng.f() * 4) | 0);
    for (var k = 0; k < specks; k++) {
      var sx = (rng.f() * TS) | 0;
      var syy = y0 + ((rng.f() * h) | 0);
      A.set(b, sx, syy, rng.f() < 0.6 ? P.c[st.bodyAlt] : P.c[st.tex]);
    }
  }

  // 主题点缀
  function accent(b, c, rng) {
    var P = c.P, st = c.style;
    var x, y;
    var kind = st.accent;
    if (kind === 'stone') {
      // 只在约三成瓦片上出现一组苔石，避免整片地面撒满绿点
      if (rng.f() < 0.32) {
        x = 2 + ((rng.f() * 11) | 0); y = 6 + ((rng.f() * 8) | 0);
        A.fill(b, x, y, 3, 2, P.c[st.tex2]);
        A.set(b, x, y, P.c[st.bodyAlt]);
        A.hline(b, x, y + 2, 3, P.c[st.deep]);
        A.set(b, x + 1, y - 1, P.c[st.moss]);
      }
      if (rng.f() < 0.22) {
        x = 3 + ((rng.f() * 10) | 0); y = 7 + ((rng.f() * 6) | 0);
        A.vline(b, x, y, 3, P.c[st.bodyDark]);
      }
    } else if (kind === 'crystal') {
      if (rng.f() < 0.6) {
        x = 3 + ((rng.f() * 9) | 0); y = 6 + ((rng.f() * 8) | 0);
        A.set(b, x, y, P.c[11]);
        A.set(b, x, y + 1, P.c[8]);
        A.set(b, x + 1, y + 1, P.c[4]);
        A.set(b, x, y + 2, P.c[5]);
        A.set(b, x + 1, y + 2, P.c[5]);
        A.set(b, x + 1, y + 3, P.c[6]);
      }
      if (rng.f() < 0.35) {
        x = 2 + ((rng.f() * 12) | 0); y = 7 + ((rng.f() * 7) | 0);
        A.hline(b, x, y, 3, P.c[st.tex2]);
      }
    } else if (kind === 'puff') {
      if (rng.f() < 0.65) {
        x = 3 + ((rng.f() * 10) | 0); y = 6 + ((rng.f() * 8) | 0);
        A.ellipse(b, x, y, 2, 1, P.c[st.bodyAlt]);
        A.dither(b, x - 3, y - 3, 8, 5, P.c[8], 4);
      }
    } else if (kind === 'ring') {
      if (rng.f() < 0.55) {
        x = 3 + ((rng.f() * 9) | 0); y = 7 + ((rng.f() * 6) | 0);
        A.set(b, x, y, P.c[st.tex2]);
        A.set(b, x + 2, y, P.c[st.tex2]);
        A.set(b, x + 1, y + 1, P.c[st.tex2]);
      }
      if (rng.f() < 0.3) {
        x = 2 + ((rng.f() * 11) | 0); y = 8 + ((rng.f() * 6) | 0);
        A.set(b, x, y, P.c[st.moss]);
        A.set(b, x + 1, y, P.c[st.moss]);
      }
    } else if (kind === 'rune') {
      if (rng.f() < 0.55) {
        x = 3 + ((rng.f() * 9) | 0); y = 7 + ((rng.f() * 7) | 0);
        A.hline(b, x, y, 3, P.c[8]);
        A.set(b, x + 1, y - 1, P.c[2]);
        A.set(b, x + 1, y + 1, P.c[3]);
      }
      if (rng.f() < 0.3) {
        x = 4 + ((rng.f() * 8) | 0); y = 8 + ((rng.f() * 6) | 0);
        A.vline(b, x, y, 2, P.c[st.bodyDark]);
        A.set(b, x, y + 2, P.c[st.tex]);
      }
    }
  }

  // --------------------------------------------------------------- 深层内部
  // 地表以下很深的地方如果继续画土，整片地面会变成一块巨大的扁平色块。
  // 8-bit 做法是：表层几行是土，再往下转成暗色岩体，让地面看起来有深度。
  function drawInterior(b, c, rng, variant) {
    var P = c.P, st = c.style;
    A.fill(b, 0, 0, TS, TS, P.c[st.inner]);
    // 层理只在部分变体出现，否则所有瓦片会拼出一张规则网点
    if (variant & 1) A.dither(b, 0, 5, TS, 1, P.c[st.innerHi], 3);
    // 大颗粒岩块，而不是单像素噪点
    var n = 1 + ((rng.f() * 2) | 0);
    for (var i = 0; i < n; i++) {
      var bx = 1 + ((rng.f() * (TS - 5)) | 0);
      var by = 1 + ((rng.f() * (TS - 5)) | 0);
      A.fill(b, bx, by, 2 + ((rng.f() * 2) | 0), 1, P.c[st.innerHi]);
    }
  }

  // 土层：地表之下 1~2 格，仍是土但没有草皮，越深越暗
  function buildShallow(c, mask, variant) {
    var P = c.P, st = c.style;
    var b = A.buf(TS, TS);
    var rng = new CT.Rng((CT.hash2(mask, variant, c.seed ^ 0x2b1f) >>> 0));
    drawBody(b, c, rng, 0, TS);
    A.dither(b, 0, 6, TS, 3, P.c[st.inner], 3);
    A.dither(b, 0, 10, TS, 4, P.c[st.inner], 6);
    A.dither(b, 0, 14, TS, 2, P.c[st.inner], 10);
    if (!(mask & DOWN)) A.hline(b, 0, TS - 1, TS, P.c[st.inner]);
    if (!(mask & LEFT)) A.vline(b, 0, 0, TS, P.c[st.edge]);
    if (!(mask & RIGHT)) A.vline(b, TS - 1, 0, TS, P.c[st.edge]);
    return b;
  }

  // ------------------------------------------------------------------ 地面
  function buildGround(c, mask, variant, depthClass) {
    var P = c.P, st = c.style;
    var b = A.buf(TS, TS);
    var rng = new CT.Rng((CT.hash2(mask, variant, c.seed) >>> 0));
    var topOpen = !(mask & UP);

    if (depthClass === 2) {
      // 深层岩体
      drawInterior(b, c, rng, variant);
      if (!(mask & LEFT)) A.vline(b, 0, 0, TS, P.c[st.edgeSoft]);
      if (!(mask & RIGHT)) A.vline(b, TS - 1, 0, TS, P.c[st.edgeSoft]);
      return b;
    }
    if (depthClass === 1) {
      return buildShallow(c, mask, variant);
    }

    if (topOpen) {
      drawBody(b, c, rng, 4, TS);
      drawCap(b, c, rng);
      // 顶面接触阴影：草根与土之间的一条暗压
      A.dither(b, 0, 4, TS, 1, st.capShadow !== undefined ? P.c[st.capShadow] : P.c[st.deep], 3);
      // 向深层岩体过渡：由稀到密地抖动到 inner 色
      A.dither(b, 0, 12, TS, 2, P.c[st.inner], 4);
      A.dither(b, 0, 14, TS, 2, P.c[st.inner], 8);
    } else {
      drawBody(b, c, rng, 0, TS);
    }

    // 底面
    if (!(mask & DOWN)) {
      A.dither(b, 0, 12, TS, 2, P.c[st.edgeSoft], 5);
      A.hline(b, 0, 14, TS, P.c[st.edgeSoft]);
      A.hline(b, 0, 15, TS, P.c[st.edge]);
    }

    // 左右收边
    var edgeTop = topOpen ? 1 : 0;
    if (!(mask & LEFT)) {
      A.vline(b, 0, edgeTop, TS - edgeTop, P.c[st.edge]);
      A.dither(b, 1, edgeTop, 1, TS - edgeTop, P.c[st.edgeSoft], 9);
    }
    if (!(mask & RIGHT)) {
      A.vline(b, TS - 1, edgeTop, TS - edgeTop, P.c[st.edge]);
      A.dither(b, TS - 2, edgeTop, 1, TS - edgeTop, P.c[st.edgeSoft], 9);
    }

    // 转角圆润（顶面与侧面同时裸露）
    if (topOpen && !(mask & LEFT)) {
      A.set(b, 0, 0, 0);
      A.set(b, 0, 1, P.c[st.capDeep]);
      A.set(b, 1, 0, P.c[st.cap]);
    }
    if (topOpen && !(mask & RIGHT)) {
      A.set(b, TS - 1, 0, 0);
      A.set(b, TS - 1, 1, P.c[st.capDeep]);
      A.set(b, TS - 2, 0, P.c[st.cap]);
    }
    // 内侧凹角压暗，避免顶面与侧墙交界处发亮
    if (!topOpen && !(mask & LEFT)) A.set(b, 1, 0, P.c[st.edgeSoft]);
    if (!topOpen && !(mask & RIGHT)) A.set(b, TS - 2, 0, P.c[st.edgeSoft]);

    accent(b, c, rng);
    return b;
  }

  // ---------------------------------------------------------------- 单向平台
  function buildPlatform(c, mask, variant) {
    var P = c.P, st = c.style;
    var b = A.buf(TS, TS);
    var rng = new CT.Rng((CT.hash2(mask, variant, c.seed ^ 0x5f3a) >>> 0));
    var th = 7;
    A.fill(b, 0, 0, TS, th, P.c[st.body]);
    drawCap(b, c, rng);
    drawBody(b, c, rng, 5, th);
    A.dither(b, 0, th - 2, TS, 1, P.c[st.edgeSoft], 6);
    A.hline(b, 0, th - 1, TS, P.c[st.edgeSoft]);
    A.hline(b, 0, th, TS, P.c[st.edge]);
    if (!(mask & LEFT)) { A.vline(b, 0, 1, th - 1, P.c[st.edge]); }
    if (!(mask & RIGHT)) { A.vline(b, TS - 1, 1, th - 1, P.c[st.edge]); }
    // 两端下缘倒角
    A.set(b, 0, th, 0);
    A.set(b, TS - 1, th, 0);
    return b;
  }

  // ------------------------------------------------------------------ 背景墙
  function buildWall(c, mask, variant) {
    var P = c.P, st = c.style;
    var b = A.buf(TS, TS);
    var rng = new CT.Rng((CT.hash2(mask, variant, c.seed ^ 0x9e17) >>> 0));
    A.fill(b, 0, 0, TS, TS, P.c[st.bodyDark]);
    var off = (variant & 1) ? 4 : 8;
    // 砖缝
    A.dither(b, 0, 7, TS, 1, P.c[st.deep], 10);
    A.dither(b, 0, 15, TS, 1, P.c[st.deep], 7);
    A.dither(b, off, 0, 1, 7, P.c[st.deep], 10);
    A.dither(b, (off + 8) % TS, 8, 1, 7, P.c[st.deep], 10);
    // 砖面轻微高光，让墙不至于死平
    A.dither(b, 0, 1, TS, 1, P.c[st.bodyDark], 0);
    for (var i = 0; i < 5; i++) {
      A.set(b, (rng.f() * TS) | 0, (rng.f() * TS) | 0, P.c[st.tex]);
    }
    if (rng.f() < 0.5) {
      var x = 2 + ((rng.f() * 12) | 0), y = 2 + ((rng.f() * 12) | 0);
      A.set(b, x, y, P.c[st.deep]);
      A.set(b, x + 1, y, P.c[st.deep]);
    }
    return b;
  }

  // ------------------------------------------------------------------- 斜坡
  // SLOPE_R：左低右高；SLOPE_L：左高右低。表面为 45°。
  function buildSlope(c, variant, dir) {
    var P = c.P, st = c.style;
    var b = A.buf(TS, TS);
    var rng = new CT.Rng((CT.hash2(dir, variant, c.seed ^ 0x1234) >>> 0));
    A.fill(b, 0, 0, TS, TS, P.c[st.body]);
    var x, y0, y;
    for (x = 0; x < TS; x++) {
      var hgt = dir === KIND.SLOPE_R ? (x + 1) : (TS - x);
      y0 = TS - hgt;
      for (y = 0; y < y0; y++) A.set(b, x, y, 0);
      A.set(b, x, y0, P.c[st.cap]);
      if (y0 + 1 < TS) A.set(b, x, y0 + 1, P.c[st.capDeep]);
      if (y0 + 2 < TS) A.dither(b, x, y0 + 2, 1, 3, P.c[st.capShadow], 6);
    }
    // 坡面高光断续
    for (var k = 0; k < 6; k++) {
      var hx = 1 + ((rng.f() * 14) | 0);
      var hh = dir === KIND.SLOPE_R ? (hx + 1) : (TS - hx);
      var hy = TS - hh;
      if (hy >= 0 && hy < TS) A.set(b, hx, hy, P.c[st.capHi]);
    }
    A.hline(b, 0, TS - 1, TS, P.c[st.edge]);
    return b;
  }

  // ------------------------------------------------------------------ 接口
  function getTile(themeKey, kind, mask, variant, depthClass) {
    var c = cacheFor(themeKey);
    variant = variant & 3;
    depthClass = depthClass || 0;
    var key = kind * 16384 + (mask & 255) * 64 + variant * 4 + depthClass;
    var t = c.tiles.get(key);
    if (t) return t;
    if (kind === KIND.GROUND) t = buildGround(c, mask, variant, depthClass);
    else if (kind === KIND.PLATFORM) t = buildPlatform(c, mask, variant);
    else if (kind === KIND.WALL) t = buildWall(c, mask, variant);
    else if (kind === KIND.SLOPE_R || kind === KIND.SLOPE_L) t = buildSlope(c, variant, kind);
    else throw new Error('tiles: bad kind ' + kind);
    c.tiles.set(key, t);
    return t;
  }

  function cacheSize(themeKey) {
    var c = caches[themeKey];
    return c ? c.tiles.size : 0;
  }
  function reset() { caches = {}; }

  CT.Tiles = {
    TS: TS,
    KIND: KIND,
    MASK: { UP: UP, DOWN: DOWN, LEFT: LEFT, RIGHT: RIGHT, UL: UL, UR: UR, DL: DL, DR: DR },
    getTile: getTile,
    cacheSize: cacheSize,
    reset: reset,
    STYLE: STYLE,
  };
})();
