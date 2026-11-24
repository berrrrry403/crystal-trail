/* 晶途拾光 — 输入
 * --------------------------------------------------------------------------
 * §10.4 输入与界面适配
 *   PC：方向键或 WASD 移动，空格跳跃，E 或回车交互，Esc 暂停；手柄 Xbox 布局
 *   Android：左下角虚拟摇杆（直径 96 像素），右下角跳跃键（72×72）与交互键，
 *            按钮最小点击区域 44×44，提供三种预设布局
 *
 * 触屏控件不画在 DOM 上，而是画进帧缓冲并在这里做命中测试 —— 这样屏幕上看到
 * 的控件与判定区域必然一致，且渲染路径与桌面端完全相同。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var K = {
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    jump: ['Space', 'KeyJ'],
    interact: ['KeyE', 'Enter', 'KeyF'],
    pause: ['Escape', 'KeyP'],
  };

  var Input = {
    // 原始按键
    down: Object.create(null),
    // 本步的边沿
    _pressed: Object.create(null),
    _released: Object.create(null),

    // 触屏
    touch: {
      active: false,          // 是否显示控件
      stick: { x: 0, y: 0 },  // -1..1 归一化方向
      stickId: -1,
      stickOrigin: { x: 0, y: 0 },
      jumpHeld: false,
      jumpId: -1,
      interactHeld: false,
      interactId: -1,
      pauseTapped: false,
    },

    // 手柄
    pad: { connected: false, ax: 0, jump: false, interact: false, pause: false },

    _prevPadJump: false,
    _prevPadInteract: false,
    _prevPadPause: false,
  };

  // --------------------------------------------------------------- 键盘
  Input.attach = function (target) {
    if (!target.addEventListener) return;
    target.addEventListener('keydown', function (e) {
      // 取名界面：按键交给隐藏文本框（支持中文输入法的浏览器里由 input 自己处理）
      if (CT.TextInput && CT.TextInput.active) {
        // 可打印字符交给文本框；回车 / Esc / 方向键必须继续交给游戏，
        // 否则取名页里连「确定」都按不动。
        CT.TextInput.feedKeyCode(e.code, e.key);
        var navKey = (e.code === 'Enter' || e.code === 'Escape' ||
                      e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
                      e.code === 'ArrowLeft' || e.code === 'ArrowRight');
        if (!navKey) return;
      }
      if (e.repeat) { e.preventDefault(); return; }
      if (!Input.down[e.code]) Input._pressed[e.code] = true;
      Input.down[e.code] = true;
      // 避免空格滚动页面
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
    });
    target.addEventListener('keyup', function (e) {
      if (Input.down[e.code]) Input._released[e.code] = true;
      Input.down[e.code] = false;
    });
    target.addEventListener('blur', function () {
      for (var k in Input.down) Input.down[k] = false;
    });
  };

  function anyDown(list) {
    for (var i = 0; i < list.length; i++) if (Input.down[list[i]]) return true;
    return false;
  }
  function anyPressed(list) {
    for (var i = 0; i < list.length; i++) if (Input._pressed[list[i]]) return true;
    return false;
  }
  function anyReleased(list) {
    for (var i = 0; i < list.length; i++) if (Input._released[list[i]]) return true;
    return false;
  }

  // --------------------------------------------------------------- 手柄
  var PAD_DEAD = 0.35;
  Input.pollPad = function () {
    var pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : null;
    var p = null;
    if (pads) {
      for (var i = 0; i < pads.length; i++) if (pads[i]) { p = pads[i]; break; }
    }
    var st = Input.pad;
    if (!p) { st.connected = false; st.ax = 0; st.jump = false; st.interact = false; st.pause = false; return; }
    st.connected = true;
    var ax = p.axes && p.axes.length ? p.axes[0] : 0;
    if (Math.abs(ax) < PAD_DEAD) ax = 0;
    st.ax = ax;
    var b = p.buttons || [];
    st.jump = !!(b[0] && b[0].pressed);       // A
    st.interact = !!(b[2] && b[2].pressed);    // X
    st.pause = !!(b[9] && b[9].pressed);       // Start
  };

  // --------------------------------------------------------------- 触屏
  // 命中测试用的布局在 ui.js 里定义，这里只接受已换算好的世界坐标
  Input.setTouchLayout = function (layout) { Input._layout = layout; };

  Input.onPointer = function (type, id, x, y) {
    var L = Input._layout;
    if (!L) return false;
    var T = Input.touch;
    if (type === 'down') {
      // 暂停键优先
      if (hit(L.pause, x, y)) { T.pauseTapped = true; return true; }
      if (hit(L.interact, x, y)) { T.interactId = id; T.interactHeld = true; return true; }
      if (hit(L.jump, x, y)) { T.jumpId = id; T.jumpHeld = true; return true; }
      if (hit(L.stick, x, y)) {
        T.stickId = id;
        T.stickOrigin.x = L.stick.cx;
        T.stickOrigin.y = L.stick.cy;
        updateStick(x, y);
        return true;
      }
      return false;
    }
    if (type === 'move') {
      if (id === T.stickId) { updateStick(x, y); return true; }
      return false;
    }
    if (type === 'up' || type === 'cancel') {
      if (id === T.stickId) { T.stickId = -1; T.stick.x = 0; T.stick.y = 0; return true; }
      if (id === T.jumpId) { T.jumpId = -1; T.jumpHeld = false; return true; }
      if (id === T.interactId) { T.interactId = -1; T.interactHeld = false; return true; }
      return false;
    }
    return false;
  };

  function hit(r, x, y) {
    if (!r) return false;
    var dx = x - r.cx, dy = y - r.cy;
    if (r.round) return dx * dx + dy * dy <= r.r * r.r;
    return Math.abs(dx) <= r.hw && Math.abs(dy) <= r.hh;
  }

  function updateStick(x, y) {
    var L = Input._layout;
    var T = Input.touch;
    var dx = x - T.stickOrigin.x;
    var dy = y - T.stickOrigin.y;
    var r = L.stick.r;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > r) { dx = (dx / d) * r; dy = (dy / d) * r; d = r; }
    var dead = r * 0.22;
    if (d < dead) { T.stick.x = 0; T.stick.y = 0; return; }
    var nx = dx / r, ny = dy / r;
    var m = Math.sqrt(nx * nx + ny * ny);
    if (m > 1) { nx /= m; ny /= m; }
    // 摇杆支持八向（§10.4）：把方向吸附到 8 个方位
    var ang = Math.atan2(ny, nx);
    var oct = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    var ax = Math.cos(oct), ay = Math.sin(oct);
    var mag = Math.min(1, m * 1.15);
    T.stick.x = Math.abs(ax) < 0.4 ? 0 : (ax > 0 ? 1 : -1) * mag;
    T.stick.y = Math.abs(ay) < 0.4 ? 0 : (ay > 0 ? 1 : -1) * mag;
    // 八向吸附后仍保留摇杆的模拟偏移用于显示
    T.stickRawX = nx; T.stickRawY = ny;
  }

  // ------------------------------------------------------------- 每步刷新
  // 输出统一的“意图”给游戏逻辑
  var out = {
    left: false, right: false, up: false, down: false,
    upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
    stickUp: false, stickDown: false,
    jumpHeld: false, jumpPressed: false, jumpReleased: false,
    interactHeld: false, interactPressed: false,
    pausePressed: false,
    axis: 0,              // -1..1 水平，触屏摇杆可用
  };

  Input.beginStep = function () {
    Input.pollPad();
    var T = Input.touch, P = Input.pad;

    var keyLeft = anyDown(K.left), keyRight = anyDown(K.right);

    out.left = keyLeft || T.stick.x < -0.3 || P.ax < -PAD_DEAD;
    out.right = keyRight || T.stick.x > 0.3 || P.ax > PAD_DEAD;
    out.up = anyDown(K.up) || T.stick.y < -0.3;
    out.down = anyDown(K.down) || T.stick.y > 0.3;

    // 方向边沿（含摇杆过死区的瞬间），菜单用
    out.leftPressed = anyPressed(K.left) || (out.left && !Input._prevLeft);
    out.rightPressed = anyPressed(K.right) || (out.right && !Input._prevRight);
    out.upPressed = anyPressed(K.up) || (out.up && !Input._prevUp);
    out.downPressed = anyPressed(K.down) || (out.down && !Input._prevDown);
    // 模拟摇杆单独一次“推到底”的边沿，用于菜单上下移动
    out.stickUp = (T.stick.y < -0.6) && !(Input._prevStickY < -0.6);
    out.stickDown = (T.stick.y > 0.6) && !(Input._prevStickY > 0.6);
    Input._prevLeft = out.left; Input._prevRight = out.right;
    Input._prevUp = out.up; Input._prevDown = out.down;
    Input._prevStickY = T.stick.y;

    out.axis = (out.right ? 1 : 0) - (out.left ? 1 : 0);

    var keyJump = anyDown(K.jump), keyInt = anyDown(K.interact);
    var jumpHeldNow = keyJump || T.jumpHeld || P.jump;
    var wasJumpHeld = Input._jumpHeld || false;
    out.jumpHeld = jumpHeldNow;
    out.jumpPressed = anyPressed(K.jump) || (T.jumpHeld && !Input._touchJumpPrev) ||
      (P.jump && !Input._prevPadJump);
    out.jumpReleased = anyReleased(K.jump) || (wasJumpHeld && !jumpHeldNow);
    Input._jumpHeld = jumpHeldNow;
    Input._touchJumpPrev = T.jumpHeld;
    Input._prevPadJump = P.jump;

    out.interactHeld = keyInt || T.interactHeld || P.interact;
    out.interactPressed = anyPressed(K.interact) || (T.interactHeld && !Input._touchIntPrev) ||
      (P.interact && !Input._prevPadInteract);
    Input._touchIntPrev = T.interactHeld;
    Input._prevPadInteract = P.interact;

    out.pausePressed = anyPressed(K.pause) || (T.pauseTapped) || (P.pause && !Input._prevPadPause);
    T.pauseTapped = false;
    Input._prevPadPause = P.pause;

    return out;
  };

  // 边沿表在一步结束后清空
  Input.endStep = function () {
    Input._pressed = Object.create(null);
    Input._released = Object.create(null);
  };

  Input.isTouchDevice = function () {
    if (typeof navigator === 'undefined') return false;
    return (navigator.maxTouchPoints || 0) > 0 || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
  };

  CT.Input = Input;
})();
