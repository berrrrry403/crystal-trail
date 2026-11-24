/* 晶途拾光 — 浏览器入口
 * --------------------------------------------------------------------------
 * §7.1 内部渲染分辨率固定 480 × 270，所有美术按 1 倍像素绘制，运行时整数倍放大。
 *      禁止使用非整数缩放。PC 端默认窗口 1440 × 810（3 倍），Android 端按屏幕
 *      宽度取最大整数倍，余量以黑边补齐。
 *
 * 主循环用固定步长 1/60 推进逻辑，渲染每个 rAF 一次：逻辑与帧率解耦，
 * 因此在 30/60/144 Hz 屏幕上手感完全一致（这是「流畅度」的根）。
 */
(function () {
  'use strict';
  var CT = window.CT = window.CT || {};
  var VW = 480, VH = 270;
  var STEP = 1 / 60;
  var MAX_STEPS = 4;

  function boot() {
    var canvas = document.getElementById('screen');
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;

    var off = document.createElement('canvas');
    CT.View.apply(window.innerWidth, window.innerHeight);
    VW = CT.View.VW; VH = CT.View.VH;
    off.width = VW;
    off.height = VH;
    var offCtx = off.getContext('2d', { alpha: false });
    offCtx.imageSmoothingEnabled = false;

    var img = offCtx.createImageData(VW, VH);
    var fb = new CT.FB(VW, VH);
    // 把帧缓冲直接接到 ImageData 的底层字节上，省掉一次逐像素拷贝
    fb.data = new Uint32Array(img.data.buffer);

    var audio = new CT.Audio();
    var game = new CT.Game({ fb: fb, audio: audio, touch: false });

    CT.Input.attach(window);

    // ------------------------------------------------------------ 缩放
    // 尺寸变化时必须重建 ImageData，并把帧缓冲重新别到它的底层字节上，
    // 否则帧缓冲与上传缓冲尺寸对不上，画面会整片空白。
    function rebuildBuffers(vw, vh) {
      // 尺寸没变就别重建（启动时 resize() 会调一次，此时缓冲已经是这个尺寸）
      if (img && img.width === vw && img.height === vh &&
          game.fb && game.fb.w === vw && game.fb.h === vh) return;
      off.width = vw;
      off.height = vh;
      offCtx = off.getContext('2d', { alpha: false });
      offCtx.imageSmoothingEnabled = false;
      img = offCtx.createImageData(vw, vh);
      fb = new CT.FB(vw, vh);
      fb.data = new Uint32Array(img.data.buffer);
      game.fb = fb;
      if (typeof game.onResize === 'function') game.onResize();
    }

    function resize() {
      var maxW = window.innerWidth, maxH = window.innerHeight;
      // 逻辑分辨率跟着窗口放大，再用整数倍缩放铺满。
      // 这样没有黑边，也不会像「拉伸」那样把像素搞花，
      // 更不会像「裁剪」那样切掉 HUD 与顶部标题。
      var v = CT.View.apply(maxW, maxH);
      canvas.width = v.vw * v.scale;
      canvas.height = v.vh * v.scale;
      canvas.style.width = (v.vw * v.scale) + 'px';
      canvas.style.height = (v.vh * v.scale) + 'px';
      canvas.style.left = Math.round((maxW - v.vw * v.scale) / 2) + 'px';
      canvas.style.top = Math.round((maxH - v.vh * v.scale) / 2) + 'px';
      ctx.imageSmoothingEnabled = false;
      rebuildBuffers(v.vw, v.vh);
    }
    window.addEventListener('resize', resize);
    resize();

    // ------------------------------------------------------------ 触屏
    var isTouch = CT.Input.isTouchDevice();
    game.touchActive = isTouch;
    CT.Input.touch.active = isTouch;

    function toWorld(ev) {
      var r = canvas.getBoundingClientRect();
      // 逻辑分辨率会随窗口变化，映射时用当前值
      var x = ((ev.clientX - r.left) / r.width) * CT.View.VW;
      var y = ((ev.clientY - r.top) / r.height) * CT.View.VH;
      return { x: x, y: y };
    }

    function layoutNow() {
      var lay = (game.save && game.save.settings) ? (game.save.settings.touchLayout || 0) : game.layoutIdx;
      return CT.UI.LAYOUTS[lay] || CT.UI.LAYOUTS[0];
    }

    canvas.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      audio.resume();
      if (!game.touchActive) return;
      CT.Input.setTouchLayout(layoutNow());
      var p = toWorld(ev);
      CT.Input.onPointer('down', ev.pointerId, p.x, p.y);
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (!game.touchActive) return;
      var p = toWorld(ev);
      CT.Input.onPointer('move', ev.pointerId, p.x, p.y);
    });
    function pointerUp(ev) {
      if (!game.touchActive) return;
      CT.Input.onPointer('up', ev.pointerId, 0, 0);
    }
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);

    // 任意实体按键激活音频上下文（浏览器要求用户手势）
    window.addEventListener('keydown', function () { audio.resume(); }, { once: true });
    window.addEventListener('pointerdown', function () { audio.resume(); }, { once: true });

    // 失焦时暂停音乐（§8.5 切到后台立即暂停）
    window.addEventListener('blur', function () {
      audio.paused = true;
      if (game.state === CT.Game.STATE.PLAYING) {
        game.state = CT.Game.STATE.PAUSED;
        game.pauseIndex = 0;
      }
    });
    window.addEventListener('focus', function () { audio.paused = false; });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        audio.paused = true;
        if (game.state === CT.Game.STATE.PLAYING) { game.state = CT.Game.STATE.PAUSED; game.pauseIndex = 0; }
        if (game.save) game.persist();
      } else {
        audio.paused = false;
      }
    });

    // ------------------------------------------------------------ 主循环
    var last = 0, acc = 0;
    var running = true;

    function frame(now) {
      if (!running) return;
      if (!last) last = now;
      var dt = (now - last) / 1000;
      last = now;
      // 标签页切回来时会有巨大的 dt，钳住避免一次性补上百步
      if (dt > 0.25) dt = 0.25;
      acc += dt;
      var steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        var input = CT.Input.beginStep();
        game.step(STEP, input);
        CT.Input.endStep();
        acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) acc = 0;

      // 渲染
      game.render();
      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // 调试挂钩（无头 QA 与手工排查都用得到）
    CT._debug = {
      game: game, fb: fb, audio: audio, ctx: ctx, off: off,
      stepOnce: function (n) {
        for (var i = 0; i < (n || 1); i++) {
          var input = CT.Input.beginStep();
          game.step(STEP, input);
          CT.Input.endStep();
        }
      },
      setState: function (s) { game.state = s; },
      startAt: function (levelId, slot) {
        game.save = CT.Save.newSave(slot === undefined ? 1 : slot);
        game.collected = {};
        game.enterLevel(levelId);
        game.state = CT.Game.STATE.PLAYING;
      },
    };
    window.__CRYSTAL_TRAIL__ = CT._debug;

    // 首屏提示
    if (!CT.Input.isTouchDevice()) {
      // 让标题页先渲染出来再让位
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
