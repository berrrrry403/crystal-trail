/* 晶途拾光 — 像素绘制工具箱
 * --------------------------------------------------------------------------
 * 所有美术资源在运行时程序化生成到 Uint32Array 缓冲里，不依赖 DOM、不依赖
 * 图片解码。因此：浏览器所见 = 无头 QA 渲染器所见，逐像素一致。
 *
 * 提供两类能力：
 *   1. 基础图元（点/线/矩形/抖动/椭圆）——用于瓦片与背景的程序化生成
 *   2. ASCII 像素图载入器 —— 角色与道具这类需要精确控制的素材用字符画描述，
 *      每行一个字符串，'.' 表示透明，其余字符查调色表
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  function buf(w, h) {
    return { w: w | 0, h: h | 0, d: new Uint32Array((w | 0) * (h | 0)) };
  }

  function set(b, x, y, c) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
    b.d[y * b.w + x] = c >>> 0;
  }

  function get(b, x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) return 0;
    return b.d[y * b.w + x];
  }

  function fill(b, x, y, w, h, c) {
    var x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    var x1 = Math.min(b.w, (x | 0) + (w | 0)), y1 = Math.min(b.h, (y | 0) + (h | 0));
    c = c >>> 0;
    for (var yy = y0; yy < y1; yy++) {
      var o = yy * b.w;
      for (var xx = x0; xx < x1; xx++) b.d[o + xx] = c;
    }
  }

  function rect(b, x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    fill(b, x, y, w, 1, c);
    fill(b, x, y + h - 1, w, 1, c);
    fill(b, x, y + 1, 1, h - 2, c);
    fill(b, x + w - 1, y + 1, 1, h - 2, c);
  }

  function hline(b, x, y, w, c) { fill(b, x, y, w, 1, c); }
  function vline(b, x, y, h, c) { fill(b, x, y, 1, h, c); }

  // Bayer 抖动填充：level 为 0..16 的覆盖率
  var B = CT.BAYER4;
  function dither(b, x, y, w, h, c, level) {
    if (level <= 0) return;
    var x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    var x1 = Math.min(b.w, (x | 0) + (w | 0)), y1 = Math.min(b.h, (y | 0) + (h | 0));
    if (level >= 16) { fill(b, x0, y0, x1 - x0, y1 - y0, c); return; }
    c = c >>> 0;
    for (var yy = y0; yy < y1; yy++) {
      var o = yy * b.w, by = (yy & 3) * 4;
      for (var xx = x0; xx < x1; xx++) {
        if (B[by + (xx & 3)] < level) b.d[o + xx] = c;
      }
    }
  }

  function ellipse(b, cx, cy, rx, ry, c) {
    c = c >>> 0;
    for (var y = -ry; y <= ry; y++) {
      var t = 1 - (y * y) / (ry * ry);
      if (t <= 0) continue;
      var xr = Math.round(rx * Math.sqrt(t));
      fill(b, cx - xr, cy + y, xr * 2 + 1, 1, c);
    }
  }

  function blit(dst, dx, dy, src, flipX) {
    dx = dx | 0; dy = dy | 0;
    for (var y = 0; y < src.h; y++) {
      var ty = dy + y;
      if (ty < 0 || ty >= dst.h) continue;
      for (var x = 0; x < src.w; x++) {
        var c = src.d[y * src.w + (flipX ? src.w - 1 - x : x)];
        if (c === 0) continue;
        var tx = dx + x;
        if (tx < 0 || tx >= dst.w) continue;
        dst.d[ty * dst.w + tx] = c;
      }
    }
  }

  function clone(b) {
    var o = buf(b.w, b.h);
    o.d.set(b.d);
    return o;
  }

  function flipX(b) {
    var o = buf(b.w, b.h);
    for (var y = 0; y < b.h; y++) {
      for (var x = 0; x < b.w; x++) o.d[y * b.w + x] = b.d[y * b.w + (b.w - 1 - x)];
    }
    return o;
  }

  /**
   * ASCII 像素图 -> 缓冲
   * @param {string[]} rows
   * @param {Object} map  { 'h': 0xAABBGGRR, ... }   '.' 与 ' ' 恒为透明
   */
  function fromRows(rows, map) {
    var h = rows.length;
    var w = 0;
    for (var i = 0; i < h; i++) w = Math.max(w, rows[i].length);
    var b = buf(w, h);
    for (var y = 0; y < h; y++) {
      var row = rows[y];
      for (var x = 0; x < row.length; x++) {
        var ch = row.charAt(x);
        if (ch === '.' || ch === ' ') continue;
        var c = map[ch];
        if (c === undefined) throw new Error('artkit.fromRows: unmapped char "' + ch + '"');
        b.d[y * w + x] = c >>> 0;
      }
    }
    return b;
  }

  /** 统计非透明像素数（用于校验与画布裁剪） */
  function countInk(b) {
    var n = 0;
    for (var i = 0; i < b.d.length; i++) if (b.d[i] !== 0) n++;
    return n;
  }

  /** 用到的不同颜色数（§7.7 色数校验） */
  function countColors(b) {
    var s = new Set();
    for (var i = 0; i < b.d.length; i++) if (b.d[i] !== 0) s.add(b.d[i]);
    return s.size;
  }

  /** 半透明像素数（§7.7 校验：应为 0） */
  function countPartialAlpha(b) {
    var n = 0;
    for (var i = 0; i < b.d.length; i++) {
      var c = b.d[i];
      if (c === 0) continue;
      var a = (c >>> 24) & 255;
      if (a !== 0 && a !== 255) n++;
    }
    return n;
  }

  /**
   * 给图形加 1 像素内描边（找非透明像素的透明邻域）。§3.1 轮廓 1 像素深色描边
   * 注意：只在画布内部加，超出边界的部分不补，因此素材四周要留 1px 透明边。
   */
  function addOutline(b, color) {
    var out = clone(b);
    var w = b.w, h = b.h, d = b.d;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[y * w + x] !== 0) continue;
        var near = false;
        if (x > 0 && d[y * w + x - 1] !== 0) near = true;
        else if (x < w - 1 && d[y * w + x + 1] !== 0) near = true;
        else if (y > 0 && d[(y - 1) * w + x] !== 0) near = true;
        else if (y < h - 1 && d[(y + 1) * w + x] !== 0) near = true;
        if (near) out.d[y * w + x] = color >>> 0;
      }
    }
    return out;
  }

  /** 把缓冲裁到实际墨迹范围（右下留 pad 像素） */
  function trim(b, pad) {
    pad = pad || 0;
    var minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
    for (var y = 0; y < b.h; y++) {
      for (var x = 0; x < b.w; x++) {
        if (b.d[y * b.w + x] !== 0) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx < 0) return buf(1, 1);
    var x0 = Math.max(0, minx - pad), y0 = Math.max(0, miny - pad);
    var x1 = Math.min(b.w - 1, maxx + pad), y1 = Math.min(b.h - 1, maxy + pad);
    var o = buf(x1 - x0 + 1, y1 - y0 + 1);
    for (var yy = y0; yy <= y1; yy++) {
      for (var xx = x0; xx <= x1; xx++) {
        o.d[(yy - y0) * o.w + (xx - x0)] = b.d[yy * b.w + xx];
      }
    }
    return o;
  }

  CT.Art = {
    buf: buf, set: set, get: get, fill: fill, rect: rect, hline: hline, vline: vline,
    dither: dither, ellipse: ellipse, blit: blit, clone: clone, flipX: flipX,
    fromRows: fromRows, countInk: countInk, countColors: countColors,
    countPartialAlpha: countPartialAlpha, addOutline: addOutline, trim: trim,
  };
})();
