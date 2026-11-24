/* 晶途拾光 — 主角物理
 * --------------------------------------------------------------------------
 * §4.1 移动与物理（数值逐条照抄，单位 像素/秒、像素/秒²，基准瓦片 16 px）
 *   水平移动速度        90
 *   加速度 / 减速度     12 / 14（倍率）
 *   跳跃初速度          -260（向上）
 *   重力加速度          640
 *   可变跳跃高度        松键即减速
 *   土狼时间            100 毫秒
 *   跳跃缓冲            120 毫秒
 *   下落穿层            按住下键
 * §3.1 碰撞盒 10 × 20 像素，居中偏下，左右各留 3 像素余量。
 *
 * 手感要点：物理用固定步长积分（main.js 保证 1/60 步长），碰撞用子步推进
 * 避免高速穿模；所有热路径上的量都是预分配的标量，不产生任何临时对象。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var TS = 16;

  var SPEED = 90;
  var ACCEL_MULT = 12;
  var DECEL_MULT = 14;
  var ACCEL = SPEED * ACCEL_MULT;        // 1080 px/s²
  var DECEL = SPEED * DECEL_MULT;        // 1260 px/s²
  var JUMP_V = -260;
  var GRAVITY = 640;
  var COYOTE = 0.100;                    // §4.1 土狼时间 100 ms
  var JUMP_BUFFER = 0.120;               // §4.1 跳跃缓冲 120 ms
  var MAX_FALL = 620;
  var BOX_W = 10, BOX_H = 20;            // §3.1 碰撞盒
  var SPRITE_W = 16, SPRITE_H = 24;

  function Player() {
    this.w = BOX_W;
    this.h = BOX_H;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.coyote = 0;
    this.buffer = 0;
    this.jumpHeldLast = false;
    this.anim = 'idle';
    this.animTime = 0;
    this.animFrame = 0;
    this.pickupTimer = 0;
    this.talkTimer = 0;
    this.dropThrough = 0;         // 穿层冷却，避免一按就掉
    this.riding = null;           // 站着的浮台
    this.externalVX = 0;
    this.externalVY = 0;
    this.spawnX = 0; this.spawnY = 0;
  }

  Player.prototype.reset = function (px, py) {
    this.x = px; this.y = py;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.coyote = 0; this.buffer = 0;
    this.anim = 'idle'; this.animTime = 0; this.animFrame = 0;
    this.pickupTimer = 0; this.talkTimer = 0;
    this.riding = null;
  };

  Player.prototype.centreX = function () { return this.x + this.w / 2; };
  Player.prototype.bottom = function () { return this.y + this.h; };

  // 子步像素推进：单次位移不超过 2 像素，彻底避免穿透
  var MAX_STEP = 2;

  Player.prototype.step = function (dt, level, input, mechWorld) {
    // 记录「上一帧是不是已经踩在地上」。
    // 站着不动时重力每帧都会把身体往下压 0.2 像素、随即被碰撞弹回，
    // 于是 moveY 每帧都认为「刚落地」——落地扬尘和落地音效会在脚边
    // 连喷成一片，看起来就像一直在跺脚。
    var wasGrounded = this.onGround;
    // ---------------------------------------------------------- 水平速度
    var axis = input.axis;
    var target = axis * SPEED;
    var rate;
    if (axis !== 0) {
      rate = ACCEL;
      // 反向输入时用减速度，转手更利落
      if (this.vx !== 0 && (this.vx > 0) !== (axis > 0)) rate = DECEL;
    } else {
      rate = DECEL;
    }
    if (this.vx < target) this.vx = Math.min(target, this.vx + rate * dt);
    else if (this.vx > target) this.vx = Math.max(target, this.vx - rate * dt);

    if (axis !== 0) this.facing = axis > 0 ? 1 : -1;

    // ---------------------------------------------------------- 计时器
    this.coyote = this.onGround ? COYOTE : Math.max(0, this.coyote - dt);
    this.dropThrough = Math.max(0, this.dropThrough - dt);
    if (input.jumpPressed) this.buffer = JUMP_BUFFER;
    else this.buffer = Math.max(0, this.buffer - dt);

    // ---------------------------------------------------------- 跳跃
    var wantJump = this.buffer > 0 && this.coyote > 0;
    var wantDrop = input.down && this.onGround && this.dropThrough <= 0;
    if (wantDrop) {
      // §4.1 下落穿层：按住下键穿过单向平台
      this.dropThrough = 0.18;
      this.onGround = false;
      this.coyote = 0;
      this.y += 1;
    } else if (wantJump) {
      this.vy = JUMP_V;
      this.onGround = false;
      this.coyote = 0;
      this.buffer = 0;
      if (mechWorld) mechWorld.onPlayerJump(this);
    }
    // 可变跳跃高度：松键即减速（§4.1）
    if (!input.jumpHeld && this.vy < 0 && this.jumpHeldLast) {
      this.vy *= 0.42;
    }
    this.jumpHeldLast = input.jumpHeld;

    // ---------------------------------------------------------- 重力
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;

    // 外力（风场、水流浮力）
    var evx = this.externalVX, evy = this.externalVY;
    this.externalVX = 0; this.externalVY = 0;

    var totalVX = this.vx + evx;
    var totalVY = this.vy + evy;

    // ---------------------------------------------------------- 推进
    var wasBottom = this.bottom();
    this.moveX(totalVX * dt, level);
    var landedY = this.moveY(totalVY * dt, level, wasBottom);

    // ---------------------------------------------------------- 斜坡贴合
    this.snapSlope(level);
    // ---------------------------------------------------------- 防卡死保险
    this.deEmbed(level);

    // 只有「腾空 -> 落地」这一下才算落地；一直站着不算
    return (!wasGrounded && this.onGround) ? 1 : 0;
  };

  Player.prototype.moveX = function (dx, level) {
    if (dx === 0) return;
    var remaining = dx;
    var sign = dx > 0 ? 1 : -1;
    while (remaining !== 0) {
      var step = Math.abs(remaining) > MAX_STEP ? MAX_STEP * sign : remaining;
      remaining -= step;
      this.x += step;
      if (level.rectSolid(this.x, this.y + 0.5, this.w, this.h - 1)) {
        // 退回并贴墙
        this.x -= step;
        this.vx = 0;
        // 沿斜坡向上滑（贴墙时允许爬坡 1 像素）
        if (!this.tryStepUp(level, sign)) break;
      }
    }
  };

  // 遇到 1~2 像素高的坎时自动抬升，避免贴墙卡住。
  // 只允许抬 1~2 像素 —— 抬得动的是小台阶，抬不动的是墙，不能靠它「爬」上台沿。
  Player.prototype.tryStepUp = function (level, sign) {
    var probeX = this.x + (sign > 0 ? this.w - 1 : 0) + sign;
    var feetY = this.bottom() - 1;
    for (var up = 1; up <= 2; up++) {
      // 抬起后落脚点必须是空的，且整条身体也不能插进地形
      if (!level.rectSolid(probeX, feetY - up, 1, 1) &&
          !level.rectSolid(this.x + sign, this.y - up, this.w, this.h)) {
        this.y -= up;
        this.x += sign;
        return true;
      }
    }
    return false;
  };

  Player.prototype.moveY = function (dy, level, prevBottom) {
    if (dy === 0) { this.onGround = this.detectGround(level, prevBottom); return 0; }
    var remaining = dy;
    var sign = dy > 0 ? 1 : -1;
    var landed = 0;
    while (remaining !== 0) {
      var step = Math.abs(remaining) > MAX_STEP ? MAX_STEP * sign : remaining;
      remaining -= step;
      this.y += step;
      if (sign > 0) {
        // 下落：先看实心地面
        if (level.rectSolid(this.x, this.y + 0.5, this.w, this.h - 0.5)) {
          var snapped = this.snapToGround(level);
          if (snapped !== null) { this.y = snapped; }
          else { this.y -= step; }
          this.vy = 0;
          this.onGround = true;
          landed = 1;
          break;
        }
        // 再看单向平台
        if (this.dropThrough <= 0) {
          var top = level.platformBelow(this.x, this.y, this.w, this.h, prevBottom);
          if (top >= 0) {
            this.y = top - this.h;
            this.vy = 0;
            this.onGround = true;
            landed = 1;
            break;
          }
        }
      } else {
        if (level.rectSolid(this.x, this.y, this.w, this.h)) {
          this.y -= step;
          this.vy = 0;
          break;
        }
      }
    }
    if (!landed) this.onGround = this.detectGround(level, prevBottom);
    return landed;
  };

  // 落地时精确贴到瓦片顶面。
  // 注意必须用「整个碰撞盒」判断，不能只探一行像素 —— 只探一行会让玩家卡在
  // 平台侧面时被判定为「已经站好」，从而永久卡死。
  Player.prototype.snapToGround = function (level) {
    for (var up = 1; up <= 20; up++) {
      if (!level.rectSolid(this.x, this.y - up, this.w, this.h)) {
        return this.y - up;
      }
    }
    return null;
  };

  // 防卡死：一帧结束后如果碰撞盒仍与地形重叠，沿最小位移方向推出去。
  // 优先向上（正常情况下玩家落在平台顶面），向上不行再左右推。
  Player.prototype.deEmbed = function (level) {
    if (!level.rectSolid(this.x, this.y, this.w, this.h)) return;
    var up;
    for (up = 1; up <= 24; up++) {
      if (!level.rectSolid(this.x, this.y - up, this.w, this.h)) {
        this.y -= up;
        if (this.vy > 0) this.vy = 0;
        this.onGround = true;
        return;
      }
    }
    for (var s = 1; s <= 24; s++) {
      if (!level.rectSolid(this.x - s, this.y, this.w, this.h)) {
        this.x -= s;
        this.vx = 0;
        return;
      }
      if (!level.rectSolid(this.x + s, this.y, this.w, this.h)) {
        this.x += s;
        this.vx = 0;
        return;
      }
    }
  };

  Player.prototype.detectGround = function (level, prevBottom) {
    if (level.rectSolid(this.x, this.bottom() + 0.5, this.w, 1)) return true;
    if (this.dropThrough <= 0) {
      var top = level.platformBelow(this.x, this.bottom() - 0.5, this.w, 1,
        prevBottom === undefined ? this.bottom() : prevBottom);
      if (top >= 0 && Math.abs(top - this.bottom()) <= 1.5) return true;
    }
    return false;
  };

  // 45° 斜坡贴合：取碰撞盒左右中三点中最低的可行表面
  Player.prototype.snapSlope = function (level) {
    var feet = this.bottom();
    var best = null;
    var xs = [this.x + 1, this.x + this.w / 2, this.x + this.w - 1];
    for (var i = 0; i < xs.length; i++) {
      var tx = Math.floor(xs[i] / TS);
      var ty = Math.floor((feet - 1) / TS);
      var surf = level.slopeSurface(tx, ty, xs[i] - tx * TS);
      if (surf === null) continue;
      if (surf >= feet - 12 && surf <= feet + 2) {
        if (best === null || surf > best) best = surf;
      }
    }
    if (best !== null) {
      this.y = best - this.h;
      if (this.vy > 0) this.vy = 0;
      this.onGround = true;
    }
  };

  // ------------------------------------------------------------- 动画
  // §3.2 6 组动作，8 至 12 帧每秒，逐帧硬切
  var FPS = { idle: 8, walk: 10, jump: 12, pickup: 10, talk: 8, celebrate: 12 };

  Player.prototype.updateAnim = function (dt, forceTalk, forcedAnim) {
    var want;
    if (forcedAnim) want = forcedAnim;
    else if (this.pickupTimer > 0) want = 'pickup';
    else if (forceTalk) want = 'talk';
    else if (!this.onGround) want = 'jump';
    else if (Math.abs(this.vx) > 4) want = 'walk';
    else want = 'idle';

    if (want !== this.anim) {
      this.anim = want;
      this.animTime = 0;
      this.animFrame = 0;
    } else {
      this.animTime += dt;
      var fps = FPS[want] || 10;
      var frames = CT.Sprites.ANIM[want].frames.length;
      var f = Math.floor(this.animTime * fps);
      if (want === 'pickup' || want === 'celebrate') {
        this.animFrame = Math.min(frames - 1, f);   // 一次性动作不循环
      } else if (want === 'jump') {
        // 上升 2 帧、下落 1 帧、落地缓冲 1 帧（§3.2）
        if (this.onGround) this.animFrame = 0;
        else if (this.vy < 0) this.animFrame = f % 2 === 0 ? 1 : 2;
        else this.animFrame = 3;
      } else if (want === 'idle') {
        // 静止时几乎完全不动：保持同一帧，每 3 秒眨一下眼。
        // 原先 idle 以 8fps 在 4 帧间循环（呼吸 + 眨眼），站着不动时
        // 整个身体一直在动，观感很吵。这里改成「不动 + 偶尔眨眼」。
        var cyc = this.animTime % 3.0;
        this.animFrame = (cyc > 2.82 && cyc < 2.96) ? 3 : 0;
      } else {
        this.animFrame = f % frames;
      }
    }
    if (this.pickupTimer > 0) this.pickupTimer -= dt;
    if (this.talkTimer > 0) this.talkTimer -= dt;
  };

  // 精灵绘制左上角（碰撞盒居中偏下，§3.1）
  Player.prototype.spriteX = function () { return Math.round(this.x - (SPRITE_W - BOX_W) / 2); };
  Player.prototype.spriteY = function () { return Math.round(this.y - (SPRITE_H - 1 - BOX_H)); };

  Player.SPEED = SPEED;
  Player.JUMP_V = JUMP_V;
  Player.GRAVITY = GRAVITY;
  Player.BOX_W = BOX_W;
  Player.BOX_H = BOX_H;
  Player.SPRITE_W = SPRITE_W;
  Player.SPRITE_H = SPRITE_H;
  Player.COYOTE = COYOTE;
  Player.JUMP_BUFFER = JUMP_BUFFER;

  CT.Player = Player;
})();
