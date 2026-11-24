/* 晶途拾光 — 对话与提示
 * --------------------------------------------------------------------------
 * §6.3 对话与提示规范
 *   对话框 160 × 64 像素，位于屏幕底部，单次显示不超过 2 行。
 *   每行不超过 18 个汉字 —— 12 px 点阵下 160 px 面板可用宽 148 px，折行取
 *   12 字一行（12 × 12 = 144），既满足「不超过 18 字」，也守住面板尺寸。
 *   对话逐字显示速度为每秒 24 字，可按交互键立即全部显示。
 *
 * 分页：区域介绍是 60~100 字，两行装不下。原先 wrapLines(..., 2) 会把后面
 * 几十个字直接截掉。这里改成按 2 行一页切开，交互键翻页，读完才关闭。
 *
 * §7.5 UI 采用单线像素边框，边框线宽 1 像素。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var G = CT.Palette.G;
  var gc = CT.Palette.gc;

  var BOX_W = 160;        // §6.3 对话框 160 × 64
  var BOX_H = 64;
  var PAD = 6;
  var TEXT_W = BOX_W - PAD * 2;          // 148 px
  var CPS = 24;                          // §6.3 每秒 24 字
  var LINE_H = 14;
  var LINES_PER_PAGE = 2;                // §6.3 单次显示不超过 2 行

  function Dialogue() {
    this.active = false;
    this.name = '';
    this.pages = [];        // [[line, line], ...]
    this.pageIdx = 0;
    this.revealed = 0;      // 当前页已显示的字符数
    this.onClose = null;
    this.hint = null;
    this.elapsed = 0;
  }

  function paginate(lines) {
    var pages = [];
    for (var i = 0; i < lines.length; i += LINES_PER_PAGE) {
      pages.push(lines.slice(i, i + LINES_PER_PAGE));
    }
    if (!pages.length) pages.push(['']);
    return pages;
  }

  Dialogue.prototype.open = function (name, lines, onClose, opts) {
    opts = opts || {};
    this.active = true;
    this.name = name || '';
    this.pages = paginate(lines && lines.length ? lines : ['']);
    this.pageIdx = 0;
    this.revealed = 0;
    this.elapsed = 0;
    this.onClose = onClose || null;
    this.hint = opts.hint || null;
    this.style = opts.style || 'npc';
    return this;
  };

  // 传入一整段长文本，内部折行 + 分页
  Dialogue.prototype.openText = function (name, text, onClose, opts) {
    var lines = CT.Font.wrap(text, TEXT_W - 2, 0);   // 0 = 不限行数
    return this.open(name, lines, onClose, opts);
  };

  Dialogue.prototype.close = function () {
    var cb = this.onClose;
    this.active = false;
    this.pages = [];
    this.hint = null;
    this.onClose = null;
    if (cb) cb();
  };

  Dialogue.prototype.curLines = function () {
    return this.pages[this.pageIdx] || [''];
  };

  Dialogue.prototype.curLen = function () {
    var ls = this.curLines(), n = 0;
    for (var i = 0; i < ls.length; i++) n += ls[i].length;
    return n;
  };

  Dialogue.prototype.hasMorePages = function () {
    return this.pageIdx < this.pages.length - 1;
  };

  // 交互键：未读完则全显；读完了还有下一页则翻页；最后一页读完关闭
  Dialogue.prototype.advance = function () {
    var all = this.curLen();
    if (this.revealed < all) {
      this.revealed = all;
      return false;
    }
    if (this.hasMorePages()) {
      this.pageIdx++;
      this.revealed = 0;
      this.elapsed = 0;
      return false;
    }
    this.close();
    return true;
  };

  Dialogue.prototype.update = function (dt, audio) {
    if (!this.active) return;
    this.elapsed += dt;
    var want = Math.floor(this.elapsed * CPS);
    var all = this.curLen();
    if (want > all) want = all;
    // 只准往前推进。之前这里是无条件赋值，玩家按交互键把整句显出来之后，
    // 下一帧计时器又把 revealed 算回较小的值，于是「显示全部」被撤销，
    // 快速连按时会觉得按键没反应，必须等满一整句的时长才能翻页。
    if (want <= this.revealed) return;
    if (audio && Math.floor(want / 3) !== Math.floor(this.revealed / 3)) audio.sfx('dialogue');
    this.revealed = want;
  };

  Dialogue.prototype.isRevealing = function () {
    return this.revealed < this.curLen();
  };

  Dialogue.prototype.draw = function (fb, P, VW, VH, time) {
    if (!this.active) return;
    var x = Math.round((VW - BOX_W) / 2);
    var y = VH - BOX_H - 8;

    // 面板：单线像素边框 + 主题角标（§7.5）
    fb.fillRect(x, y, BOX_W, BOX_H, gc(G.PANEL));
    fb.rect(x, y, BOX_W, BOX_H, gc(G.PANEL_HI));
    fb.rect(x + 1, y + 1, BOX_W - 2, BOX_H - 2, gc(G.PANEL_LO));
    var accent = P.c[15];
    fb.fillRect(x + 2, y + 2, 6, 1, accent);
    fb.fillRect(x + 2, y + 2, 1, 4, accent);
    fb.fillRect(x + BOX_W - 8, y + 2, 6, 1, accent);
    fb.fillRect(x + BOX_W - 3, y + 2, 1, 4, accent);
    fb.fillRect(x + 2, y + BOX_H - 3, 6, 1, accent);
    fb.fillRect(x + BOX_W - 8, y + BOX_H - 3, 6, 1, accent);

    var ty = y + PAD;
    var tx = x + PAD;

    if (this.name) {
      CT.Font.draw(fb, this.name, tx, ty, accent, { outline: gc(G.OUTLINE) });
      ty += LINE_H;
    }

    var lines = this.curLines();
    var remain = this.revealed;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var show = Math.max(0, Math.min(ln.length, remain));
      remain -= show;
      if (show > 0) {
        CT.Font.draw(fb, ln, tx, ty, gc(G.TEXT), { outline: gc(G.OUTLINE), limit: show });
      }
      ty += LINE_H;
    }

    // 读完提示：缓慢呼吸的小三角（不构成突发惊吓）
    if (!this.isRevealing()) {
      if ((Math.floor(time * 2) & 1) === 0) {
        var ax = x + BOX_W - 12, ay = y + BOX_H - 10;
        fb.fillRect(ax, ay, 5, 1, accent);
        fb.fillRect(ax + 1, ay + 1, 3, 1, accent);
        fb.fillRect(ax + 2, ay + 2, 1, 1, accent);
      }
    }

    // 还有后续页：标出页码，让玩家知道话没说完
    if (this.hasMorePages() && !this.isRevealing()) {
      var pg = (this.pageIdx + 1) + '/' + this.pages.length;
      CT.Font.drawRight(fb, pg, x + BOX_W - 18, y + BOX_H - 12, P.c[4], { outline: gc(G.OUTLINE) });
    }
  };

  // 按 §6.3 折行：每行最多 12 个汉字（12 px × 12 = 144 px ≤ 148 px 可用宽）
  Dialogue.wrapLines = function (text) {
    return CT.Font.wrap(text, TEXT_W - 2, 2);
  };

  Dialogue.BOX_W = BOX_W;
  Dialogue.BOX_H = BOX_H;
  Dialogue.CPS = CPS;
  Dialogue.TEXT_W = TEXT_W;
  CT.Dialogue = Dialogue;
})();
