/* 晶途拾光 — 粒子
 * --------------------------------------------------------------------------
 * §7.4 粒子系统只允许三种：
 *   环境粒子（落叶、雪絮、星尘、气泡）
 *   交互粒子（踩踏扬尘、拾取闪光）
 *   提示粒子（路标气泡）
 * 单屏同屏粒子数上限 60，单个粒子尺寸不超过 4 × 4 像素，
 * 禁止发光拖尾与镜头光晕。
 *
 * 实现为一个固定池：所有粒子在构造期一次分配，运行期不再 new 任何对象，
 * 因此不会在 60 帧的热路径上触发 GC。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var MAX = 60;                 // §7.4 单屏上限
  var KIND = { AMBIENT: 0, INTERACT: 1, HINT: 2 };

  function Particles() {
    this.n = 0;
    // 预分配池
    this.x = new Float32Array(MAX);
    this.y = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);
    this.color = new Uint32Array(MAX);
    this.w = new Uint8Array(MAX);
    this.h = new Uint8Array(MAX);
    this.phase = new Float32Array(MAX);
    this.ambientTimer = 0;
    this.ambientKind = 0;       // 0 落叶 1 雪絮 2 星尘 3 气泡
    this.ambientColor = 0;
  }

  Particles.prototype.clear = function () { this.n = 0; this.ambientTimer = 0; };

  Particles.prototype.setTheme = function (themeKey, P) {
    // 每个主题的环境粒子有自己的形态与颜色
    if (themeKey === 'forest') { this.ambientKind = 0; this.ambientColor = P.c[7]; }
    else if (themeKey === 'amber') { this.ambientKind = 3; this.ambientColor = P.c[11]; }
    else if (themeKey === 'cloud') { this.ambientKind = 1; this.ambientColor = P.c[0]; }
    else if (themeKey === 'water') { this.ambientKind = 3; this.ambientColor = P.c[15]; }
    else { this.ambientKind = 2; this.ambientColor = P.c[0]; }
    this.P = P;
  };

  // 分配一个槽位；池满则复用最老的
  Particles.prototype._alloc = function () {
    if (this.n < MAX) return this.n++;
    var oldest = 0, best = Infinity;
    for (var i = 0; i < MAX; i++) {
      if (this.life[i] < best) { best = this.life[i]; oldest = i; }
    }
    return oldest;
  };

  Particles.prototype.spawn = function (kind, x, y, vx, vy, life, color, w, h) {
    var i = this._alloc();
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life;
    this.kind[i] = kind;
    this.color[i] = color >>> 0;
    this.w[i] = w; this.h[i] = h;
    this.phase[i] = Math.random() * 6.283;
    return i;
  };

  // §7.4 交互粒子：踩踏扬尘
  Particles.prototype.dust = function (x, y, P) {
    for (var i = 0; i < 4; i++) {
      this.spawn(KIND.INTERACT, x, y,
        (Math.random() - 0.5) * 40, -10 - Math.random() * 20,
        0.25 + Math.random() * 0.2, P.c[2], 2, 2);
    }
  };

  // §7.4 交互粒子：拾取闪光
  Particles.prototype.sparkle = function (x, y, color) {
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2;
      this.spawn(KIND.INTERACT, x, y,
        Math.cos(a) * 42, Math.sin(a) * 42,
        0.3 + Math.random() * 0.2, color, 2, 2);
    }
  };

  // §7.4 提示粒子：路标气泡
  Particles.prototype.hintBubble = function (x, y, color) {
    this.spawn(KIND.HINT, x, y, 0, -14, 0.9, color, 3, 3);
  };

  // 环境粒子按主题持续滴落
  Particles.prototype.ambientTick = function (dt, camX, camY) {
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 0.16;
    var k = this.ambientKind;
    var x = camX + Math.random() * 480;
    var y = camY - 6;
    if (k === 0) {
      // 落叶：左右飘
      this.spawn(KIND.AMBIENT, x, y, -12 + Math.random() * 24, 26 + Math.random() * 18,
        3.2, this.ambientColor, 3, 2);
    } else if (k === 1) {
      // 雪絮：慢速下落
      this.spawn(KIND.AMBIENT, x, y, -6 + Math.random() * 12, 16 + Math.random() * 10,
        4.5, this.ambientColor, 2, 2);
    } else if (k === 2) {
      // 星尘：几乎静止的悬浮
      this.spawn(KIND.AMBIENT, x, camY + Math.random() * 270, -4 + Math.random() * 8,
        -6 + Math.random() * 12, 3.0, this.ambientColor, 2, 2);
    } else {
      // 气泡：从底部上升
      this.spawn(KIND.AMBIENT, x, camY + 276, -6 + Math.random() * 12, -30 - Math.random() * 20,
        2.6, this.ambientColor, 2, 2);
    }
  };

  Particles.prototype.update = function (dt) {
    var n = this.n;
    var i = 0;
    while (i < n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // 交换删除，保持池紧凑
        n--;
        if (i !== n) {
          this.x[i] = this.x[n]; this.y[i] = this.y[n];
          this.vx[i] = this.vx[n]; this.vy[i] = this.vy[n];
          this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n];
          this.kind[i] = this.kind[n]; this.color[i] = this.color[n];
          this.w[i] = this.w[n]; this.h[i] = this.h[n];
          this.phase[i] = this.phase[n];
        }
        continue;
      }
      var k = this.kind[i];
      if (k === KIND.AMBIENT) {
        // 环境粒子轻微摆动（落叶/气泡感）
        this.vx[i] += Math.sin(this.phase[i] + this.life[i] * 3) * 14 * dt;
        if (this.vx[i] > 30) this.vx[i] = 30;
        if (this.vx[i] < -30) this.vx[i] = -30;
      } else if (k === KIND.INTERACT) {
        this.vy[i] += 80 * dt;
        this.vx[i] *= (1 - 2.2 * dt);
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
    this.n = n;
  };

  Particles.prototype.draw = function (fb, camX, camY) {
    for (var i = 0; i < this.n; i++) {
      var x = Math.round(this.x[i] - camX);
      var y = Math.round(this.y[i] - camY);
      if (x < -8 || y < -8 || x > 488 || y > 278) continue;
      // 生命末段用抖动淡出（§7.2 渐变只用抖动实现）
      var t = this.life[i] / this.maxLife[i];
      var w = this.w[i], h = this.h[i];
      if (t < 0.3) {
        if (t < 0.15 && this.kind[i] === KIND.INTERACT) continue;
        fb.fillRectDither(x, y, w, h, this.color[i], Math.max(1, Math.round(t * 16)));
      } else {
        fb.fillRect(x, y, w, h, this.color[i]);
      }
    }
  };

  Particles.MAX = MAX;
  Particles.KIND = KIND;
  CT.Particles = Particles;
})();
