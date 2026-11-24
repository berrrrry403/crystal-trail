/* 晶途拾光 — 三层视差背景
 * --------------------------------------------------------------------------
 * §5.4 视差背景三层：
 *   远层 2 至 4 色的山形或云层剪影          —— 跟随镜头 0.15
 *   中层 主题建筑或植被轮廓                  —— 跟随镜头 0.35
 *   近层 半透明枝叶或光斑                    —— 跟随镜头 0.60
 *
 * 每层是一条水平可无缝循环的条带（2~4 屏宽）。高度场由整周期正弦叠加而成，
 * 因此条带首尾天然连续，循环时看不到接缝。
 *
 * 远层刻意分成两重山脊（较亮的远景 + 稍暗的近景），用大气透视拉开纵深；
 * 抖动只用于山脊下方数像素的过渡，不做整片抖动，否则会变成「布纹」。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var A = CT.Art;

  // 逻辑分辨率不再是常量，跟随 CT.View（窗口变大时视野变大）
  function curVW() { return (CT.View && CT.View.VW) || 480; }
  function curVH() { return (CT.View && CT.View.VH) || 270; }
  var FACTOR = { far: 0.15, mid: 0.35, near: 0.60 };

  // 天空竖直渐变（上 -> 地平线），取值全部来自主题 16 色板
  var SKY = {
    forest: { top: 2, bot: 1 },
    amber: { top: 13, bot: 5 },
    cloud: { top: 2, bot: 0 },
    water: { top: 3, bot: 1 },
    star: { top: 14, bot: 6 },
  };

  // 远层配色：[远脊亮色, 近脊暗色, 脊线高光, 脊下过渡]
  var FAR = {
    forest: { a: 3, b: 5, rim: 2, body: 5 },
    amber: { a: 6, b: 12, rim: 8, body: 13 },
    cloud: { a: 2, b: 4, rim: 0, body: 4 },
    water: { a: 2, b: 4, rim: 1, body: 4 },
    star: { a: 11, b: 12, rim: 8, body: 12 },
  };

  // 中层配色：[主体, 暗部, 高光]
  var MID = {
    forest: { main: 6, dark: 12, rim: 3 },
    amber: { main: 6, dark: 13, rim: 8 },
    cloud: { main: 4, dark: 12, rim: 1 },
    water: { main: 6, dark: 13, rim: 2 },
    star: { main: 11, dark: 13, rim: 8 },
  };

  var caches = {};

  function mod(v, n) { return ((v % n) + n) % n; }

  // 整周期高度场：所有分量周期都能整除 LW，首尾完全连续
  function makeHeight(rng, LW, base, comps) {
    var hs = new Float32Array(LW);
    var terms = [];
    for (var i = 0; i < comps; i++) {
      terms.push({
        k: 1 + i * 3,
        a: 10 + rng.f() * 22,
        p: rng.f() * Math.PI * 2,
      });
    }
    for (var x = 0; x < LW; x++) {
      var v = base;
      for (var t = 0; t < terms.length; t++) {
        v += Math.sin((Math.PI * 2 * terms[t].k * x) / LW + terms[t].p) * terms[t].a;
      }
      hs[x] = v;
    }
    return hs;
  }

  function wrapBlit(b, obj, x, y) {
    A.blit(b, mod(x, b.w), y, obj);
    if (mod(x, b.w) + obj.w > b.w) A.blit(b, mod(x, b.w) - b.w, y, obj);
  }

  // ---------------------------------------------------------------- 天空
  function buildSky(P, key) {
    var cfg = SKY[key];
    var top = P.c[cfg.top], bot = P.c[cfg.bot];
    var b = A.buf(curVW(), curVH());
    for (var y = 0; y < curVH(); y++) {
      // 竖直两色抖动过渡（§7.2 渐变只用抖动实现），过渡集中在 25%~75% 高度
      var t = (y / (curVH() - 1) - 0.22) / 0.62;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      t = t * t * (3 - 2 * t); // smoothstep，让两端更干净
      var lv = Math.round(t * 16);
      var row = y * curVW();
      for (var x = 0; x < curVW(); x++) {
        var d = CT.BAYER4[(y & 3) * 4 + (x & 3)];
        b.d[row + x] = d < lv ? bot : top;
      }
    }
    return b;
  }

  // ------------------------------------------------------------- 远层
  function ridge(b, LW, hs, col, rim, bodyCol) {
    var x, y;
    for (x = 0; x < LW; x++) {
      var top = Math.round(hs[x]);
      if (top < 0) top = 0;
      for (y = top; y < curVH(); y++) b.d[y * LW + x] = col;
      b.d[top * LW + x] = rim;                       // 脊线高光 1 像素
      // 脊下 4 像素做过渡抖动（硬切 1 像素，其余抖动），避免「布纹」
      for (y = top + 1; y < top + 5 && y < curVH(); y++) {
        var lv = 10 - (y - top) * 2;
        if (lv > 0 && CT.BAYER4[(y & 3) * 4 + (x & 3)] < lv) b.d[y * LW + x] = rim;
      }
      // 体部极轻纹理，只出现在山体内部
      for (y = top + 6; y < curVH(); y += 1) {
        if (CT.BAYER4[(y & 3) * 4 + (x & 3)] < 2) b.d[y * LW + x] = bodyCol;
      }
    }
  }

  function buildFar(P, key) {
    var LW = 960;
    var b = A.buf(LW, curVH());
    var rng = new CT.Rng(CT.seedOf('far:' + key));
    var cfg = FAR[key];

    // 后一重山：位置更高、颜色更接近天空（大气透视）
    var hsBack = makeHeight(rng, LW, 132, 2);
    ridge(b, LW, hsBack, P.c[cfg.a], P.c[cfg.rim], P.c[cfg.a]);

    // 前一重山：更低、更暗
    var hsFront = makeHeight(rng, LW, 168, 3);
    ridge(b, LW, hsFront, P.c[cfg.b], P.c[cfg.rim], P.c[cfg.body]);

    var i, obj, x0;
    if (key === 'cloud') {
      // 云海：远层加几团松软云块
      for (i = 0; i < 10; i++) {
        var cw = 54 + ((rng.f() * 70) | 0), ch = 14 + ((rng.f() * 10) | 0);
        obj = A.buf(cw, ch);
        A.ellipse(obj, cw / 2 | 0, ch / 2 | 0, cw / 2, ch / 2, P.c[0]);
        A.dither(obj, 0, (ch >> 1), cw, ch >> 1, P.c[2], 5);
        wrapBlit(b, obj, (rng.f() * LW) | 0, 96 + ((rng.f() * 60) | 0));
      }
    } else if (key === 'star') {
      // 远景殿门拱
      for (i = 0; i < 6; i++) {
        x0 = (i * LW) / 6 + rng.f() * 40;
        obj = A.buf(28, 54);
        A.fill(obj, 0, 10, 28, 44, P.c[cfg.b]);
        A.fill(obj, 4, 16, 20, 38, 0);
        A.ellipse(obj, 14, 16, 10, 9, P.c[cfg.b]);
        A.fill(obj, 4, 16, 20, 38, 0);
        A.rect(obj, 4, 13, 20, 1, P.c[cfg.rim]);
        A.fill(obj, 0, 8, 28, 2, P.c[cfg.rim]);
        wrapBlit(b, obj, x0 | 0, 104);
      }
    } else if (key === 'forest') {
      // 远树冠轮廓，压在两道山脊之上
      for (i = 0; i < 18; i++) {
        var tw = 34 + ((rng.f() * 30) | 0), th = 20 + ((rng.f() * 14) | 0);
        obj = A.buf(tw, th);
        A.ellipse(obj, tw >> 1, th >> 1, tw >> 1, th >> 1, P.c[cfg.b]);
        A.ellipse(obj, (tw >> 1) - 5, (th >> 1) - 3, tw >> 2, th >> 2, P.c[cfg.rim]);
        wrapBlit(b, obj, (rng.f() * LW) | 0, 128 + ((rng.f() * 34) | 0));
      }
    } else if (key === 'amber') {
      // 洞顶垂石
      for (i = 0; i < 26; i++) {
        var w2 = 4 + ((rng.f() * 8) | 0), h2 = 12 + ((rng.f() * 30) | 0);
        obj = A.buf(w2, h2);
        for (var yy = 0; yy < h2; yy++) {
          var ww = Math.max(1, Math.round(w2 * (1 - yy / h2)));
          A.fill(obj, (w2 - ww) >> 1, yy, ww, 1, P.c[cfg.b]);
        }
        wrapBlit(b, obj, (rng.f() * LW) | 0, 0);
      }
    } else {
      // 水面横纹
      for (i = 0; i < 6; i++) A.dither(b, 0, 190 + i * 11, LW, 2, P.c[cfg.a], 4);
    }
    return b;
  }

  // ------------------------------------------------------------- 中层
  function buildMid(P, key) {
    var LW = 1440;   // 3 屏宽，与 480 视口成整除关系
    var b = A.buf(LW, curVH());
    var rng = new CT.Rng(CT.seedOf('mid:' + key));
    var cfg = MID[key];
    var main = P.c[cfg.main], dark = P.c[cfg.dark], rim = P.c[cfg.rim];
    var i, x0, obj, w, h;

    if (key === 'forest') {
      for (i = 0; i < 8; i++) {
        x0 = (i * LW) / 8 + rng.f() * 80;
        w = 9 + ((rng.f() * 5) | 0);          // 树干根宽
        h = 120 + ((rng.f() * 70) | 0);
        var cw = w + 56;                       // 画布要容得下树冠
        obj = A.buf(cw, h + 60);
        var cx = cw >> 1;
        // 树干：下宽上窄，左侧一条背光面
        for (var ty = 40; ty < 40 + h; ty++) {
          var tt = (ty - 40) / h;
          var tw2 = Math.max(3, Math.round(w * (1 - tt * 0.42)));
          A.fill(obj, cx - (tw2 >> 1), ty, tw2, 1, main);
          A.fill(obj, cx - (tw2 >> 1), ty, 1, 1, dark);
        }
        // 侧枝
        A.fill(obj, cx - 17, 76, 15, 3, main);
        A.fill(obj, cx + 3, 100, 15, 3, main);
        A.fill(obj, cx - 17, 76, 3, 2, dark);
        // 树冠：多团椭圆叠加，外形不规则才不像蘑菇
        A.ellipse(obj, cx, 26, 30, 20, main);
        A.ellipse(obj, cx - 21, 35, 15, 12, main);
        A.ellipse(obj, cx + 21, 33, 14, 11, main);
        A.ellipse(obj, cx - 8, 13, 16, 11, main);
        A.ellipse(obj, cx + 11, 19, 13, 10, main);
        // 受光顶面（左上受光）
        A.ellipse(obj, cx - 10, 13, 12, 7, rim);
        A.ellipse(obj, cx + 6, 21, 8, 5, rim);
        // 暗调：底部实压，边缘抖动过渡
        A.dither(obj, 0, 40, cw, 16, dark, 6);
        A.dither(obj, 0, 22, cw, 20, dark, 2);
        wrapBlit(b, obj, x0 | 0, 84 + ((rng.f() * 22) | 0));
      }
    } else if (key === 'amber') {
      for (i = 0; i < 13; i++) {
        x0 = (i * LW) / 13 + rng.f() * 50;
        w = 14 + ((rng.f() * 18) | 0);
        h = 60 + ((rng.f() * 90) | 0);
        obj = A.buf(w, h);
        for (var yy = 0; yy < h; yy++) {
          var ww = Math.max(2, Math.round(w * (yy / h)));
          A.fill(obj, (w - ww) >> 1, yy, ww, 1, yy < 8 ? dark : main);
        }
        A.fill(obj, (w >> 1) - 1, 0, 2, h, dark);
        A.dither(obj, 0, 0, w, h, rim, 2);
        wrapBlit(b, obj, x0 | 0, curVH() - h - 8);
      }
    } else if (key === 'cloud') {
      for (i = 0; i < 7; i++) {
        x0 = (i * LW) / 7 + rng.f() * 60;
        w = 70 + ((rng.f() * 50) | 0);
        h = 70 + ((rng.f() * 40) | 0);
        obj = A.buf(w, h);
        A.ellipse(obj, w >> 1, 12, w >> 1, 12, rim);         // 顶面云被
        A.fill(obj, 2, 12, w - 4, h - 12, main);
        for (var y2 = 12; y2 < h; y2++) {                    // 岛体收成锥形
          var t2 = (y2 - 12) / (h - 12);
          var ww2 = Math.round((w - 4) * (1 - t2 * 0.9));
          var l2 = (w - ww2) >> 1;
          A.fill(obj, 0, y2, w, 1, 0);
          A.fill(obj, l2, y2, ww2, 1, main);
        }
        A.dither(obj, 0, 12, w, 10, dark, 4);
        wrapBlit(b, obj, x0 | 0, 104 + ((rng.f() * 24) | 0));
      }
    } else if (key === 'water') {
      for (i = 0; i < 6; i++) {
        x0 = (i * LW) / 6 + rng.f() * 70;
        obj = A.buf(56, 70);
        A.fill(obj, 2, 40, 52, 7, main);                     // 台基
        A.fill(obj, 12, 16, 5, 24, main);                    // 柱
        A.fill(obj, 40, 16, 5, 24, main);
        A.fill(obj, 27, 16, 4, 24, main);
        A.fill(obj, 0, 6, 56, 10, dark);                     // 檐
        A.fill(obj, 4, 12, 48, 4, rim);
        wrapBlit(b, obj, x0 | 0, 122);
      }
    } else {
      for (i = 0; i < 8; i++) {
        x0 = (i * LW) / 8 + rng.f() * 60;
        w = 18 + ((rng.f() * 8) | 0);
        h = 130 + ((rng.f() * 50) | 0);
        obj = A.buf(w, h);
        A.fill(obj, 1, 12, w - 2, h - 12, main);
        A.fill(obj, 1, 12, 2, h - 12, dark);
        A.fill(obj, w - 3, 12, 2, h - 12, dark);
        A.fill(obj, 0, 4, w, 8, dark);
        A.fill(obj, 0, 5, w, 2, rim);
        A.fill(obj, 0, h - 10, w, 10, dark);
        A.dither(obj, 0, 24, w, h - 40, rim, 2);
        wrapBlit(b, obj, x0 | 0, curVH() - h);
      }
    }
    return b;
  }

  // ------------------------------------------------------------- 近层
  function buildNear(P, key) {
    var LW = 1920;   // 4 屏宽
    var b = A.buf(LW, curVH());
    var rng = new CT.Rng(CT.seedOf('near:' + key));
    var ALPHA = 0x80000000; // §7.2 透明度 50% 档
    var fidx;
    if (key === 'forest') fidx = 7;
    else if (key === 'amber') fidx = 7;
    else if (key === 'cloud') fidx = 0;
    else if (key === 'water') fidx = 2;
    else fidx = 2;
    var foliage = (((P.c[fidx] >>> 0) & 0x00ffffff) | ALPHA) >>> 0;
    // 光斑要用亮色，否则落在浅色天空上会变成脏点
    var lightIdx = key === 'amber' ? 0 : (key === 'star' ? 0 : 0);
    var light = (((P.c[lightIdx] >>> 0) & 0x00ffffff) | ALPHA) >>> 0;

    var i, x0, obj, y, len;
    if (key === 'forest' || key === 'water' || key === 'star') {
      // 顶部垂下的枝叶 / 藤蔓（半透明）
      for (i = 0; i < 14; i++) {
        x0 = (rng.f() * LW) | 0;
        len = 26 + ((rng.f() * 54) | 0);
        var W2 = 20;
        obj = A.buf(W2, len);
        var cxx = W2 >> 1;
        for (y = 0; y < len; y++) {
          var sway = Math.round(Math.sin((y / len) * Math.PI * 1.4) * 3);
          var thick = y < len * 0.55 ? 3 : (y < len * 0.8 ? 2 : 1);
          A.fill(obj, cxx + sway - (thick >> 1), y, thick, 1, foliage);
          if (y % 8 < 3) A.fill(obj, cxx + sway - 5, y, 3, 1, foliage);   // 侧叶
          if (y % 8 === 5) A.fill(obj, cxx + sway + 3, y, 3, 1, foliage);
        }
        wrapBlit(b, obj, x0, 0);
      }
    }
    // 光斑与浮游光点：圆形抖动光晕，不能用方形抖动块（会出现方块状亮斑）
    for (i = 0; i < 64; i++) {
      var lx = (rng.f() * LW) | 0;
      var ly = 110 + ((rng.f() * (curVH() - 150)) | 0);
      var r = 1 + ((rng.f() * 2) | 0);
      A.ellipse(b, lx, ly, r, r, light);
      if (rng.f() < 0.4) {
        var halo = 3 + ((rng.f() * 2) | 0);
        for (var oy = -halo; oy <= halo; oy++) {
          for (var ox2 = -halo; ox2 <= halo; ox2++) {
            var dd = ox2 * ox2 + oy * oy;
            if (dd > halo * halo) continue;
            if (CT.BAYER4[(((ly + oy) & 3) * 4) + ((lx + ox2) & 3)] < (dd < (halo * halo) / 2 ? 6 : 3)) {
              A.set(b, lx + ox2, ly + oy, light);
            }
          }
        }
      }
    }
    return b;
  }

  // ---------------------------------------------------------------- 接口
  function build(themeKey) {
    var c = caches[themeKey];
    if (c) return c;
    var P = CT.Palette.get(themeKey);
    c = caches[themeKey] = {
      key: themeKey,
      P: P,
      sky: buildSky(P, themeKey),
      far: buildFar(P, themeKey),
      mid: buildMid(P, themeKey),
      near: buildNear(P, themeKey),
      factor: FACTOR,
    };
    return c;
  }

  function drawLayer(fb, layer, offsetX, blend) {
    var LW = layer.w;
    var ox = mod(offsetX | 0, LW);
    var drawn = 0;
    var vw = curVW(), vh = curVH();
    while (drawn < vw) {
      var seg = Math.min(LW - ox, vw - drawn);
      fb.setClip(drawn, 0, seg, vh);
      if (blend) fb.blitBlend(layer.d, LW, vh, drawn, 0, false, ox);
      else fb.blit(layer.d, LW, vh, drawn, 0, false, ox);
      fb.resetClip();
      drawn += seg;
      ox = 0;
    }
  }

  // 天空缓冲必须和画布同尺寸；尺寸变了就重建（build 的缓存键里带了尺寸）
  function drawSky(fb, sky) {
    if (sky.d.length === fb.data.length) { fb.data.set(sky.d); return; }
    var vw = curVW(), vh = curVH();
    var srcW = sky.w || vw;
    for (var y = 0; y < vh && y < (sky.h || vh); y++) {
      var so = y * srcW, dOff = y * vw;
      for (var x = 0; x < vw; x++) fb.data[dOff + x] = sky.d[so + (x % srcW)];
    }
  }
  function reset() { caches = {}; }

  CT.BG = {
    build: build, drawSky: drawSky, drawLayer: drawLayer,
    FACTOR: FACTOR,
    get curVW() { return curVW(); },
    get curVH() { return curVH(); },
    reset: reset,
  };
})();
