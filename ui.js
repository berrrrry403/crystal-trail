/* 晶途拾光 — 界面与控件
 * --------------------------------------------------------------------------
 * §7.5 UI 采用单线像素边框，边框线宽 1 像素；字色取自当前主题调色板。
 * §10.4 安卓端必须提供屏幕控件：左下角虚拟摇杆（直径 96 像素），右下角跳跃键
 *       （72 × 72 像素）与交互键（与跳跃键分离），按钮最小点击区域 44 × 44，
 *       并提供三种预设布局。
 *
 * 触屏控件直接画进帧缓冲，命中测试用同一套矩形 —— 看到的就是可点的。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var G = CT.Palette.G;
  var gc = CT.Palette.gc;
  var A = CT.Art;
  var T = CT.I18N.T;      // 界面文案查表（中文字面量做键）

  // 三种预设布局（§10.4 控件位置、大小、透明度可调）
  var LAYOUTS = [
    {
      name: T('标准'),
      stick: { cx: 66, cy: 204, r: 48, round: true },
      jump: { cx: 398, cy: 202, hw: 36, hh: 36, r: 36, round: true },
      interact: { cx: 328, cy: 240, hw: 24, hh: 24, r: 24, round: true },
      pause: { cx: 452, cy: 26, hw: 22, hh: 22, round: false },
    },
    {
      name: T('紧凑'),
      stick: { cx: 58, cy: 212, r: 40, round: true },
      jump: { cx: 414, cy: 214, hw: 32, hh: 32, r: 32, round: true },
      interact: { cx: 332, cy: 176, hw: 22, hh: 22, r: 22, round: true },
      pause: { cx: 452, cy: 26, hw: 22, hh: 22, round: false },
    },
    {
      name: T('左手'),
      stick: { cx: 412, cy: 204, r: 48, round: true },
      jump: { cx: 82, cy: 202, hw: 36, hh: 36, r: 36, round: true },
      interact: { cx: 152, cy: 240, hw: 24, hh: 24, r: 24, round: true },
      pause: { cx: 28, cy: 26, hw: 22, hh: 22, round: false },
    },
  ];

  function panel(fb, x, y, w, h, P, accent) {
    fb.fillRect(x, y, w, h, gc(G.PANEL));
    fb.rect(x, y, w, h, gc(G.PANEL_HI));
    fb.rect(x + 1, y + 1, w - 2, h - 2, gc(G.PANEL_LO));
    var a = accent !== undefined ? accent : P.c[15];
    fb.fillRect(x + 2, y + 2, 5, 1, a);
    fb.fillRect(x + 2, y + 2, 1, 4, a);
    fb.fillRect(x + w - 7, y + 2, 5, 1, a);
    fb.fillRect(x + w - 3, y + 2, 1, 4, a);
    fb.fillRect(x + 2, y + h - 3, 5, 1, a);
    fb.fillRect(x + w - 7, y + h - 3, 5, 1, a);
  }

  // 居中标题 + 分隔线
  function title(fb, text, cx, y, P) {
    var w = CT.Font.measure(text) + 10;
    CT.Font.drawCentered(fb, text, cx, y, P.c[15], { outline: gc(G.OUTLINE) });
    fb.hline(Math.round(cx - w / 2), y + 14, w, P.c[7]);
  }

  // 菜单项：选中时左侧三角光标 + 强调色
  function menuItem(fb, text, x, y, selected, P, time) {
    var col = selected ? gc(G.TEXT) : gc(G.TEXT_DIM);
    if (selected) {
      var nudge = (Math.floor(time * 4) & 1);
      CT.Font.draw(fb, '>', x - 10 + nudge, y, gc(G.ACCENT), { outline: gc(G.OUTLINE) });
      col = P.c[0];
    }
    CT.Font.draw(fb, text, x, y, col, { outline: gc(G.OUTLINE) });
  }

  function bar(fb, x, y, w, h, frac, P) {
    fb.fillRect(x, y, w, h, gc(G.PANEL_LO));
    fb.rect(x, y, w, h, gc(G.PANEL_HI));
    var fw = Math.max(0, Math.min(w - 2, Math.round((w - 2) * frac)));
    fb.fillRect(x + 1, y + 1, fw, h - 2, P.c[15]);
    fb.fillRectDither(x + 1, y + 1, fw, h - 2, P.c[0], 6);
  }

  // ------------------------------------------------------------ 触屏控件
  function drawTouch(fb, layoutIdx, P, touch, time, alpha) {
    var L = LAYOUTS[layoutIdx] || LAYOUTS[0];
    var lv = alpha === undefined ? 16 : alpha;

    // 摇杆底盘
    var s = L.stick;
    fb.ellipse(s.cx, s.cy, s.r, s.r, gc(G.PANEL_LO));
    // 圆环描边（单线像素边框）
    for (var a = 0; a < 64; a++) {
      var ang = (a / 64) * Math.PI * 2;
      var px = Math.round(s.cx + Math.cos(ang) * s.r);
      var py = Math.round(s.cy + Math.sin(ang) * s.r);
      fb.fillRectDither(px, py, 1, 1, gc(G.PANEL_HI), lv);
    }
    // 摇杆头
    var kx = s.cx + Math.round((touch.stick.x || 0) * (s.r * 0.55));
    var ky = s.cy + Math.round((touch.stick.y || 0) * (s.r * 0.55));
    fb.ellipse(kx, ky, 15, 15, gc(G.PANEL_HI));
    fb.ellipse(kx, ky, 12, 12, P.c[4]);
    fb.ellipse(kx - 3, ky - 3, 4, 4, P.c[2]);

    // 跳跃键 72 × 72
    var j = L.jump;
    fb.ellipse(j.cx, j.cy, j.hw, j.hh, gc(G.PANEL_LO));
    for (var b = 0; b < 48; b++) {
      var a2 = (b / 48) * Math.PI * 2;
      fb.fillRectDither(Math.round(j.cx + Math.cos(a2) * j.hw), Math.round(j.cy + Math.sin(a2) * j.hh),
        1, 1, touch.jumpHeld ? P.c[15] : gc(G.PANEL_HI), lv);
    }
    fb.ellipse(j.cx, j.cy, j.hw - 9, j.hh - 9, touch.jumpHeld ? P.c[6] : gc(G.PANEL_HI));
    CT.Font.drawCentered(fb, T('跳'), j.cx, j.cy - 6, gc(G.TEXT), { outline: gc(G.OUTLINE) });

    // 交互键
    var it = L.interact;
    fb.ellipse(it.cx, it.cy, it.hw, it.hh, gc(G.PANEL_LO));
    fb.ellipse(it.cx, it.cy, it.hw - 5, it.hh - 5, touch.interactHeld ? P.c[6] : gc(G.PANEL_HI));
    CT.Font.drawCentered(fb, T('交'), it.cx, it.cy - 6, gc(G.TEXT), { outline: gc(G.OUTLINE) });

    // 暂停键
    var pz = L.pause;
    fb.fillRect(pz.cx - pz.hw, pz.cy - pz.hh, pz.hw * 2, pz.hh * 2, gc(G.PANEL_LO));
    fb.rect(pz.cx - pz.hw, pz.cy - pz.hh, pz.hw * 2, pz.hh * 2, gc(G.PANEL_HI));
    fb.fillRect(pz.cx - 5, pz.cy - 6, 3, 12, gc(G.TEXT));
    fb.fillRect(pz.cx + 2, pz.cy - 6, 3, 12, gc(G.TEXT));
  }

  CT.UI = {
    LAYOUTS: LAYOUTS,
    panel: panel,
    title: title,
    menuItem: menuItem,
    bar: bar,
    drawTouch: drawTouch,
    hitTest: function (r, x, y) {
      if (!r) return false;
      var dx = x - r.cx, dy = y - r.cy;
      if (r.round) return dx * dx + dy * dy <= r.r * r.r;
      if (r.hw !== undefined) return Math.abs(dx) <= r.hw && Math.abs(dy) <= r.hh;
      return false;
    },
  };
})();
