/* 晶途拾光 — software pixel framebuffer
 * --------------------------------------------------------------------------
 * 规格书 §7.1：内部渲染分辨率固定 480 × 270，所有美术按 1 倍像素绘制，
 * 运行时整数倍放大。本模块实现一个纯软件帧缓冲，所有绘制都落在 Uint32Array
 * 上（0xAABBGGRR，小端 RGBA）。它不依赖 DOM，因此浏览器与无头 QA 渲染器
 * 走的是同一条绘制代码路径 —— 截图所见即玩家所见。
 *
 * 规格书 §7.2：透明度只允许 0% / 50% / 100% 三档。glow 使用抖动实现
 * （§7.5「抖动光晕」），因此本模块提供 ditherBlit。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var A0 = 0;           // fully transparent sentinel
  function rgba(r, g, b, a) {
    if (a === undefined) a = 255;
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  // 4x4 Bayer matrix, values 0..15 — used for dithered fills & glow tiers.
  var BAYER4 = new Uint8Array([
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ]);

  function FB(w, h) {
    this.w = w | 0;
    this.h = h | 0;
    this.data = new Uint32Array(this.w * this.h);
    this.clipL = 0; this.clipT = 0; this.clipR = this.w; this.clipB = this.h;
  }

  FB.prototype.setClip = function (x, y, w, h) {
    this.clipL = Math.max(0, x | 0);
    this.clipT = Math.max(0, y | 0);
    this.clipR = Math.min(this.w, (x | 0) + (w | 0));
    this.clipB = Math.min(this.h, (y | 0) + (h | 0));
  };
  FB.prototype.resetClip = function () {
    this.clipL = 0; this.clipT = 0; this.clipR = this.w; this.clipB = this.h;
  };

  FB.prototype.clear = function (c) {
    this.data.fill(c >>> 0);
  };

  FB.prototype.px = function (x, y, c) {
    x = x | 0; y = y | 0;
    if (x < this.clipL || x >= this.clipR || y < this.clipT || y >= this.clipB) return;
    this.data[y * this.w + x] = c >>> 0;
  };

  FB.prototype.get = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  };

  FB.prototype.fillRect = function (x, y, w, h, c) {
    var x0 = Math.max(this.clipL, x | 0), y0 = Math.max(this.clipT, y | 0);
    var x1 = Math.min(this.clipR, (x | 0) + (w | 0)), y1 = Math.min(this.clipB, (y | 0) + (h | 0));
    if (x1 <= x0 || y1 <= y0) return;
    c = c >>> 0;
    var d = this.data, W = this.w;
    for (var yy = y0; yy < y1; yy++) {
      var o = yy * W;
      for (var xx = x0; xx < x1; xx++) d[o + xx] = c;
    }
  };

  // Dithered fill — §7.2「渐变只用抖动实现」
  FB.prototype.fillRectDither = function (x, y, w, h, c, level) {
    // level: 0..16 coverage out of 16
    var x0 = Math.max(this.clipL, x | 0), y0 = Math.max(this.clipT, y | 0);
    var x1 = Math.min(this.clipR, (x | 0) + (w | 0)), y1 = Math.min(this.clipB, (y | 0) + (h | 0));
    if (x1 <= x0 || y1 <= y0 || level <= 0) return;
    c = c >>> 0;
    if (level >= 16) { this.fillRect(x0, y0, x1 - x0, y1 - y0, c); return; }
    var d = this.data, W = this.w;
    for (var yy = y0; yy < y1; yy++) {
      var o = yy * W, by = (yy & 3) * 4;
      for (var xx = x0; xx < x1; xx++) {
        if (BAYER4[by + (xx & 3)] < level) d[o + xx] = c;
      }
    }
  };

  FB.prototype.hline = function (x, y, w, c) { this.fillRect(x, y, w, 1, c); };
  FB.prototype.vline = function (x, y, h, c) { this.fillRect(x, y, 1, h, c); };

  FB.prototype.rect = function (x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    this.fillRect(x, y, w, 1, c);
    this.fillRect(x, y + h - 1, w, 1, c);
    this.fillRect(x, y + 1, 1, h - 2, c);
    this.fillRect(x + w - 1, y + 1, 1, h - 2, c);
  };

  FB.prototype.ellipse = function (cx, cy, rx, ry, c) {
    c = c >>> 0;
    var d = this.data, W = this.w;
    for (var y = -ry; y <= ry; y++) {
      var t = 1 - (y * y) / (ry * ry);
      if (t <= 0) continue;
      var xr = Math.round(rx * Math.sqrt(t));
      var yy = cy + y;
      if (yy < this.clipT || yy >= this.clipB) continue;
      var x0 = Math.max(this.clipL, cx - xr), x1 = Math.min(this.clipR, cx + xr + 1);
      var o = yy * W;
      for (var x = x0; x < x1; x++) d[o + x] = c;
    }
  };

  // ------------------------------------------------------------------------
  // Blits
  // ------------------------------------------------------------------------

  // Opaque-key copy blit (alpha 0 => skip). Used for tiles, sprites, props.
  FB.prototype.blit = function (src, sw, sh, dx, dy, flipX, srcOffX, srcOffY) {
    flipX = !!flipX;
    var sx0 = srcOffX | 0 || 0, sy0 = srcOffY | 0 || 0;
    var x0 = dx | 0, y0 = dy | 0;
    var cx0 = Math.max(this.clipL, x0), cy0 = Math.max(this.clipT, y0);
    var cx1 = Math.min(this.clipR, x0 + sw - sx0), cy1 = Math.min(this.clipB, y0 + sh - sy0);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    var d = this.data, W = this.w;
    for (var yy = cy0; yy < cy1; yy++) {
      var sy = sy0 + (yy - y0);
      var srow = sy * sw;
      var drow = yy * W;
      if (!flipX) {
        for (var xx = cx0; xx < cx1; xx++) {
          var c = src[srow + sx0 + (xx - x0)];
          if (c !== 0) d[drow + xx] = c;
        }
      } else {
        for (var xx2 = cx0; xx2 < cx1; xx2++) {
          var sxv = sw - 1 - (sx0 + (xx2 - x0));
          if (sxv < 0 || sxv >= sw) continue;
          var c2 = src[srow + sxv];
          if (c2 !== 0) d[drow + xx2] = c2;
        }
      }
    }
  };

  // Full copy including transparent pixels (used for background layers).
  FB.prototype.blitOpaque = function (src, sw, sh, dx, dy) {
    var x0 = dx | 0, y0 = dy | 0;
    var cx0 = Math.max(this.clipL, x0), cy0 = Math.max(this.clipT, y0);
    var cx1 = Math.min(this.clipR, x0 + sw), cy1 = Math.min(this.clipB, y0 + sh);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    var d = this.data, W = this.w;
    for (var yy = cy0; yy < cy1; yy++) {
      var srow = (yy - y0) * sw;
      var drow = yy * W;
      for (var xx = cx0; xx < cx1; xx++) d[drow + xx] = src[srow + (xx - x0)];
    }
  };

  // Alpha-blend blit — §7.2 allows 0/50/100%; used for water, shadow, near parallax.
  FB.prototype.blitBlend = function (src, sw, sh, dx, dy, flipX, srcOffX) {
    var sx0 = srcOffX | 0 || 0;
    var x0 = dx | 0, y0 = dy | 0;
    var cx0 = Math.max(this.clipL, x0), cy0 = Math.max(this.clipT, y0);
    var cx1 = Math.min(this.clipR, x0 + sw - sx0), cy1 = Math.min(this.clipB, y0 + sh);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    var d = this.data, W = this.w;
    for (var yy = cy0; yy < cy1; yy++) {
      var srow = (yy - y0) * sw;
      var drow = yy * W;
      for (var xx = cx0; xx < cx1; xx++) {
        var sxv = sx0 + (xx - x0);
        if (flipX) sxv = sw - 1 - sxv;
        if (sxv < 0 || sxv >= sw) continue;
        var c = src[srow + sxv];
        var a = (c >>> 24) & 255;
        if (a === 0) continue;
        if (a === 255) { d[drow + xx] = c; continue; }
        var dc = d[drow + xx];
        var ia = 255 - a;
        var r = (((c & 255) * a + (dc & 255) * ia) / 255) | 0;
        var g = ((((c >>> 8) & 255) * a + ((dc >>> 8) & 255) * ia) / 255) | 0;
        var b = ((((c >>> 16) & 255) * a + ((dc >>> 16) & 255) * ia) / 255) | 0;
        d[drow + xx] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
  };

  // Dithered blit: draws src pixels where the Bayer cell is below `level`.
  // Keeps output palette-pure — the classic 8-bit glow / fade technique.
  FB.prototype.blitDither = function (src, sw, sh, dx, dy, level, flipX) {
    if (level <= 0) return;
    var x0 = dx | 0, y0 = dy | 0;
    var cx0 = Math.max(this.clipL, x0), cy0 = Math.max(this.clipT, y0);
    var cx1 = Math.min(this.clipR, x0 + sw), cy1 = Math.min(this.clipB, y0 + sh);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    var d = this.data, W = this.w;
    for (var yy = cy0; yy < cy1; yy++) {
      var srow = (yy - y0) * sw;
      var drow = yy * W, by = (yy & 3) * 4;
      for (var xx = cx0; xx < cx1; xx++) {
        if (BAYER4[by + (xx & 3)] >= level) continue;
        var sxv = xx - x0;
        if (flipX) sxv = sw - 1 - sxv;
        var c = src[srow + sxv];
        if (c !== 0 && ((c >>> 24) & 255) > 127) d[drow + xx] = (c | 0xff000000) >>> 0;
      }
    }
  };

  // Mask blit: draw every source pixel in a single flat colour where mask is set.
  FB.prototype.blitMaskColor = function (mask, sw, sh, dx, dy, color, level) {
    var x0 = dx | 0, y0 = dy | 0;
    var cx0 = Math.max(this.clipL, x0), cy0 = Math.max(this.clipT, y0);
    var cx1 = Math.min(this.clipR, x0 + sw), cy1 = Math.min(this.clipB, y0 + sh);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    var d = this.data, W = this.w;
    color = color >>> 0;
    if (level === undefined || level >= 16) {
      for (var yy = cy0; yy < cy1; yy++) {
        var srow = (yy - y0) * sw, drow = yy * W;
        for (var xx = cx0; xx < cx1; xx++) {
          if (mask[srow + (xx - x0)] > 127) d[drow + xx] = color;
        }
      }
    } else {
      for (var yy2 = cy0; yy2 < cy1; yy2++) {
        var srow2 = (yy2 - y0) * sw, drow2 = yy2 * W, by = (yy2 & 3) * 4;
        for (var xx2 = cx0; xx2 < cx1; xx2++) {
          if (BAYER4[by + (xx2 & 3)] >= level) continue;
          if (mask[srow2 + (xx2 - x0)] > 127) d[drow2 + xx2] = color;
        }
      }
    }
  };

  // Tint an existing sprite buffer into a new one (used for shadows / silhouettes)
  FB.tint = function (src, w, h, color, keepAlpha) {
    var out = new Uint32Array(w * h);
    var a = keepAlpha === undefined ? 0xff000000 : keepAlpha;
    for (var i = 0; i < src.length; i++) {
      if (src[i] !== 0) out[i] = ((color & 0x00ffffff) | a) >>> 0;
    }
    return out;
  };

  FB.prototype.snapshot = function () {
    return this.data.slice(0);
  };

  CT.FB = FB;
  CT.rgba = rgba;
  CT.BAYER4 = BAYER4;
})();
