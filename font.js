/* 晶途拾光 — 点阵字渲染
 * --------------------------------------------------------------------------
 * §7.5 字体为 8 × 8 像素点阵字，中文使用 12 × 12 点阵。
 *
 * 字库由 tools/gen_font.py 生成为 1-bit 打包位图 + base64。本模块自行解码
 * base64（不依赖 atob，因此无头 QA 也能跑），按需解位并缓存字形掩码，绘制
 * 时走 FB.blitMaskColor —— 每个像素只写一次，热路径零分配。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64INV = (function () {
    var t = new Int16Array(128).fill(-1);
    for (var i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
    return t;
  })();

  function b64decode(str) {
    var out = new Uint8Array(((str.length * 3) >> 2) + 3);
    var o = 0, acc = 0, bits = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c === 61) break; // '='
      var v = c < 128 ? B64INV[c] : -1;
      if (v < 0) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 0xff;
      }
    }
    return out.subarray(0, o);
  }

  var CJK_ADV = 12;   // §7.5 中文 12×12
  var LAT_ADV = 8;    // §7.5 西文 8×8

  var cjkSet = null, latSet = null;
  var cjkIndex = null;
  var cjkCache = new Map();
  var latCache = [];
  var fallbackMask = null;

  function buildSet(data, cell) {
    var bits = b64decode(data.bits);
    var map = null;
    if (data.chars.length > 200) {
      map = new Map();
      for (var i = 0; i < data.chars.length; i++) map.set(data.chars[i], i);
    }
    return { cell: cell, bits: bits, chars: data.chars, map: map, per: cell * cell };
  }

  // 把一个字形解成 cell*cell 的 0/255 掩码
  function decodeGlyph(set, idx) {
    var cell = set.cell, per = set.per;
    var mask = new Uint8Array(per);
    var bitBase = idx * per;
    var bits = set.bits;
    for (var p = 0; p < per; p++) {
      var b = bitBase + p;
      var byte = bits[b >> 3];
      if (byte === undefined) continue;
      if (byte & (0x80 >> (b & 7))) mask[p] = 255;
    }
    return mask;
  }

  function init() {
    if (cjkSet) return;
    var D = CT.FONT_DATA;
    if (!D) throw new Error('font: CT.FONT_DATA missing (run tools/gen_font.py)');
    cjkSet = buildSet(D.cjk, D.cjk.cell);
    latSet = buildSet(D.latin, D.latin.cell);
    cjkIndex = cjkSet.map;
    // 缺字占位：空心方框
    var cell = cjkSet.cell;
    fallbackMask = new Uint8Array(cell * cell);
    for (var y = 2; y < cell - 2; y++) {
      for (var x = 2; x < cell - 2; x++) {
        if (y === 2 || y === cell - 3 || x === 2 || x === cell - 3) {
          fallbackMask[y * cell + x] = 255;
        }
      }
    }
  }

  function latMask(code) {
    var i = code - 32;
    if (i < 0 || i >= latSet.chars.length) return null;
    var m = latCache[i];
    if (!m) {
      m = decodeGlyph(latSet, i);
      latCache[i] = m;
    }
    return m;
  }

  function cjkMask(ch) {
    var i = cjkIndex.get(ch);
    if (i === undefined) return null;
    var m = cjkCache.get(i);
    if (!m) {
      m = decodeGlyph(cjkSet, i);
      cjkCache.set(i, m);
    }
    return m;
  }

  function isWide(code) {
    // 12×12 表里的字符一律按 12px 推进；其余按 8px
    return code > 0x2000 || (code >= 0x3000 && code <= 0x9fff) || code >= 0xff00;
  }

  function glyphFor(code) {
    if (code < 128) {
      var m = latMask(code);
      if (m) return { mask: m, adv: LAT_ADV, cell: latSet.cell };
      if (fallbackMask) return { mask: fallbackMask, adv: CJK_ADV, cell: cjkSet.cell };
      return null;
    }
    var g = cjkMask(String.fromCharCode(code));
    if (g) return { mask: g, adv: CJK_ADV, cell: cjkSet.cell };
    return { mask: fallbackMask, adv: CJK_ADV, cell: cjkSet.cell };
  }

  // ------------------------------------------------------------------ draw

  /**
   * @param {CT.FB} fb
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {number} color  0xAABBGGRR
   * @param {object} [opt]  {outline: color, dither: 0..16, maxW: px, align:'left'|'center'|'right', limit: charCount}
   */
  function draw(fb, text, x, y, color, opt) {
    init();
    opt = opt || null;
    var outline = opt && opt.outline;
    var dither = opt && opt.dither !== undefined ? opt.dither : 16;
    var maxW = opt && opt.maxW ? opt.maxW : 0;
    var limit = opt && opt.limit !== undefined ? opt.limit : text.length;

    var totalW = 0, drawn = 0, i, code, g;
    var cx = x;
    var stop = false;
    var hasOutline = (outline !== undefined && outline !== null);

    // 逐字绘制；超出 maxW 立即截断（对话打字机用 limit 控制更精确）
    for (i = 0; i < text.length && !stop; i++) {
      if (drawn >= limit) break;
      code = text.charCodeAt(i);
      g = glyphFor(code);
      if (!g) continue;
      if (maxW && cx + g.adv - x > maxW) break;
      if (code !== 32) {
        var dx = cx, dy = y;
        if (hasOutline) {
          // 1 像素斜向投影。四向描边在 12 px 汉字上会把笔画吃掉、看起来像重影；
          // 斜向投影只加一份暗色，既压住背景又不糊字。
          fb.blitMaskColor(g.mask, g.cell, g.cell, dx + 1, dy + 1, outline, dither);
        }
        fb.blitMaskColor(g.mask, g.cell, g.cell, dx, dy, color, dither);
      }
      cx += g.adv;
      drawn++;
    }
    totalW = cx - x;
    return totalW;
  }

  function drawCentered(fb, text, cx, y, color, opt) {
    init();
    var w = measure(text);
    return draw(fb, text, Math.round(cx - w / 2), y, color, opt);
  }

  function drawRight(fb, text, rx, y, color, opt) {
    init();
    var w = measure(text);
    return draw(fb, text, Math.round(rx - w), y, color, opt);
  }

  function measure(text) {
    init();
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      w += code < 128 ? LAT_ADV : CJK_ADV;
    }
    return w;
  }

  function charW(code) { return code < 128 ? LAT_ADV : CJK_ADV; }

  /**
   * 按像素宽度折行。返回字符串数组，最多 maxLines 行；超出的部分丢弃并置
   * truncated 标记（调用方据此提示）。
   */
  function wrap(text, maxW, maxLines) {
    init();
    var lines = [];
    var cur = '';
    var curW = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code === 10) { // '\n'
        lines.push(cur); cur = ''; curW = 0;
        continue;
      }
      var cw = charW(code);
      if (curW + cw > maxW && cur.length > 0) {
        lines.push(cur);
        cur = '';
        curW = 0;
        if (maxLines && lines.length >= maxLines) return lines;
      }
      cur += text[i];
      curW += cw;
    }
    if (cur.length || lines.length === 0) lines.push(cur);
    if (maxLines && lines.length > maxLines) lines.length = maxLines;
    return lines;
  }

  // 供 tools/check_font_coverage.mjs 使用的字形覆盖查询
  function hasGlyph(ch) {
    init();
    var code = ch.charCodeAt(0);
    if (code < 128) return latSet.chars.indexOf(ch) >= 0;
    return cjkIndex.has(ch);
  }

  CT.Font = {
    init: init,
    draw: draw,
    drawCentered: drawCentered,
    drawRight: drawRight,
    measure: measure,
    wrap: wrap,
    hasGlyph: hasGlyph,
    CJK_ADV: CJK_ADV,
    LAT_ADV: LAT_ADV,
    get cjkCount() { init(); return cjkSet.chars.length; },
  };
})();
