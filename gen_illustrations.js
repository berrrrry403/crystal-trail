/* 晶途拾光 — 旅途留影（图鉴插画）
 * --------------------------------------------------------------------------
 * 每拾起一枚本源彩晶，图鉴里解锁一张 192 × 128 的场景插画。
 * 这些不是游戏截图 —— 是单独的构图：更大的画幅、更细的抖动渐变、
 * 分层剪影、明确的光向和引导线，主角在画面里只占很小一块。
 *
 * 需求要求「精致一点」，所以这里比游戏内美术多做几件事：
 *   · 天光用多级抖动过渡，而不是单一色块
 *   · 每张图都有明确的光源方向与地面反光
 *   · 前景压暗取景框（vignette），把视线收到主角身上
 *   · 主角用 2 倍整像素放大（32 × 48），在 192 × 128 画布里仍是小人物
 *
 * 调色板仍然只用该主题的 16 色 + 全局角色色，符合 §7.2。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var A = CT.Art;
  var G = CT.Palette.G;
  var gc = CT.Palette.gc;

  var W = 192, H = 128;

  // ---------------------------------------------------------------- 公共件
  // 天空：分层色带 + 3 行窄抖动过渡。
  // 整片 16 级抖动在大画幅上远看是一层噪点，分层色带才有插画感。
  function skyGradient(b, P, topIdx, botIdx, y0, y1) {
    var top = P.c[topIdx], bot = P.c[botIdx];
    var bandH = 7;
    for (var y = y0; y < y1; y++) {
      var t = (y - y0) / Math.max(1, (y1 - y0 - 1));
      var band = Math.floor(t * bandH);
      var inBand = (y - y0) % (bandH * 1) ;
      var edge = t * bandH - band;                 // 0..1，处于带内位置
      var useBot = edge > 0.62;                     // 后 38% 换下一档色
      var blink = CT.BAYER4[(y & 3) * 4];
      for (var x = 0; x < W; x++) {
        var c = top;
        if (useBot) {
          // 窄过渡：只在带尾 3 行做抖动
          var nearEdge = edge > 0.86;
          c = (!nearEdge || CT.BAYER4[(y & 3) * 4 + (x & 3)] < 6) ? bot : top;
        } else if (band > 0) {
          c = (band >= bandH - 1) ? top : bot;
        }
        b.d[y * W + x] = c;
      }
    }
  }

  function ridge(b, P, color, baseY, amp, freq, phase) {
    for (var x = 0; x < W; x++) {
      var h = Math.sin((x / W) * Math.PI * 2 * freq + phase) * amp
            + Math.sin((x / W) * Math.PI * 2 * (freq * 2.3) + phase * 1.7) * amp * 0.35;
      var top = Math.round(baseY + h);
      if (top < 0) top = 0;
      if (top < H) b.d[top * W + x] = P.c[color];
      for (var y = top; y < H; y++) b.d[y * W + x] = P.c[color];
    }
  }

  function lightShaft(b, P, x0, y0, spread, height, colorIdx, strength) {
    for (var y = 0; y < height; y++) {
      var t = y / height;
      var half = Math.round(spread * (0.35 + t * 0.9));
      var cx = x0 + Math.round(t * 6);
      for (var x = cx - half; x <= cx + half; x++) {
        if (x < 0 || x >= W) continue;
        var yy = y0 + y;
        if (yy < 0 || yy >= H) continue;
        var lv = Math.round(strength * (1 - t * 0.75));
        if (CT.BAYER4[(yy & 3) * 4 + (x & 3)] < lv) b.d[yy * W + x] = P.c[colorIdx];
      }
    }
  }

  function groundGlow(b, P, y0, colorIdx, strength) {
    for (var y = y0; y < Math.min(H, y0 + 26); y++) {
      var lv = Math.round(strength * (1 - (y - y0) / 26));
      for (var x = 0; x < W; x++) {
        if (CT.BAYER4[(y & 3) * 4 + (x & 3)] < lv) b.d[y * W + x] = P.c[colorIdx];
      }
    }
  }

  function vignette(b, color) {
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var dx = (x - W / 2) / (W / 2);
        var dy = (y - H / 2) / (H / 2);
        var d = dx * dx + dy * dy;
        if (d < 0.78) continue;
        var lv = Math.min(3, Math.round((d - 0.78) * 8));
        if (CT.BAYER4[(y & 3) * 4 + (x & 3)] < lv) b.d[y * W + x] = color;
      }
    }
  }

  // 主角：取一帧动作，2 倍整像素放大后贴上去
  function stampHero(b, heroFrames, anim, frameIdx, x, y, flip) {
    var def = heroFrames[anim];
    var f = def.frames[Math.min(frameIdx, def.frames.length - 1)];
    for (var sy = 0; sy < 24; sy++) {
      for (var sx = 0; sx < 16; sx++) {
        var c = f.d[sy * 16 + (flip ? 15 - sx : sx)];
        if (c === 0) continue;
        for (var oy = 0; oy < 2; oy++) {
          for (var ox = 0; ox < 2; ox++) {
            var tx = x + sx * 2 + ox, ty = y + sy * 2 + oy;
            if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
            b.d[ty * W + tx] = c;
          }
        }
      }
    }
  }

  function dots(b, P, colorIdx, n, rng, y0, y1) {
    for (var i = 0; i < n; i++) {
      var x = (rng.f() * W) | 0;
      var y = y0 + ((rng.f() * (y1 - y0)) | 0);
      if (y < 0 || y >= H) continue;
      b.d[y * W + x] = P.c[colorIdx];
      if (rng.f() < 0.3 && x + 1 < W) b.d[y * W + x + 1] = P.c[colorIdx];
    }
  }

  // ---------------------------------------------------------------- 五张图
  // 1 青藓初林 — 雨里的第一段路
  function sceneForest(P, hero, rng) {
    var b = A.buf(W, H);
    skyGradient(b, P, 2, 1, 0, 74);
    ridge(b, P, 10, 58, 10, 3, 0.4);
    ridge(b, P, 6, 72, 8, 5, 1.9);
    for (var i = 0; i < 6; i++) {
      var tx = 8 + i * 34 + ((rng.f() * 10) | 0);
      var tw = 5 + ((rng.f() * 3) | 0);
      for (var y = 22; y < 96; y++) {
        for (var x = tx; x < tx + tw && x < W; x++) b.d[y * W + x] = P.c[9];
      }
      A.ellipse(b, tx + (tw >> 1), 26, 18, 9, P.c[6]);
      A.ellipse(b, tx + (tw >> 1) - 6, 22, 10, 6, P.c[5]);
    }
    for (var r = 0; r < 130; r++) {
      var rx = (rng.f() * (W + 20)) | 0;
      var ry = (rng.f() * 92) | 0;
      var len = 3 + ((rng.f() * 4) | 0);
      for (var k = 0; k < len; k++) {
        var px = rx - k, py = ry + k;
        if (px >= 0 && px < W && py < H) b.d[py * W + px] = P.c[3];
      }
    }
    ridge(b, P, 8, 96, 2, 2, 0.9);
    for (var lx = 0; lx < W; lx++) {
      var ly = 98 + Math.round(Math.sin(lx * 0.08) * 2);
      for (var yy = ly; yy < H; yy++) b.d[yy * W + lx] = P.c[5];
      b.d[ly * W + lx] = P.c[1];
    }
    groundGlow(b, P, 99, 2, 4);
    lightShaft(b, P, 132, 6, 16, 74, 0, 7);
    stampHero(b, hero, 'walk', 2, 96, 54, false);
    dots(b, P, 15, 26, rng, 40, 96);
    vignette(b, P.c[14]);
    return b;
  }

  // 2 琥珀岩窟 — 黑暗里学会坐着
  function sceneAmber(P, hero, rng) {
    var b = A.buf(W, H);
    b.d.fill(P.c[13]);
    ridge(b, P, 12, 34, 12, 2, 0.6);
    for (var i = 0; i < 16; i++) {
      var tx = (rng.f() * W) | 0;
      var hh = 10 + ((rng.f() * 26) | 0);
      var ww = 3 + ((rng.f() * 4) | 0);
      for (var y = 0; y < hh; y++) {
        var w2 = Math.max(1, Math.round(ww * (1 - y / hh)));
        for (var x = tx; x < tx + w2 && x < W; x++) b.d[y * W + x] = P.c[12];
      }
    }
    for (var gy = 96; gy < H; gy++) {
      for (var gx = 0; gx < W; gx++) {
        b.d[gy * W + gx] = gy < 99 ? P.c[6] : P.c[5];
      }
    }
    groundGlow(b, P, 96, 8, 7);
    for (var c = 0; c < 7; c++) {
      var cx = 10 + ((rng.f() * (W - 20)) | 0);
      var ch = 12 + ((rng.f() * 22) | 0);
      for (var yy = 0; yy < ch; yy++) {
        var ww2 = Math.max(1, Math.round(4 * (yy / ch)));
        for (var xx = cx; xx < cx + ww2 && xx < W; xx++) b.d[(96 - yy) * W + xx] = P.c[8];
      }
      if (cx < W) b.d[(96 - ch) * W + cx] = P.c[11];
    }
    for (var ry = 0; ry < 18; ry++) {
      var lv = Math.round(8 * (1 - ry / 18));
      for (var rx = 0; rx < 44; rx++) {
        var px = 74 + rx, py = 96 + ry;
        if (px < W && py < H && CT.BAYER4[(py & 3) * 4 + (px & 3)] < lv) b.d[py * W + px] = P.c[11];
      }
    }
    lightShaft(b, P, 150, 4, 10, 60, 8, 5);
    stampHero(b, hero, 'pickup', 1, 84, 80, false);
    dots(b, P, 8, 22, rng, 30, 96);
    vignette(b, P.c[14]);
    return b;
  }

  // 3 云漫高台 — 被风抛起来
  function sceneCloud(P, hero, rng) {
    var b = A.buf(W, H);
    skyGradient(b, P, 3, 0, 0, 110);
    for (var i = 0; i < 9; i++) {
      var cx = (rng.f() * W) | 0;
      var cy = 30 + ((rng.f() * 46) | 0);
      var cw = 24 + ((rng.f() * 34) | 0);
      A.ellipse(b, cx, cy, cw >> 1, 5 + ((rng.f() * 4) | 0), P.c[2]);
      A.ellipse(b, cx - 8, cy - 3, (cw >> 2), 4, P.c[1]);
    }
    for (var k = 0; k < 4; k++) {
      var ix = 14 + k * 46 + ((rng.f() * 12) | 0);
      var iy = 78 + ((rng.f() * 18) | 0);
      var iw = 26 + ((rng.f() * 20) | 0);
      // 平整草地顶面 + 下面收窄的岩体，才像块浮岛而不是三角锥
      for (var tx2 = ix - (iw >> 1); tx2 <= ix + (iw >> 1); tx2++) {
        if (tx2 < 0 || tx2 >= W) continue;
        for (var ty2 = iy - 1; ty2 <= iy + 2; ty2++) {
          if (ty2 >= 0 && ty2 < H) b.d[ty2 * W + tx2] = P.c[1];
        }
        if (iy + 3 < H) b.d[(iy + 3) * W + tx2] = P.c[3];
      }
      for (var yy = iy + 4; yy < Math.min(H, iy + 22); yy++) {
        var t = (yy - (iy + 4)) / 18;
        var ww = Math.round((iw / 2) * (1 - t * 0.9));
        for (var xx = ix - ww; xx <= ix + ww; xx++) {
          if (xx >= 0 && xx < W) b.d[yy * W + xx] = t > 0.5 ? P.c[4] : P.c[5];
        }
      }
    }
    for (var w = 0; w < 26; w++) {
      var wx = (rng.f() * W) | 0;
      var wy = 20 + ((rng.f() * 90) | 0);
      var len = 8 + ((rng.f() * 16) | 0);
      for (var s = 0; s < len; s++) {
        var px = wx + s, py = wy + Math.round(s * 0.25);
        if (px < W && py < H && CT.BAYER4[(py & 3) * 4 + (px & 3)] < 9) b.d[py * W + px] = P.c[1];
      }
    }
    for (var bd = 0; bd < 3; bd++) {
      var bx = 26 + bd * 16, by = 26 + bd * 5;
      if (bx + 3 < W && by < H) {
        b.d[by * W + bx] = P.c[10];
        b.d[(by - 1) * W + bx + 1] = P.c[10];
        b.d[by * W + bx + 2] = P.c[10];
        b.d[(by - 1) * W + bx + 3] = P.c[10];
      }
    }
    stampHero(b, hero, 'jump', 1, 118, 34, false);
    vignette(b, P.c[14]);
    return b;
  }

  // 4 碧泽水庭 — 水涨到膝盖
  function sceneWater(P, hero, rng) {
    var b = A.buf(W, H);
    skyGradient(b, P, 3, 1, 0, 66);
    ridge(b, P, 6, 62, 4, 2, 1.2);
    for (var i = 0; i < 3; i++) {
      var px = 26 + i * 62, py = 44;
      for (var x = 0; x < 26; x++) for (var y = 0; y < 6; y++) {
        if (px + x < W) b.d[(py + y) * W + px + x] = P.c[12];
      }
      for (var c = 0; c < 3; c++) for (var y2 = 0; y2 < 14; y2++) {
        if (px + 3 + c * 9 < W) b.d[(py + 6 + y2) * W + px + 3 + c * 9] = P.c[12];
      }
    }
    for (var y = 66; y < H; y++) {
      for (var x2 = 0; x2 < W; x2++) {
        var wave = Math.sin(x2 * 0.12 + y * 0.5) * 0.5 + 0.5;
        b.d[y * W + x2] = (y % 7 === 0 && wave > 0.6) ? P.c[2] : P.c[4];
      }
    }
    for (var r = 0; r < 7; r++) {
      var rx = (rng.f() * W) | 0, ry = 72 + ((rng.f() * 46) | 0);
      var rr = 6 + ((rng.f() * 12) | 0);
      for (var a = 0; a < 26; a++) {
        var ang = (a / 26) * Math.PI * 2;
        var ex = Math.round(rx + Math.cos(ang) * rr);
        var ey = Math.round(ry + Math.sin(ang) * rr * 0.32);
        if (ex >= 0 && ex < W && ey >= 0 && ey < H) b.d[ey * W + ex] = P.c[1];
      }
    }
    for (var l = 0; l < 5; l++) {
      var lx = 12 + ((rng.f() * (W - 24)) | 0);
      var ly = 76 + ((rng.f() * 40) | 0);
      A.ellipse(b, lx, ly, 9, 3, P.c[9]);
      A.ellipse(b, lx - 2, ly - 1, 4, 2, P.c[8]);
    }
    groundGlow(b, P, 66, 2, 5);
    stampHero(b, hero, 'pickup', 1, 88, 62, false);
    dots(b, P, 15, 24, rng, 40, 110);
    vignette(b, P.c[14]);
    return b;
  }

  // 5 星纹古殿 — 掌心的一线光
  function sceneStar(P, hero, rng) {
    var b = A.buf(W, H);
    b.d.fill(P.c[13]);
    skyGradient(b, P, 13, 12, 0, 92);
    for (var i = 0; i < 4; i++) {
      var px = 18 + i * 50;
      for (var y = 10; y < 96; y++) {
        for (var x = px; x < px + 12 && x < W; x++) b.d[y * W + x] = P.c[11];
      }
      for (var y2 = 8; y2 < 12; y2++) {
        for (var x2 = px - 2; x2 < px + 14 && x2 < W; x2++) {
          if (x2 >= 0) b.d[y2 * W + x2] = P.c[8];
        }
      }
    }
    for (var s = 0; s < 40; s++) {
      var sx = (rng.f() * W) | 0, sy = 12 + ((rng.f() * 60) | 0);
      b.d[sy * W + sx] = P.c[2];
    }
    for (var gy = 96; gy < H; gy++) {
      for (var gx = 0; gx < W; gx++) {
        b.d[gy * W + gx] = (gx % 24 < 2 || gy % 16 < 2) ? P.c[12] : P.c[6];
      }
    }
    lightShaft(b, P, 96, 0, 13, 100, 0, 9);
    groundGlow(b, P, 96, 0, 6);
    stampHero(b, hero, 'celebrate', 1, 88, 48, false);
    A.ellipse(b, 104, 56, 3, 3, P.c[15]);
    A.ellipse(b, 104, 56, 1, 1, gc(G.WHITE));
    for (var r = 0; r < 10; r++) {
      var lvl = 10 - r;
      if (lvl <= 0) continue;
      for (var a = 0; a < 60; a++) {
        var ang = (a / 60) * Math.PI * 2;
        var ex2 = Math.round(104 + Math.cos(ang) * (4 + r * 2));
        var ey2 = Math.round(56 + Math.sin(ang) * (4 + r * 2));
        if (ex2 >= 0 && ex2 < W && ey2 >= 0 && ey2 < H &&
            CT.BAYER4[(ey2 & 3) * 4 + (ex2 & 3)] < lvl / 2) {
          b.d[ey2 * W + ex2] = P.c[15];
        }
      }
    }
    dots(b, P, 1, 30, rng, 4, 92);
    vignette(b, P.c[14]);
    return b;
  }

  var SCENES = {
    forest: sceneForest,
    amber: sceneAmber,
    cloud: sceneCloud,
    water: sceneWater,
    star: sceneStar,
  };

  var cache = {};
  function build(themeKey) {
    if (cache[themeKey]) return cache[themeKey];
    var P = CT.Palette.get(themeKey);
    var hero = CT.Sprites.buildHero(themeKey);
    var rng = new CT.Rng(CT.seedOf('gallery:' + themeKey));
    var fn = SCENES[themeKey];
    if (!fn) throw new Error('illustration: unknown theme ' + themeKey);
    var b = fn(P, hero, rng);
    cache[themeKey] = b;
    return b;
  }

  CT.Illustration = {
    W: W, H: H,
    build: build,
    reset: function () { cache = {}; },
  };
})();
