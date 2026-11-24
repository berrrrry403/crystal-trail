/* 晶途拾光 — 关卡运行时
 * --------------------------------------------------------------------------
 * §9.4 关卡不写在代码里，全部以 JSON 描述，由引擎在运行时加载。
 *
 * §4.1 碰撞层必须物理分离：
 *   地面层 参与碰撞
 *   机关层 参与触发
 *   宝物层 只做拾取判定
 *   背景装饰层 完全不参与任何判定
 * 因此装饰物只存在于 decor 数组里，绘制时使用，碰撞查询一律看不到它们。
 *
 * 瓦片字符：
 *   .  空      #  实心地面    =  单向平台    /  斜坡(左低右高)   \  斜坡(左高右低)
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var TS = 16;                       // §4.1 瓦片尺寸 16 × 16
  var C_EMPTY = 0, C_SOLID = 1, C_PLATFORM = 2, C_SLOPE_R = 3, C_SLOPE_L = 4;
  var CHAR_TO_CODE = { '.': C_EMPTY, '#': C_SOLID, '=': C_PLATFORM, '/': C_SLOPE_R, '\\': C_SLOPE_L };

  function Level(json) {
    this.json = json;
    this.id = json.level_id;
    this.theme = json.theme;
    this.name = json.name || '';
    this.tw = json.size.w;
    this.th = json.size.h;
    this.pxW = this.tw * TS;
    this.pxH = this.th * TS;
    this.TS = TS;

    var rows = (json.layers && json.layers.ground) || [];
    this.tiles = new Uint8Array(this.tw * this.th);
    for (var y = 0; y < this.th; y++) {
      var row = rows[y] || '';
      for (var x = 0; x < this.tw; x++) {
        var ch = row.charAt(x);
        var code = CHAR_TO_CODE[ch];
        this.tiles[y * this.tw + x] = code === undefined ? C_EMPTY : code;
      }
    }

    this.decor = json.decor || [];
    this.mechanisms = json.mechanisms || [];
    this.treasures = json.treasures || [];
    this.hazards = json.hazards || [];
    this.npcs = json.npcs || [];
    this.checkpoint = json.checkpoint || null;
    this.exit = json.exit || null;
    this.spawn = json.spawn || [2, 4];

    // 装饰物按 x 排序，绘制时可按镜头区间裁剪
    this.decor.sort(function (a, b) { return a.x - b.x; });

    // 每一列的「主地表」行号：从底部往上连续实心的最高点。
    // 渲染层用它算出每块瓦片埋在土里有多深，从而决定画草皮 / 土层 / 深层岩体。
    // 注意不能取「从上往下第一个实心」，否则会把上层分支平台误判成地表。
    this.surfaceY = new Int16Array(this.tw);
    for (var cx = 0; cx < this.tw; cx++) {
      var top = -1;
      for (var cy = this.th - 1; cy >= 0; cy--) {
        if (this.tiles[cy * this.tw + cx] === C_SOLID) top = cy; else break;
      }
      this.surfaceY[cx] = top;
    }
  }

  // 埋深：0 = 地表，1~2 = 土层，>=3 = 深层岩体
  Level.prototype.depthClass = function (tx, ty) {
    var s = this.surfaceY[tx];
    if (s < 0) return 2;
    var d = ty - s;
    if (d <= 0) return 0;
    if (d <= 2) return 1;
    return 2;
  };

  Level.prototype.codeAt = function (tx, ty) {
    if (tx < 0 || tx >= this.tw) return C_SOLID;      // 左右边界视为实心墙
    if (ty < 0) return C_EMPTY;
    // 下边界必须是空的。原先这里返回实心，本意是防无限下坠，结果坑里没有底，
    // 主角会稳稳落在关卡最低一行上，永远到不了「掉出边界」的判定，
    // 于是卡死在坑底不复活。现在让他真的掉出去，由 y > pxH 触发扣命。
    if (ty >= this.th) return C_EMPTY;
    return this.tiles[ty * this.tw + tx];
  };

  // 机关（门）会改写瓦片，这样玩家碰撞仍然只走 rectSolid 一条路径
  Level.prototype.setTile = function (tx, ty, code) {
    if (tx < 0 || tx >= this.tw || ty < 0 || ty >= this.th) return;
    this.tiles[ty * this.tw + tx] = code;
  };

  // 标记某个格是门体，渲染层据此跳过地形瓦片、改画门
  Level.prototype.setDoorTile = function (tx, ty, on) {
    if (!this.doorMask) this.doorMask = new Uint8Array(this.tw * this.th);
    if (tx < 0 || tx >= this.tw || ty < 0 || ty >= this.th) return;
    this.doorMask[ty * this.tw + tx] = on ? 1 : 0;
  };

  Level.prototype.isDoorTile = function (tx, ty) {
    if (!this.doorMask) return 0;
    if (tx < 0 || tx >= this.tw || ty < 0 || ty >= this.th) return 0;
    return this.doorMask[ty * this.tw + tx];
  };

  Level.prototype.isSolid = function (tx, ty) {
    var c = this.codeAt(tx, ty);
    return c === C_SOLID || c === C_SLOPE_R || c === C_SLOPE_L;
  };
  Level.prototype.isPlatform = function (tx, ty) { return this.codeAt(tx, ty) === C_PLATFORM; };

  // 供瓦片美术用的 8 邻接掩码（§7.3 自动拼接）
  Level.prototype.neighbourMask = function (tx, ty) {
    var M = CT.Tiles.MASK, m = 0;
    if (this.isSolid(tx, ty - 1)) m |= M.UP;
    if (this.isSolid(tx, ty + 1)) m |= M.DOWN;
    if (this.isSolid(tx - 1, ty)) m |= M.LEFT;
    if (this.isSolid(tx + 1, ty)) m |= M.RIGHT;
    if (this.isSolid(tx - 1, ty - 1)) m |= M.UL;
    if (this.isSolid(tx + 1, ty - 1)) m |= M.UR;
    if (this.isSolid(tx - 1, ty + 1)) m |= M.DL;
    if (this.isSolid(tx + 1, ty + 1)) m |= M.DR;
    return m;
  };

  // 斜坡表面（瓦片内局部高度，返回该列可站立的 y 像素，越小越高）
  Level.prototype.slopeSurface = function (tx, ty, localX) {
    var c = this.codeAt(tx, ty);
    if (c === C_SLOPE_R) return (ty + 1) * TS - (localX + 1);       // 左低右高
    if (c === C_SLOPE_L) return ty * TS + localX + 1;               // 左高右低
    return null;
  };

  // 像素级实心查询（用于碰撞）
  Level.prototype.solidAtPx = function (px, py) {
    var tx = Math.floor(px / TS), ty = Math.floor(py / TS);
    return this.isSolid(tx, ty);
  };

  // 矩形与地面层是否相交
  Level.prototype.rectSolid = function (x, y, w, h) {
    var x0 = Math.floor(x / TS), x1 = Math.floor((x + w - 1) / TS);
    var y0 = Math.floor(y / TS), y1 = Math.floor((y + h - 1) / TS);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (this.isSolid(tx, ty)) return true;
      }
    }
    return false;
  };

  // 是否踩在单向平台上（平台只在自上方下落时生效）
  Level.prototype.platformBelow = function (x, y, w, h, prevBottom) {
    var y1 = Math.floor((y + h - 1) / TS);
    var x0 = Math.floor(x / TS), x1 = Math.floor((x + w - 1) / TS);
    for (var tx = x0; tx <= x1; tx++) {
      if (!this.isPlatform(tx, y1)) continue;
      var top = y1 * TS;
      // 上一帧脚底必须在平台面之上，才能落上去
      if (prevBottom <= top + 1 && (y + h) >= top) return top;
    }
    return -1;
  };

  // 收集可见瓦片，供渲染层裁剪
  Level.prototype.visibleTileRange = function (camX, camY, vw, vh) {
    return {
      x0: Math.max(0, Math.floor(camX / TS) - 1),
      x1: Math.min(this.tw - 1, Math.floor((camX + vw) / TS) + 1),
      y0: Math.max(0, Math.floor(camY / TS) - 1),
      y1: Math.min(this.th - 1, Math.floor((camY + vh) / TS) + 1),
    };
  };

  // §5.4 装饰密度校验：给定镜头左边界，统计该屏内装饰数
  Level.prototype.decorInScreen = function (camX, vw) {
    var x0 = camX / TS, x1 = (camX + vw) / TS;
    var n = 0;
    for (var i = 0; i < this.decor.length; i++) {
      var d = this.decor[i];
      if (d.x >= x0 && d.x < x1) n++;
    }
    return n;
  };

  CT.Level = Level;
  CT.TS = TS;
  CT.TILE = { EMPTY: C_EMPTY, SOLID: C_SOLID, PLATFORM: C_PLATFORM, SLOPE_R: C_SLOPE_R, SLOPE_L: C_SLOPE_L };
  CT.CHAR_TO_CODE = CHAR_TO_CODE;
})();
