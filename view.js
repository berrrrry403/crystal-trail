/* 晶途拾光 — 视口
 * --------------------------------------------------------------------------
 * 原先逻辑分辨率写死 480 × 270，再由 main.js 按整数倍放大、居中留黑边。
 * 需求要求「铺满页面、不要黑边」，而直接拉伸会破坏像素，裁剪又会切掉 HUD。
 *
 * 这里的做法是：把「逻辑分辨率」本身跟着窗口放大。
 *   · 先取一个整数缩放倍率 sc（保证 480 × 270 放得下）
 *   · 再把逻辑分辨率抬高到 (窗口宽 / sc, 窗口高 / sc)
 * 于是画布正好铺满窗口、每个像素仍是 sc × sc 的整数块，
 * 世界视野变大，HUD 依旧贴着真实边缘，不需要任何裁剪。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var DESIGN_W = 480;      // 设计基准（§7.1 480 × 270）
  var DESIGN_H = 270;
  // 成本上限只是保险丝：倍率越高逻辑分辨率越小，正常窗口根本碰不到。
  // 定得太低会反噬 —— 小窗口（如 800×600）在 1 倍下会被截短、露出边。
  var MAX_W = 1280;
  var MAX_H = 800;

  var View = {
    DESIGN_W: DESIGN_W,
    DESIGN_H: DESIGN_H,
    VW: DESIGN_W,
    VH: DESIGN_H,
    scale: 1,

    /**
     * 根据窗口尺寸算出逻辑分辨率与整数倍率。
     * @returns {{vw:number, vh:number, scale:number}}
     */
    compute: function (winW, winH) {
      // 无头环境可能拿不到窗口尺寸，退回设计基准
      var w = (typeof winW === 'number' && isFinite(winW) && winW > 0) ? Math.floor(winW) : DESIGN_W;
      var h = (typeof winH === 'number' && isFinite(winH) && winH > 0) ? Math.floor(winH) : DESIGN_H;
      // 能放下设计基准的最大整数倍率
      var sc = Math.floor(Math.min(w / DESIGN_W, h / DESIGN_H));
      if (!isFinite(sc) || sc < 1) sc = 1;
      // 逻辑分辨率抬到铺满窗口
      var vw = Math.ceil(w / sc);
      var vh = Math.ceil(h / sc);
      // 上限保护
      if (vw > MAX_W) { vw = MAX_W; sc = Math.max(1, Math.floor(w / MAX_W)); }
      if (vh > MAX_H) { vh = MAX_H; sc = Math.max(1, Math.floor(h / MAX_H)); }
      // 下限保护：至少是设计基准
      if (vw < DESIGN_W) vw = DESIGN_W;
      if (vh < DESIGN_H) vh = DESIGN_H;
      return { vw: vw, vh: vh, scale: sc };
    },

    apply: function (winW, winH) {
      var r = this.compute(winW, winH);
      this.VW = r.vw;
      this.VH = r.vh;
      this.scale = r.scale;
      return r;
    },

    reset: function () {
      this.VW = DESIGN_W;
      this.VH = DESIGN_H;
      this.scale = 1;
    },
  };

  CT.View = View;
})();
