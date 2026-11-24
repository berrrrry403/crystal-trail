/* 晶途拾光 — 镜头
 * --------------------------------------------------------------------------
 * §4.6 交互与镜头
 *   镜头跟随使用 0.12 的插值系数，画面在关卡边界处硬限制；
 *   玩家到达隐藏区域入口时，镜头先向内偏移 32 像素做一次提示性窥视，
 *   0.8 秒后回正。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var VW = 480, VH = 270;
  var LERP = 0.12;

  function Camera() {
    this.x = 0; this.y = 0;
    this.tx = 0; this.ty = 0;
    this.peek = null;      // {dx, dy, t, dur}
    this.shake = 0;        // 本作不使用镜头抖动（§2.3 不制造突发惊吓）
  }

  Camera.prototype.snapTo = function (player, level) {
    var t = this.targetFor(player, level);
    this.x = t.x; this.y = t.y;
    // 这里也必须钳一次。进关瞬间主角靠左时 targetFor 会给出负的 x，
    // 而开场对话激活期间 stepPlaying 提前 return、update() 不跑，
    // 负偏移会一直留着，把左边界墙画到屏幕中间。
    this.clampTo(level);
    this.tx = this.x; this.ty = this.y;
  };

  Camera.prototype.targetFor = function (player, level) {
    var x = player.centreX() - VW / 2;
    // 竖直方向略微上移取景：主角坐在屏幕偏下方，上方留出更多天空与平台，
    // 同时减少地面以下可见的实心面积。
    var y = player.y + player.h / 2 - VH * 0.66;
    return { x: x, y: y };
  };

  Camera.prototype.clampTo = function (level) {
    var maxX = Math.max(0, level.pxW - VW);
    var maxY = Math.max(0, level.pxH - VH);
    if (this.x < 0) this.x = 0;
    if (this.x > maxX) this.x = maxX;
    if (this.y < 0) this.y = 0;
    if (this.y > maxY) this.y = maxY;
  };

  Camera.prototype.update = function (dt, player, level) {
    var t = this.targetFor(player, level);
    var px = t.x, py = t.y;

    // §4.6 隐藏区域窥视：偏移 32 像素，0.8 秒后回正
    if (this.peek) {
      this.peek.t += dt;
      var k = this.peek.t / this.peek.dur;
      if (k >= 1) {
        this.peek = null;
      } else {
        // 缓入缓出的三角权重，避免镜头突然跳动
        var w = k < 0.15 ? (k / 0.15) : (k > 0.75 ? (1 - (k - 0.75) / 0.25) : 1);
        px += this.peek.dx * w;
        py += this.peek.dy * w;
      }
    }

    this.tx = px; this.ty = py;
    this.x += (this.tx - this.x) * LERP;
    this.y += (this.ty - this.y) * LERP;
    this.clampTo(level);
  };

  // 触发一次窥视（隐藏区域入口）
  Camera.prototype.startPeek = function (dx, dy) {
    if (this.peek) return false;
    this.peek = { dx: dx, dy: dy, t: 0, dur: 0.8 };
    return true;
  };

  Camera.prototype.renderX = function () { return Math.round(this.x); };
  Camera.prototype.renderY = function () { return Math.round(this.y); };

  Camera.VW = VW; Camera.VH = VH; Camera.LERP = LERP;
  CT.Camera = Camera;
})();
