/* 晶途拾光 — 机关与谜题
 * --------------------------------------------------------------------------
 * §4.3 六类机关，每类都必须能在教学关单独出现，再进入组合使用：
 *   踩压开关  站上去即触发，离开即复位；玩家要找重物或分时踩踏
 *   光路方块  推动反光块改变光束方向，把光引到晶座
 *   时序踏板  按正确顺序踩踏才开门；踩错只熄灭灯，无惩罚
 *   风场推力  持续风力推动角色与浮台
 *   水流转向  闸门与转盘改变水流方向，开闸、抬高水位、浮起平台
 *   符文拼图  收集碎片并按纹样拼接
 *
 * 三条硬性限制（§4.3）：
 *   单关同时生效的机关不超过 3 种；正确解必须能在场景内被观察到；
 *   连续失败 3 次给第一级提示，6 次给第二级提示。
 *
 * 门用「改写关卡瓦片 + doorMask 标记」的方式实现：这样玩家碰撞仍然走
 * level.rectSolid 一条路径，不需要在物理里额外插一层动态碰撞体。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var TS = 16;

  function MechWorld(level, themeKey, particles, audio) {
    this.level = level;
    this.theme = themeKey;
    this.P = CT.Palette.get(themeKey);
    this.particles = particles;
    this.audio = audio;
    this.time = 0;

    this.doors = [];
    this.plates = [];
    this.pads = [];
    this.emitters = [];
    this.receivers = [];
    this.pushables = [];
    this.zones = [];
    this.valves = [];
    this.floats = [];
    this.altars = [];

    this.sequenceProgress = 0;
    this.sequenceDone = false;
    this.sequenceFlash = 0;
    this.failCount = {};
    this.hintLevel = {};
    this.beamPath = [];            // 供渲染的光路点集
    this.beamSolved = false;
    this.waterLevel = 0;           // 0..1 水位进度
    this.waterTarget = 0;
    this.runeTotal = 0;
    this.runeCollected = 0;
    this.solved = {};
    this.hazards = [];

    this._build();
  }

  MechWorld.prototype._build = function () {
    var L = this.level;
    var list = L.mechanisms || [];
    this.doorById = {};
    this.plateById = {};
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'door') {
        var d = {
          id: m.id, tx: m.at[0], ty: m.at[1], h: m.h || 3,
          open: !!m.open, anim: m.open ? 1 : 0,
        };
        this.doors.push(d);
        this.doorById[d.id] = d;
        this._applyDoorTiles(d);
      } else if (m.type === 'pressure_switch') {
        var p = { id: m.id, tx: m.at[0], ty: m.at[1], targets: m.targets || [], pressed: false, anim: 0 };
        this.plates.push(p);
        this.plateById[p.id] = p;
      } else if (m.type === 'stone') {
        this.pushables.push({
          id: m.id, kind: 'stone',
          x: m.at[0] * TS + 2, y: m.at[1] * TS + 4, w: 12, h: 12,
          axis: m.axis || 'x', min: m.min, max: m.max, vx: 0,
        });
      } else if (m.type === 'mirror') {
        this.pushables.push({
          id: m.id, kind: 'mirror',
          x: m.at[0] * TS + 2, y: m.at[1] * TS + 4, w: 12, h: 12,
          axis: m.axis || 'x', min: m.min, max: m.max, want: m.want, vx: 0,
          wantTx: m.want,
        });
      } else if (m.type === 'emitter') {
        this.emitters.push({ id: m.id, tx: m.at[0], ty: m.at[1], dir: m.dir, target: m.target });
      } else if (m.type === 'receiver') {
        this.receivers.push({ id: m.id, tx: m.at[0], ty: m.at[1], target: m.target, lit: false });
      } else if (m.type === 'sequence_pad') {
        this.pads.push({ id: m.id, tx: m.at[0], ty: m.at[1], index: m.index, order: m.order, door: m.door, lit: false });
      } else if (m.type === 'wind') {
        this.zones.push({
          id: m.id, x: m.at[0] * TS, y: m.at[1] * TS,
          w: m.w * TS, h: m.h * TS, fx: m.fx || 0, fy: m.fy || 0,
        });
      } else if (m.type === 'water_valve') {
        this.valves.push({ id: m.id, tx: m.at[0], ty: m.at[1], target: m.target, on: false, anim: 0 });
      } else if (m.type === 'float_platform') {
        this.floats.push({
          id: m.id, x: m.at[0] * TS, y: m.at[1] * TS, w: (m.w || 3) * TS, h: 6,
          lowY: m.lowY * TS, highY: m.highY * TS, y0: m.at[1] * TS,
        });
      } else if (m.type === 'rune_altar') {
        this.altars.push({ id: m.id, tx: m.at[0], ty: m.at[1], done: false });
      }
    }
    // 滚石障碍物：地面来回滚动，碰到扣命
    var hzList = L.hazards || [];
    for (var hi = 0; hi < hzList.length; hi++) {
      var hz = hzList[hi];
      this.hazards.push({
        id: hz.id,
        x: hz.at[0] * TS + 1,
        y: hz.at[1] * TS + 2,      // 石块高 14，贴在瓦片下沿
        w: 14, h: 14,
        minX: hz.range[0] * TS,
        maxX: hz.range[1] * TS,
        speed: hz.speed || 36,
        dir: hz.dir || 1,
        spin: 0,
      });
    }

    // 符文碎片总数来自关卡的 kind === 'rune' 宝物
    for (var k = 0; k < (this.level.treasures || []).length; k++) {
      if (this.level.treasures[k].kind === 'rune') this.runeTotal++;
    }
  };

  // 门的台阶式开关：改写瓦片，让物理只认 level.rectSolid 一条路径
  MechWorld.prototype._applyDoorTiles = function (d) {
    var L = this.level;
    for (var r = 0; r < d.h; r++) {
      var ty = d.ty - r;
      if (ty < 0) continue;
      L.setTile(d.tx, ty, d.open ? CT.TILE.EMPTY : CT.TILE.SOLID);
      L.setDoorTile(d.tx, ty, d.open ? 0 : 1);
    }
  };

  MechWorld.prototype._setDoor = function (id, open) {
    var d = this.doorById[id];
    if (!d || d.open === open) return;
    d.open = open;
    this._applyDoorTiles(d);
    if (this.audio) this.audio.sfx(open ? 'stone_door' : 'switch_down');
    if (this.particles) {
      for (var r = 0; r < d.h; r++) {
        this.particles.dust(d.tx * TS + 8, (d.ty - r) * TS + 8, this.P);
      }
    }
    // 记录解密，用于存档与提示
    this.solved[id] = open ? 1 : 0;
  };

  // ------------------------------------------------------------ 玩家碰撞体
  MechWorld.prototype.playerBox = function (p) { return { x: p.x, y: p.y, w: p.w, h: p.h }; };

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // 推力处理：先尝试把可推动物让开，让不开就把玩家退回去
  MechWorld.prototype.resolvePushables = function (player, level) {
    for (var i = 0; i < this.pushables.length; i++) {
      var o = this.pushables[i];
      var pbox = { x: player.x, y: player.y, w: player.w, h: player.h };
      var obox = { x: o.x, y: o.y, w: o.w, h: o.h };
      if (!overlap(pbox, obox)) continue;

      var dx = 0;
      if (pbox.x + pbox.w / 2 < obox.x + obox.w / 2) dx = (pbox.x + pbox.w) - obox.x;   // 向右推
      else dx = pbox.x - (obox.x + obox.w);                                              // 向左推
      var wantX = o.x + dx;

      // 边界（关卡生成期给定的滑轨）
      var minX = o.min !== undefined ? o.min * TS + 2 : 0;
      var maxX = o.max !== undefined ? o.max * TS + 2 : level.pxW;
      if (wantX < minX) wantX = minX;
      if (wantX > maxX) wantX = maxX;

      var moved = 0;
      if (wantX !== o.x) {
        var dir = wantX > o.x ? 1 : -1;
        // 逐像素试探，撞墙即停
        while (o.x !== wantX) {
          var nx = o.x + dir;
          if (level.rectSolid(nx, o.y, o.w, o.h)) break;
          var hitOther = false;
          for (var j = 0; j < this.pushables.length; j++) {
            if (j === i) continue;
            var b2 = this.pushables[j];
            if (nx < b2.x + b2.w && nx + o.w > b2.x && o.y < b2.y + b2.h && o.y + o.h > b2.y) { hitOther = true; break; }
          }
          if (hitOther) break;
          o.x = nx;
          moved++;
        }
      }
      // 把玩家退回到不重叠的位置
      if (moved * Math.sign(dx) !== dx) {
        if (dx > 0) player.x = o.x - player.w - 0.01;
        else player.x = o.x + o.w + 0.01;
        player.vx = 0;
      }
    }
  };

  // ---------------------------------------------------------------- 更新
  // 起跳钩子：音效与粒子在这里统一出口，player 不需要知道音频系统
  MechWorld.prototype.onPlayerJump = function (player) {
    if (this.audio) this.audio.sfx('jump');
  };

  MechWorld.prototype.onPlayerLand = function (player) {
    if (this.audio) this.audio.sfx('land');
    if (this.particles) this.particles.dust(player.centreX(), player.bottom(), this.P);
  };

  MechWorld.prototype.update = function (dt, player, collected) {
    this.time += dt;
    var L = this.level;
    var P = this.P;

    this.resolvePushables(player, L);

    // 滚石来回滚动
    for (var bi = 0; bi < this.hazards.length; bi++) {
      var bo = this.hazards[bi];
      bo.x += bo.dir * bo.speed * dt;
      bo.spin += bo.dir * bo.speed * dt;
      if (bo.x <= bo.minX) { bo.x = bo.minX; bo.dir = 1; }
      if (bo.x >= bo.maxX) { bo.x = bo.maxX; bo.dir = -1; }
      // 滚动时偶尔扬起一点尘土：既是视觉提示，也说明它在动
      if (this.particles && bo.dustT === undefined) bo.dustT = 0;
      if (this.particles) {
        bo.dustT -= dt;
        if (bo.dustT <= 0) {
          bo.dustT = 0.18;
          this.particles.spawn(1, bo.x + (bo.dir > 0 ? 1 : bo.w - 1), bo.y + bo.h - 2,
            -bo.dir * 12, -8, 0.26, this.P.c[2], 2, 2);
        }
      }
    }

    // ---- 踩压开关
    var anyTargets = {};
    for (var i = 0; i < this.plates.length; i++) {
      var pl = this.plates[i];
      var top = pl.ty * TS + TS;           // 开关面与地面同高
      var wasPressed = pl.pressed;
      var pbox = { x: player.x, y: player.y, w: player.w, h: player.h };
      var pr = { x: pl.tx * TS + 1, y: top - 6, w: 14, h: 10 };
      pl.pressed = overlap(pbox, pr);
      // 石块也算重物
      if (!pl.pressed) {
        for (var s = 0; s < this.pushables.length; s++) {
          var st = this.pushables[s];
          if (st.kind !== 'stone') continue;
          if (overlap({ x: st.x, y: st.y, w: st.w, h: st.h }, pr)) { pl.pressed = true; break; }
        }
      }
      pl.anim = pl.pressed ? Math.min(1, pl.anim + dt * 8) : Math.max(0, pl.anim - dt * 8);
      if (pl.pressed && !wasPressed) {
        if (this.audio) this.audio.sfx('switch_down');
      }
      // 复位型开关：离开即复位（§4.3 踩压开关）
      for (var t = 0; t < pl.targets.length; t++) {
        var tid = pl.targets[t];
        if (pl.pressed) anyTargets[tid] = true;
      }
    }
    // 所有门：若其所有触发条件都满足则开
    for (var di = 0; di < this.doors.length; di++) {
      var d = this.doors[di];
      var shouldOpen = !!anyTargets[d.id] || this._doorHeld(d.id);
      this._setDoor(d.id, shouldOpen);
      d.anim = d.open ? Math.min(1, d.anim + dt * 6) : Math.max(0, d.anim - dt * 6);
    }

    // ---- 时序踏板
    if (this.pads.length) {
      var pbox2 = { x: player.x, y: player.y, w: player.w, h: player.h };
      for (var pi = 0; pi < this.pads.length; pi++) {
        var pad = this.pads[pi];
        var ptop = pad.ty * TS + TS;
        var pr2 = { x: pad.tx * TS + 1, y: ptop - 5, w: 14, h: 8 };
        var on = overlap(pbox2, pr2);
        if (on && !pad.wasOn) this._stepPad(pad);
        pad.wasOn = on;
        pad.lit = this._padLit(pad);
      }
      if (this.sequenceFlash > 0) this.sequenceFlash -= dt;
    }

    // ---- 光路
    if (this.emitters.length) this._updateBeam();

    // ---- 风场
    if (this.zones.length) {
      for (var zi = 0; zi < this.zones.length; zi++) {
        var z = this.zones[zi];
        var zb = { x: z.x, y: z.y, w: z.w, h: z.h };
        if (overlap({ x: player.x, y: player.y, w: player.w, h: player.h }, zb)) {
          player.externalVX += z.fx;
          player.externalVY += z.fy;
        }
      }
    }

    // ---- 水流 / 水位
    if (this.valves.length) {
      var pbox3 = { x: player.x, y: player.y, w: player.w, h: player.h };
      for (var vi = 0; vi < this.valves.length; vi++) {
        var v = this.valves[vi];
        var vtop = v.ty * TS + TS;
        var vr = { x: v.tx * TS + 1, y: vtop - 6, w: 14, h: 10 };
        var onV = overlap(pbox3, vr);
        if (onV && !v.wasOn) {
          v.on = true;
          this.waterTarget = 1;
          this._setDoor(v.target, true);
          this._holdDoor(v.target, true);
          if (this.audio) this.audio.sfx('water_gate');
        }
        v.wasOn = onV;
        v.anim = v.on ? Math.min(1, v.anim + dt * 3) : v.anim;
      }
      this.waterLevel += (this.waterTarget - this.waterLevel) * Math.min(1, dt * 1.6);
      // 浮台随水位上升，并托住玩家
      for (var fi = 0; fi < this.floats.length; fi++) {
        var f = this.floats[fi];
        var ny = f.lowY + (f.highY - f.lowY) * this.waterLevel;
        var fprev = f.y;
        f.y = Math.round(ny);
        // 玩家站在浮台上则一起上升
        if (player.onGround &&
            player.x + player.w > f.x && player.x < f.x + f.w &&
            Math.abs(player.bottom() - fprev) <= 3) {
          player.y += (f.y - fprev);
        }
      }
    }

    // ---- 符文拼图
    if (this.altars.length) {
      this.runeCollected = 0;
      if (collected) {
        for (var ri = 0; ri < (this.level.treasures || []).length; ri++) {
          var tr = this.level.treasures[ri];
          if (tr.kind === 'rune' && collected[tr.id]) this.runeCollected++;
        }
      }
      for (var ai = 0; ai < this.altars.length; ai++) {
        var al = this.altars[ai];
        var atop = al.ty * TS + TS;
        var ar = { x: al.tx * TS, y: atop - 16, w: TS, h: 16 };
        var near = player.centreX() > ar.x - 24 && player.centreX() < ar.x + ar.w + 24 &&
          Math.abs(player.bottom() - atop) < 28;
        al.near = near;
        if (al.done) { this._setDoor('final', true); this._holdDoor('final', true); }
      }
    }

    // 已解机关计数（用于图鉴与进度显示）
    var solvedCount = 0;
    for (var k in this.solved) if (this.solved[k]) solvedCount++;
    this.solvedCount = solvedCount;
  };

  MechWorld.prototype._doorHeld = function (id) {
    this._held = this._held || {};
    return !!this._held[id];
  };
  MechWorld.prototype._holdDoor = function (id, v) {
    this._held = this._held || {};
    this._held[id] = v;
  };

  // 交互键在符文台附近触发拼合
  MechWorld.prototype.interact = function (player, collected) {
    for (var ai = 0; ai < this.altars.length; ai++) {
      var al = this.altars[ai];
      if (!al.near) continue;
      if (al.done) return { type: 'rune_already' };
      if (this.runeCollected >= this.runeTotal && this.runeTotal > 0) {
        al.done = true;
        this.solved['rune_' + this.level.id] = 1;
        if (this.audio) this.audio.sfx('rune_merge');
        if (this.particles) this.particles.sparkle(al.tx * TS + 8, al.ty * TS, this.P.c[15]);
        return { type: 'rune_solved' };
      }
      return { type: 'rune_incomplete', need: this.runeTotal - this.runeCollected };
    }
    return null;
  };

  MechWorld.prototype._padLit = function (pad) {
    if (this.sequenceDone) return true;
    for (var i = 0; i < pad.order.length; i++) {
      if (pad.order[i] === pad.index) return i < this.sequenceProgress;
    }
    return false;
  };

  MechWorld.prototype._stepPad = function (pad) {
    if (this.sequenceDone) return;
    var need = pad.order[this.sequenceProgress];
    if (pad.index === need) {
      this.sequenceProgress++;
      if (this.audio) this.audio.sfx('pad_ok');
      if (this.sequenceProgress >= pad.order.length) {
        this.sequenceDone = true;
        for (var i = 0; i < this.pads.length; i++) {
          this._setDoor(this.pads[i].door, true);
          this._holdDoor(this.pads[i].door, true);
        }
        this.solved['pads_' + this.level.id] = 1;
        if (this.audio) this.audio.sfx('stone_door');
      }
    } else if (pad.index !== pad.order[this.sequenceProgress - 1]) {
      // 踩错只熄灭灯，无惩罚（§4.3）
      this.sequenceProgress = 0;
      this.sequenceFlash = 0.35;
      if (this.audio) this.audio.sfx('pad_bad');
    }
  };

  // 光束追踪：右行 -> 遇反光块向上 -> 命中晶座
  MechWorld.prototype._updateBeam = function () {
    this.beamPath.length = 0;
    var solvedAll = true;
    for (var ei = 0; ei < this.emitters.length; ei++) {
      var em = this.emitters[ei];
      var rx = -1;
      // 找同高度的反光块
      for (var i = 0; i < this.pushables.length; i++) {
        var o = this.pushables[i];
        if (o.kind !== 'mirror') continue;
        var oRow = Math.floor((o.y + o.h / 2) / TS);
        if (oRow !== em.ty) continue;
        var oCol = Math.floor((o.x + o.w / 2) / TS);
        if (oCol <= em.tx) continue;
        if (this.level.rectSolid((em.tx + oCol) / 2 | 0, em.ty, 1, 1)) continue;
        if (rx < 0 || oCol < rx) rx = oCol;
      }
      var ok = false;
      if (rx > em.tx) {
        this.beamPath.push([em.tx * TS + TS, em.ty * TS + TS / 2, rx * TS, em.ty * TS + TS / 2]);
        // 竖直向上
        var upTop = em.ty;
        for (var ty = em.ty - 1; ty >= 0; ty--) {
          if (this.level.rectSolid(rx, ty, 1, 1)) break;
          upTop = ty;
          // 命中晶座
          var hit = false;
          for (var ri = 0; ri < this.receivers.length; ri++) {
            if (this.receivers[ri].tx === rx && this.receivers[ri].ty === ty) { hit = true; break; }
          }
          if (hit) { ok = true; break; }
        }
        this.beamPath.push([rx * TS + TS / 2, em.ty * TS + TS / 2, rx * TS + TS / 2, upTop * TS + TS / 2]);
      }
      // 反光块是否已对准
      var aligned = false;
      for (var k = 0; k < this.pushables.length; k++) {
        var oo = this.pushables[k];
        if (oo.kind !== 'mirror') continue;
        if (Math.floor((oo.x + oo.w / 2) / TS) === oo.wantTx) aligned = true;
      }
      var open = aligned && ok;
      if (!open) solvedAll = false;
      this._setDoor(em.target, open);
      this._holdDoor(em.target, open);
      for (var rr = 0; rr < this.receivers.length; rr++) {
        if (this.receivers[rr].target === em.target) this.receivers[rr].lit = open;
      }
    }
    this.beamSolved = solvedAll;
  };

  // ---------------------------------------------------------------- 绘制
  MechWorld.prototype.draw = function (fb, camX, camY, blobCache) {
    var P = this.P;
    var i, x, y;

    // 踩压开关
    for (i = 0; i < this.plates.length; i++) {
      var pl = this.plates[i];
      x = pl.tx * TS - camX; y = pl.ty * TS + TS - camY;
      if (x < -20 || x > 500 || y < -20 || y > 290) continue;
      var hgt = Math.round(4 - pl.anim * 3);
      fb.fillRect(x + 1, y - hgt, 14, hgt + 1, P.c[11]);
      fb.hline(x + 1, y - hgt, 14, pl.pressed ? P.c[15] : P.c[2]);
      fb.hline(x + 1, y, 14, P.c[12]);
      fb.setClip(0, 0, 480, 270);
      fb.resetClip();
    }

    // 时序踏板
    for (i = 0; i < this.pads.length; i++) {
      var pad = this.pads[i];
      x = pad.tx * TS - camX; y = pad.ty * TS + TS - camY;
      if (x < -20 || x > 500 || y < -20 || y > 290) continue;
      fb.fillRect(x + 1, y - 3, 14, 4, P.c[11]);
      var lit = pad.lit;
      fb.hline(x + 2, y - 3, 12, lit ? P.c[15] : P.c[12]);
      if (lit) {
        fb.fillRectDither(x + 3, y - 2, 10, 2, P.c[15], 8);
      }
      // 踏板上的序号刻痕：顺序线索要求「必须能在场景内被观察到」
      fb.fillRect(x + 6, y - 2, 4, 1, lit ? P.c[0] : P.c[7]);
    }

    // 门
    for (i = 0; i < this.doors.length; i++) {
      var d = this.doors[i];
      drawDoor(fb, d, camX, camY, P);
    }

    // 滚石：圆形石块 + 高光 + 底部投影，轮廓用最暗色压边，一眼能看出是障碍
    for (i = 0; i < this.hazards.length; i++) {
      var hb = this.hazards[i];
      var hx = Math.round(hb.x) - camX;
      var hy = Math.round(hb.y) - camY;
      if (hx < -24 || hx > 500 || hy < -24 || hy > 290) continue;
      var cxh = hx + 7, cyh = hy + 7;
      fb.ellipse(cxh, cyh, 7, 7, P.c[12]);      // 外圈描边
      fb.ellipse(cxh, cyh, 6, 6, P.c[11]);      // 石体
      fb.ellipse(cxh, cyh - 1, 4, 4, P.c[3]);   // 受光面
      fb.ellipse(cxh - 2, cyh - 3, 1, 1, P.c[1]); // 高光
      // 随滚动位移移动的两条纹理，暗示它在滚而不是在滑
      var sp = (((hb.spin * 0.5) | 0) % 10 + 10) % 10;
      fb.px(cxh - 3 + (sp > 4 ? 1 : 0), cyh + 1, P.c[6]);
      fb.fillRect(cxh - 2, cyh + 2, 3, 1, P.c[6]);
      fb.fillRect(cxh + 2, cyh - 2 + (sp > 5 ? 1 : 0), 2, 1, P.c[6]);
      fb.hline(hx + 3, hy + 14, 8, P.c[13]);    // 地面投影
    }

    // 可推动物
    for (i = 0; i < this.pushables.length; i++) {
      var o = this.pushables[i];
      x = Math.round(o.x) - camX; y = Math.round(o.y) - camY;
      if (x < -24 || x > 500 || y < -24 || y > 290) continue;
      if (o.kind === 'stone') {
        fb.fillRect(x, y, 12, 12, P.c[11]);
        fb.fillRect(x + 1, y + 1, 10, 9, P.c[3]);
        fb.hline(x + 1, y + 1, 10, P.c[2]);
        fb.hline(x, y + 11, 12, P.c[12]);
        fb.vline(x, y, 12, P.c[12]);
        fb.vline(x + 11, y, 12, P.c[12]);
      } else {
        // 反光块：斜面对角高光
        fb.fillRect(x, y, 12, 12, P.c[12]);
        fb.fillRect(x + 1, y + 1, 10, 10, P.c[3]);
        for (var k = 0; k < 9; k++) {
          fb.px(x + 2 + k, y + 2 + k, P.c[0]);
          fb.px(x + 3 + k, y + 2 + k, P.c[2]);
        }
        fb.hline(x + 1, y + 1, 10, P.c[2]);
      }
    }

    // 发射器与晶座
    for (i = 0; i < this.emitters.length; i++) {
      var em = this.emitters[i];
      x = em.tx * TS - camX; y = em.ty * TS - camY;
      fb.fillRect(x + 2, y + 4, 12, 8, P.c[12]);
      fb.fillRect(x + 3, y + 5, 10, 6, P.c[4]);
      fb.fillRect(x + 12, y + 7, 4, 2, P.c[15]);
    }
    for (i = 0; i < this.receivers.length; i++) {
      var rc = this.receivers[i];
      x = rc.tx * TS - camX; y = rc.ty * TS - camY;
      fb.fillRect(x + 3, y + 8, 10, 6, P.c[11]);
      fb.ellipse(x + 8, y + 6, 4, 4, rc.lit ? P.c[15] : P.c[12]);
      fb.ellipse(x + 8, y + 6, 2, 2, rc.lit ? P.c[0] : P.c[7]);
    }

    // 光路：抖动像素线（§7.2 渐变只用抖动）
    for (i = 0; i < this.beamPath.length; i++) {
      var seg = this.beamPath[i];
      drawBeam(fb, seg[0] - camX, seg[1] - camY, seg[2] - camX, seg[3] - camY, P.c[15], P.c[0]);
    }

    // 风场
    for (i = 0; i < this.zones.length; i++) {
      var z = this.zones[i];
      var zx = z.x - camX, zy = z.y - camY;
      if (zx > 500 || zx + z.w < -20) continue;
      for (var w = 0; w < 18; w++) {
        var ph = (this.time * 1.4 + w * 0.37) % 1;
        var px2 = zx + ((w * 37) % z.w);
        var py2 = zy + z.h - ph * z.h;
        if (py2 < zy) continue;
        fb.fillRect(Math.round(px2), Math.round(py2), 1, 3 + (w % 3), P.c[2]);
        fb.fillRectDither(Math.round(px2) + 1, Math.round(py2), 2, 2, P.c[1], 6);
      }
    }

    // 水位与浮台
    if (this.floats.length) {
      for (i = 0; i < this.floats.length; i++) {
        var f = this.floats[i];
        x = f.x - camX; y = f.y - camY;
        fb.fillRect(x, y, f.w, 6, P.c[9]);
        fb.hline(x, y, f.w, P.c[1]);
        fb.hline(x, y + 5, f.w, P.c[13]);
      }
      // 水面用 50% 透明叠色（§7.2 水面允许 50%）
      var wl = this.waterLevel;
      if (wl > 0.02) {
        for (i = 0; i < this.valves.length; i++) {
          var v = this.valves[i];
          var topY = (v.ty + 1) * TS - Math.round(wl * 96);
          var wy = topY - camY;
          if (wy > -10 && wy < 280) {
            fb.fillRectDither(0, wy, 480, 270 - wy, P.c[4], 4);
            fb.hline(0, wy, 480, P.c[1]);
          }
        }
      }
    }

    // 阀门
    for (i = 0; i < this.valves.length; i++) {
      var vv = this.valves[i];
      x = vv.tx * TS - camX; y = vv.ty * TS + TS - camY;
      fb.fillRect(x + 1, y - 6, 14, 7, P.c[11]);
      fb.hline(x + 1, y - 6, 14, vv.on ? P.c[15] : P.c[2]);
      fb.fillRect(x + 6, y - 9, 4, 4, vv.on ? P.c[15] : P.c[7]);
    }

    // 符文台
    for (i = 0; i < this.altars.length; i++) {
      var al = this.altars[i];
      x = al.tx * TS - camX; y = al.ty * TS + TS - camY;
      fb.fillRect(x, y - 14, 16, 15, P.c[12]);
      fb.fillRect(x + 1, y - 13, 14, 13, P.c[11]);
      var ratio = this.runeTotal ? this.runeCollected / this.runeTotal : 0;
      for (var s2 = 0; s2 < 3; s2++) {
        var on2 = s2 < Math.round(ratio * 3);
        fb.fillRect(x + 3 + s2 * 4, y - 10, 3, 5, on2 ? P.c[15] : P.c[6]);
      }
      fb.hline(x, y - 1, 16, P.c[12]);
    }
  };

  function drawDoor(fb, d, camX, camY, P) {
    var x = d.tx * TS - camX;
    var topY = (d.ty - d.h + 1) * TS - camY;
    var hgt = d.h * TS;
    if (x < -20 || x > 500) return;
    // 门框
    fb.fillRect(x, topY, TS, hgt, P.c[12]);
    var open = d.anim;
    if (open < 1) {
      var squeeze = Math.round(open * hgt * 0.5);
      fb.fillRect(x + 1, topY + squeeze, TS - 2, hgt - squeeze * 2, P.c[4]);
      for (var r = 0; r < hgt; r += 4) {
        fb.hline(x + 2, topY + squeeze + r, TS - 4, P.c[6]);
      }
      fb.vline(x + 7, topY + squeeze, 1, P.c[12]);
      fb.fillRect(x + 6, topY + hgt / 2 - 2 + squeeze, 4, 3, P.c[8]);
    }
    fb.hline(x, topY, TS, P.c[13]);
    fb.hline(x, topY + hgt - 1, TS, P.c[13]);
  }

  function drawBeam(fb, x0, y0, x1, y1, color, core) {
    var i;
    if (y0 === y1) {
      var xs = Math.min(x0, x1), xe = Math.max(x0, x1);
      fb.fillRectDither(Math.round(xs), Math.round(y0) - 1, Math.round(xe - xs), 2, color, 11);
      fb.fillRectDither(Math.round(xs), Math.round(y0), Math.round(xe - xs), 1, core, 12);
    } else if (x0 === x1) {
      var ys = Math.min(y0, y1), ye = Math.max(y0, y1);
      fb.fillRectDither(Math.round(x0) - 1, Math.round(ys), 2, Math.round(ye - ys), color, 11);
      fb.fillRectDither(Math.round(x0), Math.round(ys), 1, Math.round(ye - ys), core, 12);
    }
  }

  // ------------------------------------------------------------------ 提示
  // §4.3 连续失败 3 次 -> 第一级提示；6 次 -> 第二级提示
  MechWorld.prototype.fail = function (key) {
    this.failCount[key] = (this.failCount[key] || 0) + 1;
    var n = this.failCount[key];
    if (n >= 6) this.hintLevel[key] = 2;
    else if (n >= 3) this.hintLevel[key] = 1;
    return this.hintLevel[key] || 0;
  };

  MechWorld.prototype.hasDoorOpen = function () {
    for (var i = 0; i < this.doors.length; i++) if (!this.doors[i].open) return false;
    return true;
  };

  CT.MechWorld = MechWorld;
})();
