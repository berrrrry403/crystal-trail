/* 晶途拾光 — 关卡生成器
 * --------------------------------------------------------------------------
 * 产出符合 §9.4 JSON 结构的关卡，并强制满足 §5.3 单关规模指标：
 *   横向长度 120~180 格   | 纵向高度 24~40 格
 *   至少 1 处 6 格以上垂直落差
 *   分支路径 1~2 条，其中至少 1 条通向隐藏支线宝物
 *   机关 3~6 组，同时生效种类不超过 3 种
 *   拾遗宝物 2~3 件      | 装饰物件不少于 40 个
 *   存档石碑 1 个（置于关卡中段安全区）
 *
 * 地形用「地面剖面 floor[x]」描述：先决定每一列的地表行号，再整列填充，
 * 因此连通性由构造保证。跳跃可达性按 §4.1 的物理参数反推：
 *   跳跃初速 -260、重力 640  ->  最大跳高 52.8 px ≈ 3.3 格
 *   水平速度 90 px/s、滞空 0.81 s  ->  最大水平跨距 73 px ≈ 4.5 格
 * 因此 maxGap ≤ 4、maxStepUp ≤ 3，两者都在物理可行范围内。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var TS = 16;

  // §4.1 物理参数派生出的可达性上限
  var JUMP_H = (260 * 260) / (2 * 640) / TS;      // 3.30 格
  var JUMP_DIST = (2 * 260 / 640) * 90 / TS;      // 4.56 格
  var MAX_GAP_HARD = 4;                            // 硬上限，超过必定跳不过去
  var MAX_STEP_HARD = 3;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function generate(levelId) {
    var info = CT.Themes.levelInfo(levelId);
    if (!info) throw new Error('levelgen: unknown level ' + levelId);
    var th = info.theme, li = info.index;
    var diff = th.difficulty;
    var maxGap = Math.min(diff.maxGap, MAX_GAP_HARD);
    var maxStepUp = Math.min(diff.maxStepUp, MAX_STEP_HARD);

    var rng = new CT.Rng(CT.seedOf('level:' + levelId));

    // 每关抽一种「布局风格」，决定各种分段的权重。
    // 没有这一步时，25 关都是同一套起伏节奏，走两关就能摸清规律。
    var LAYOUT_WEIGHTS = {
      rolling:  { shaft: 0.34, gap: 0.34, step: 0.28, branch: 0.18 },  // 起伏平缓
      gappy:    { shaft: 0.34, gap: 0.48, step: 0.16, branch: 0.14 },  // 多坑少台
      terraced: { shaft: 0.34, gap: 0.16, step: 0.48, branch: 0.16 },  // 阶梯台地
      towers:   { shaft: 0.34, gap: 0.26, step: 0.20, branch: 0.36 },  // 多分支高台
    };
    var LAYOUT_KEYS = ['rolling', 'gappy', 'terraced', 'towers'];
    var layout = LAYOUT_KEYS[rng.int(0, LAYOUT_KEYS.length - 1)];
    var LW2 = LAYOUT_WEIGHTS[layout];

    // ---- 尺寸：按关卡在单元中的位置决定宽度（§5.3 区间 120~180）
    // 长度：在原来的递进基础上整体 +40%（这是后续需求，覆盖 §5.3 的 120~180）。
    // 仍然保留「章内逐关变长 + 章间逐章变长」的双重递进。
    var chapter = th.index || 1;
    var baseW = 120 + 10 * (li - 1) + 7 * (chapter - 1);
    var W = Math.round(baseW * 1.4) + rng.int(-4, 4);
    W = Math.max(160, Math.min(260, W));
    // 高度也收敛一点：落差太大时镜头会整屏都在看一堵墙
    var H = 28 + rng.int(0, 4);              // 28~32
    // 出生面必须够高，否则「6 格以上垂直落差」会被地面下限夹掉（只能下降，
    // 而地面最低只能到 H-3）。留出 H-16 就有 10 格以上的下落余量。
    var baseY = H - 16;

    // ---------------------------------------------------------------- 剖面
    var floorY = new Int16Array(W);
    for (var i = 0; i < W; i++) floorY[i] = -1;    // -1 表示深坑
    var segments = [];                              // {x0, w, floor, type}

    var x = 0;
    // 左边界墙 2 列
    for (i = 0; i < 2; i++) { floorY[i] = baseY; }
    segments.push({ x0: 0, w: 2, floor: baseY, type: 'wall' });
    x = 2;

    // 出生平台：14 格平地（安全区，放 NPC 与教学提示）
    for (i = 0; i < 14; i++) floorY[x + i] = baseY;
    segments.push({ x0: x, w: 14, floor: baseY, type: 'start' });
    x += 14;

    var curFloor = baseY;
    var lastType = 'start';
    var dropDone = false;       // 是否已经做过 6 格以上垂直落差
    var branchCount = 0;
    var branchSpots = [];       // 可以放上层平台的位置 {x0,w,floor}
    var flatRuns = [];          // 可放机关的平地 {x0,w,floor}

    function clampFloor(f) {
      return Math.max(8, Math.min(H - 3, f));
    }
    // §5.3 要求至少一处 6 格以上垂直落差。地面最深只能到 H-3，因此必须在
    // 地表还没降太深之前就做出这个落差；否则 clamp 会把落差压没。
    function keepDropRoom(f) {
      if (dropDone) return f;
      return Math.min(f, H - 9);
    }

    while (x < W - 16) {
      var remain = W - 16 - x;
      var pick = rng.f();
      var type;
      var dropRoom = H - 3 - curFloor;   // 当前地表还能往下掉几格
      if (lastType === 'gap' || lastType === 'shaft') type = 'flat';
      else if (!dropDone && dropRoom >= 6 && (pick < LW2.shaft || remain < 46)) type = 'shaft';
      else if (pick < LW2.gap) type = 'gap';
      else if (pick < LW2.gap + LW2.step) type = 'step';
      else if (pick < LW2.gap + LW2.step + LW2.branch && branchCount < 2) type = 'branch';
      else type = 'flat';

      if (type === 'flat') {
        var fw = rng.int(6, 11);
        fw = Math.min(fw, remain);
        var f = keepDropRoom(clampFloor(curFloor));
        for (i = 0; i < fw; i++) floorY[x + i] = f;
        segments.push({ x0: x, w: fw, floor: f, type: 'flat' });
        flatRuns.push({ x0: x, w: fw, floor: f });
        x += fw;
      } else if (type === 'step') {
        var sw = rng.int(5, 8);
        sw = Math.min(sw, remain);
        var dir = rng.f() < 0.5 ? -1 : 1;
        var step = rng.int(1, dir < 0 ? maxStepUp : Math.max(1, maxStepUp));
        var nf = keepDropRoom(clampFloor(curFloor + dir * step));
        for (i = 0; i < sw; i++) floorY[x + i] = nf;
        segments.push({ x0: x, w: sw, floor: nf, type: 'step' });
        if (sw >= 6) flatRuns.push({ x0: x, w: sw, floor: nf });
        curFloor = nf;
        x += sw;
      } else if (type === 'gap') {
        var gw = rng.int(2, maxGap);
        // 坑：整列挖空
        for (i = 0; i < gw; i++) floorY[x + i] = -1;
        segments.push({ x0: x, w: gw, floor: -1, type: 'gap' });
        x += gw;
        // 落点必须不比起跳点高太多，否则跳不上去
        var lf = keepDropRoom(clampFloor(curFloor + rng.int(-1, 1)));
        var lw = rng.int(7, 10);              // §5.5 缓冲平台
        lw = Math.min(lw, W - 16 - x);
        if (lw < 4) lw = Math.min(4, W - 16 - x);
        for (i = 0; i < lw; i++) floorY[x + i] = lf;
        segments.push({ x0: x, w: lw, floor: lf, type: 'land' });
        flatRuns.push({ x0: x, w: lw, floor: lf });
        curFloor = lf;
        x += lw;
      } else if (type === 'shaft') {
        // §5.3 至少一处 6 格以上的垂直落差
        // 落差封顶 6 格（§5.3 要求的「至少一处 6 格以上」正好取最小值）。
        // 之前是 6~8，视觉上会出现一整屏高墙。
        var drop = Math.min(6, H - 3 - curFloor);
        var tw = rng.int(3, 5);
        tw = Math.min(tw, remain);
        var sf = clampFloor(curFloor + drop);
        for (i = 0; i < tw; i++) floorY[x + i] = sf;
        segments.push({ x0: x, w: tw, floor: sf, type: 'shaft' });
        dropDone = true;
        curFloor = sf;
        x += tw;
        // 落差之后给一块缓冲平台
        var bw = rng.int(7, 11);
        bw = Math.min(bw, W - 16 - x);
        if (bw > 0) {
          for (i = 0; i < bw; i++) floorY[x + i] = sf;
          segments.push({ x0: x, w: bw, floor: sf, type: 'land' });
          flatRuns.push({ x0: x, w: bw, floor: sf });
          x += bw;
        }
      } else { // branch
        var brw = rng.int(8, 12);
        brw = Math.min(brw, remain);
        var bf = keepDropRoom(clampFloor(curFloor));
        for (i = 0; i < brw; i++) floorY[x + i] = bf;
        segments.push({ x0: x, w: brw, floor: bf, type: 'branch' });
        flatRuns.push({ x0: x, w: brw, floor: bf });
        branchSpots.push({ x0: x, w: brw, floor: bf });
        branchCount++;
        curFloor = bf;
        x += brw;
      }
      lastType = type;
    }

    // 收尾平台 + 右边界墙
    var tailW = W - x - 2;
    if (tailW > 0) {
      for (i = 0; i < tailW; i++) floorY[x + i] = keepDropRoom(clampFloor(curFloor));
      segments.push({ x0: x, w: tailW, floor: clampFloor(curFloor), type: 'end' });
      flatRuns.push({ x0: x, w: tailW, floor: clampFloor(curFloor) });
      x += tailW;
    }
    for (i = 0; i < 2; i++) floorY[x + i] = clampFloor(curFloor);
    segments.push({ x0: x, w: 2, floor: clampFloor(curFloor), type: 'wall' });

    // ---------------------------------------------------------------- 填充
    var grid = [];
    for (var gy = 0; gy < H; gy++) {
      var row = new Array(W);
      for (var gx = 0; gx < W; gx++) row[gx] = '.';
      grid.push(row);
    }
    // 左右边界墙
    for (gy = 0; gy < H; gy++) { grid[gy][0] = '#'; grid[gy][1] = '#'; grid[gy][W - 1] = '#'; grid[gy][W - 2] = '#'; }
    for (gx = 2; gx < W - 2; gx++) {
      var fy = floorY[gx];
      if (fy < 0) continue;
      for (gy = fy; gy < H; gy++) grid[gy][gx] = '#';
    }

    // ------------------------------------------------------ 上层分支平台
    // §5.3 分支路径 1~2 条，其中至少 1 条通向隐藏支线宝物
    var branches = [];
    for (i = 0; i < branchSpots.length; i++) {
      var sp = branchSpots[i];
      var ph = rng.int(3, Math.min(4, MAX_STEP_HARD));  // 离地 3~4 格
      var py = sp.floor - ph;
      if (py < 4) continue;
      var px0 = sp.x0 + 1 + rng.int(0, 2);
      var pw = Math.max(4, Math.min(sp.w - 2, rng.int(5, 7)));
      for (gx = px0; gx < px0 + pw && gx < W - 2; gx++) grid[py][gx] = '#';
      branches.push({ x0: px0, w: pw, y: py, floor: sp.floor });
    }
    // §5.3 至少 1 条分支路径。随机分段可能一段都没抽中，这里兜底人造一条。
    if (branches.length === 0) {
      var bestRun = null;
      for (i = 0; i < flatRuns.length; i++) {
        var fr = flatRuns[i];
        if (fr.x0 < W * 0.35 || fr.x0 + fr.w > W - 10) continue;
        if (fr.w < 7) continue;
        if (!bestRun || fr.w > bestRun.w) bestRun = fr;
      }
      if (!bestRun) {
        for (i = 0; i < flatRuns.length; i++) {
          if (flatRuns[i].w >= 6 && flatRuns[i].x0 < W - 12) { bestRun = flatRuns[i]; break; }
        }
      }
      if (bestRun) {
        var fpy = bestRun.floor - 3;
        if (fpy >= 4) {
          var fx0 = bestRun.x0 + 1;
          var fw = Math.max(4, Math.min(bestRun.w - 2, 6));
          for (gx = fx0; gx < fx0 + fw && gx < W - 2; gx++) grid[fpy][gx] = '#';
          branches.push({ x0: fx0, w: fw, y: fpy, floor: bestRun.floor });
        }
      }
    }

    // 净空清理：主地表以上的实心瓦片之间必须留出至少 2 格净空（32 px）。
    // 主角碰撞盒 20 px 高，只剩 1 格（16 px）净空时整条走廊会被平台堵死。
    function cleanCorridors() {
      for (var cgx = 2; cgx < W - 2; cgx++) {
        var surf = floorY[cgx];
        if (surf < 0) continue;
        var lastSolid = surf;
        for (var cty = surf - 1; cty >= 0; cty--) {
          if (grid[cty][cgx] !== '#') continue;
          if (lastSolid - cty - 1 < 2) grid[cty][cgx] = '.';
          else lastSolid = cty;
        }
      }
    }

    // ------------------------------------------------------------ 机关
    var mechs = [];
    var mechKinds = th.mechs.slice();
    var groupTarget = diff.mechGroups[li - 1];
    var used = [];                     // 已占用的列区间
    function freeRun(minW, afterX, beforeX) {
      for (var k = 0; k < flatRuns.length; k++) {
        var r = flatRuns[k];
        if (r.w < minW) continue;
        if (r.x0 < afterX) continue;
        if (r.x0 + r.w > beforeX) continue;
        var clash = false;
        for (var u = 0; u < used.length; u++) {
          if (r.x0 < used[u].x1 + 3 && r.x0 + r.w > used[u].x0 - 3) { clash = true; break; }
        }
        if (clash) continue;
        return r;
      }
      return null;
    }

    var mechRunList = [];
    var MECH_NEED = {
      pressure_switch: 9, light_beam: 11, sequence_pads: 9,
      wind: 8, water_flow: 10, rune_puzzle: 9,
    };
    for (var m = 0; m < groupTarget; m++) {
      var kind = mechKinds[m % mechKinds.length];
      var needW = MECH_NEED[kind] || 9;
      var run = freeRun(needW, 18, W - 20);
      if (!run) run = freeRun(Math.max(6, needW - 3), 14, W - 14);
      if (!run) {
        // 兜底：在剩余区间里人工造一段平地，保证机关组数达标
        for (var ci = 0; ci < flatRuns.length; ci++) {
          var cand = flatRuns[ci];
          var clash2 = false;
          for (var u2 = 0; u2 < used.length; u2++) {
            if (cand.x0 < used[u2].x1 + 2 && cand.x0 + cand.w > used[u2].x0 - 2) { clash2 = true; break; }
          }
          if (clash2 || cand.x0 < 14 || cand.x0 + cand.w > W - 14) continue;
          if (cand.w >= 6) { run = cand; break; }
        }
      }
      if (!run) continue;
      used.push({ x0: run.x0, x1: run.x0 + run.w });
      mechRunList.push({ kind: kind, run: run });
    }

    var mechIds = { door: 0, plate: 0, stone: 0, pad: 0, mirror: 0, valve: 0, rune: 0, wind: 0 };
    function nid(t) { mechIds[t] = (mechIds[t] || 0) + 1; return t + '_' + pad2(mechIds[t]); }

    var doors = [];
    var windZones = [];
    var waterGates = [];
    var runeFrags = [];

    for (i = 0; i < mechRunList.length; i++) {
      var mr = mechRunList[i];
      var r2 = mr.run;
      var kind2 = mr.kind;
      var fy2 = r2.floor;

      if (kind2 === 'pressure_switch') {
        var doorId = nid('door');
        // 石门放在这段平地的最右侧，挡住前进
        var dx = r2.x0 + r2.w - 2;
        grid[fy2 - 1][dx] = '.'; // 门是实体对象，不是瓦片
        doors.push({ id: doorId, type: 'door', at: [dx, fy2 - 1], h: 3, open: false });
        var plateId = nid('plate');
        var pxx = r2.x0 + 2;
        mechs.push({ id: plateId, type: 'pressure_switch', at: [pxx, fy2 - 1], targets: [doorId] });
        var stoneId = nid('stone');
        mechs.push({
          id: stoneId, type: 'stone', at: [r2.x0 + 5, fy2 - 1], w: 12, h: 12,
          axis: 'x', min: r2.x0 + 1, max: r2.x0 + r2.w - 3,
        });
      } else if (kind2 === 'light_beam') {
        var doorId2 = nid('door');
        var dx2 = r2.x0 + r2.w - 2;
        doors.push({ id: doorId2, type: 'door', at: [dx2, fy2 - 1], h: 3, open: false });
        var ex = r2.x0 + 1, rx = r2.x0 + r2.w - 5;
        // 光束、反光块与玩家都站在同一层地面上：反光块必须能被玩家推着走。
        // 晶座放在上方 2 格，反光块把光束向上反射过去。
        var beamRow = fy2 - 1;
        var receiverRow = fy2 - 3;
        // 清出纵向光路，否则光会被上层平台挡住
        for (var vy2 = receiverRow; vy2 < beamRow; vy2++) {
          if (vy2 >= 0) grid[vy2][rx] = '.';
        }
        mechs.push({ id: nid('emitter'), type: 'emitter', at: [ex, beamRow], dir: 'right', target: doorId2 });
        mechs.push({ id: nid('receiver'), type: 'receiver', at: [rx, receiverRow], target: doorId2 });
        mechs.push({
          id: nid('mirror'), type: 'mirror', at: [r2.x0 + 4, beamRow], dir: 'right_up',
          axis: 'x', min: ex + 2, max: r2.x0 + r2.w - 6, want: rx,
        });
      } else if (kind2 === 'sequence_pads') {
        var doorId3 = nid('door');
        var dx3 = r2.x0 + r2.w - 2;
        doors.push({ id: doorId3, type: 'door', at: [dx3, fy2 - 1], h: 3, open: false });
        var order = [0, 1, 2];
        // 确定性打乱，保证每关顺序不同但可复现
        for (var oi = 2; oi > 0; oi--) {
          var oj = rng.int(0, oi);
          var tmp = order[oi]; order[oi] = order[oj]; order[oj] = tmp;
        }
        for (var pi = 0; pi < 3; pi++) {
          mechs.push({
            id: nid('pad'), type: 'sequence_pad', at: [r2.x0 + 2 + pi * 2, fy2 - 1],
            index: pi, order: order, door: doorId3,
          });
        }
      } else if (kind2 === 'wind') {
        // 风场：在坑上方铺一股上升气流，玩家借风跨越
        var wz = { id: nid('wind'), type: 'wind', at: [r2.x0 + r2.w - 6, fy2 - 7], w: 6, h: 8, fy: -420, fx: 0 };
        mechs.push(wz);
        windZones.push(wz);
      } else if (kind2 === 'water_flow') {
        var doorId4 = nid('door');
        doors.push({ id: doorId4, type: 'door', at: [r2.x0 + r2.w - 2, fy2 - 5], h: 3, open: false });
        // 阀门抬高水位，浮台随之抬升
        var platX = r2.x0 + 3;
        var high = fy2 - 6;
        for (var q2 = r2.x0 + 2; q2 < r2.x0 + r2.w - 3; q2++) grid[high][q2] = '#';
        mechs.push({ id: nid('valve'), type: 'water_valve', at: [r2.x0 + 1, fy2 - 1], target: doorId4 });
        mechs.push({
          id: nid('float'), type: 'float_platform', at: [platX, fy2 - 1], w: 3,
          lowY: fy2, highY: high + 1,
        });
      } else if (kind2 === 'rune_puzzle') {
        // 三块符文碎片散落在本段，终点符文台拼合后开门
        for (var ri = 0; ri < 3; ri++) {
          var fx = r2.x0 + 1 + ri * 3;
          runeFrags.push({ id: 'rune_' + li + '_' + ri, at: [fx, fy2 - 2] });
        }
        mechs.push({ id: nid('rune'), type: 'rune_altar', at: [r2.x0 + r2.w - 2, fy2 - 1], door: null });
      }
    }

    // 机关可能又加上了平台，再清一次净空，并剔除被清空的平台
    cleanCorridors();
    branches = branches.filter(function (br) {
      for (var q = br.x0; q < br.x0 + br.w; q++) {
        if (br.y >= 0 && grid[br.y][q] === '#') return true;
      }
      return false;
    });

    // ------------------------------------------------------------ 宝物
    // §5.3 拾遗宝物 2~3 件（表 4-2 每关 2 至 3 件，全局 60 件）
    var wantSide = [2, 2, 2, 3, 3][li - 1];
    var treasures = [];
    var content = (CT.DATA && CT.DATA.content) ? CT.DATA.content : null;
    var themeTreasures = content ? content.treasures.filter(function (t) { return t.theme === th.key; }) : [];
    var levelTreasures = themeTreasures.filter(function (t) { return t.level === levelId; });

    // 先在分支平台上放隐藏宝物（§5.3 至少 1 条分支通向隐藏支线宝物）
    var placed = 0;
    for (i = 0; i < branches.length && placed < wantSide; i++) {
      var br = branches[i];
      treasures.push({
        id: levelTreasures[placed] ? levelTreasures[placed].id : (levelId + '-t' + (placed + 1)),
        kind: 'side', at: [br.x0 + Math.floor(br.w / 2), br.y - 1], hidden: true,
      });
      placed++;
    }
    // 其余放在主路径高处或远处
    var candRuns = flatRuns.slice().reverse();
    for (i = 0; i < candRuns.length && placed < wantSide; i++) {
      var cr = candRuns[i];
      if (cr.type === 'end' || cr.x0 < 20) continue;
      treasures.push({
        id: levelTreasures[placed] ? levelTreasures[placed].id : (levelId + '-t' + (placed + 1)),
        kind: 'side', at: [cr.x0 + cr.w - 2, cr.floor - 2], hidden: false,
      });
      placed++;
    }
    // 保底：不足就补在起点后方
    while (placed < wantSide) {
      treasures.push({
        id: levelTreasures[placed] ? levelTreasures[placed].id : (levelId + '-t' + (placed + 1)),
        kind: 'side', at: [6 + placed * 3, baseY - 2], hidden: false,
      });
      placed++;
    }

    // 第 5 关：守护考验，通关获得本源彩晶；另有一枚守护印记藏在分支
    var finalDoor = null;
    if (li === 5) {
      var endFloor = floorY[W - 4] >= 0 ? floorY[W - 4] : baseY;
      treasures.push({ id: th.crystal, kind: 'main', at: [W - 5, endFloor - 3], hidden: false });
      var markBranch = branches[branches.length - 1];
      var markX = markBranch ? markBranch.x0 + markBranch.w - 1 : W - 12;
      var markY = markBranch ? markBranch.y - 1 : baseY - 2;
      treasures.push({ id: 'mark-' + th.key, kind: 'mark', at: [markX, markY], hidden: true });
    }
    for (i = 0; i < runeFrags.length; i++) {
      treasures.push({ id: runeFrags[i].id, kind: 'rune', at: runeFrags[i].at, hidden: false });
    }

    // ------------------------------------------------------------ 障碍物
    // 滚石：在地面来回滚动的实心石块。碰到扣一条命（见 game.js）。
    // 只放在没有机关的平地上，滚动范围留在这一段平台之内，不会滚进沟里。
    var hazards = [];
    var hzCount = Math.min(3, 1 + Math.floor(chapter / 2));   // 越靠后的章节越多
    var hzUsed = 0;
    for (var hi2 = 0; hi2 < flatRuns.length && hzUsed < hzCount; hi2++) {
      var hr = flatRuns[hi2];
      if (hr.w < 9) continue;
      if (hr.x0 < 16 || hr.x0 + hr.w > W - 16) continue;
      var clashH = false;
      for (var ui = 0; ui < used.length; ui++) {
        if (hr.x0 < used[ui].x1 + 2 && hr.x0 + hr.w > used[ui].x0 - 2) { clashH = true; break; }
      }
      if (clashH) continue;
      for (var cpi = 0; cpi < treasures.length; cpi++) {
        var tp = treasures[cpi].at;
        if (tp[0] >= hr.x0 && tp[0] < hr.x0 + hr.w) { clashH = true; break; }
      }
      if (clashH) continue;
      var rx0 = hr.x0 + 1;
      var rx1 = hr.x0 + hr.w - 2;
      var startX = rx0 + Math.floor((rx1 - rx0) / 2);
      hazards.push({
        id: 'boulder_' + (hzUsed + 1),
        type: 'boulder',
        at: [startX, hr.floor - 1],
        range: [rx0, rx1],
        speed: 34 + chapter * 3,           // 越往后越快，但始终慢于主角 90
        dir: (hzUsed % 2 === 0) ? 1 : -1,
      });
      used.push({ x0: rx0, x1: rx1 });
      hzUsed++;
    }
    // 保底：机关会占掉大部分平地，严格条件常常一个都放不下。
    // 每关至少要有一个滚石，否则这个机制在关内等于不存在。
    if (hzUsed === 0) {
      var bestRun = null;
      for (var bi2 = 0; bi2 < flatRuns.length; bi2++) {
        var br2 = flatRuns[bi2];
        if (br2.w < 7) continue;
        if (br2.x0 < 12 || br2.x0 + br2.w > W - 12) continue;
        if (!bestRun || br2.w > bestRun.w) bestRun = br2;
      }
      if (bestRun) {
        var cxr = bestRun.x0 + Math.floor(bestRun.w / 2);
        var half2 = Math.max(2, Math.min(4, Math.floor(bestRun.w / 2) - 1));
        var lo2 = Math.max(bestRun.x0 + 1, cxr - half2);
        var hi2b = Math.min(bestRun.x0 + bestRun.w - 2, cxr + half2);
        hazards.push({
          id: 'boulder_1',
          type: 'boulder',
          at: [cxr, bestRun.floor - 1],
          range: [lo2, hi2b],
          speed: 30 + chapter * 3,
          dir: 1,
        });
        hzUsed = 1;
      }
    }

    // ------------------------------------------------------------ 存档点
    // §5.3 存档石碑 1 个，置于关卡中段安全区
    var midX = Math.floor(W / 2);
    var cpFloor = -1, cpX = midX;
    for (i = 0; i < 40; i++) {
      var tx2 = midX + Math.floor((i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2));
      if (tx2 > 4 && tx2 < W - 5 && floorY[tx2] > 0) { cpFloor = floorY[tx2]; cpX = tx2; break; }
    }
    if (cpFloor < 0) { cpFloor = baseY; cpX = midX; }
    var checkpoint = { at: [cpX, cpFloor - 1], respawn: [cpX - 1, cpFloor - 2] };

    // ------------------------------------------------------------ NPC
    var npcs = [
      { id: th.key + '_npc_start', kind: th.npcs[0], at: [5, baseY - 1], facing: 1, slot: 0 },
      { id: th.key + '_npc_guide', kind: th.npcs[1], at: [W - 8, floorY[W - 6] > 0 ? floorY[W - 6] - 1 : baseY - 1], facing: -1, slot: 1 },
    ];

    // ------------------------------------------------------------ 出口
    var exitFloor = floorY[W - 4] >= 0 ? floorY[W - 4] : baseY;
    var exit = { at: [W - 4, exitFloor - 1], locked: li === 5 };

    // ------------------------------------------------------------ 装饰
    // §5.4 每屏不少于 8 个装饰；同类装饰不得连续重复 3 次；每类 2~3 变体
    var decor = [];
    var setCount = CT.Sprites.propSetCount(th.key);
    var lastSet = -1, runLen = 0;
    var rr = new CT.Rng(CT.seedOf('decor:' + levelId));
    function pushDecor(dx, dy, mode) {
      var set = rr.int(0, setCount - 1);
      if (set === lastSet) {
        runLen++;
        if (runLen >= 2) { set = (set + 1 + rr.int(0, setCount - 2)) % setCount; runLen = 0; }
      } else { runLen = 0; }
      lastSet = set;
      decor.push({ x: dx, y: dy, set: set, v: rr.int(0, 2), mode: mode });
    }
    for (gx = 2; gx < W - 2; gx++) {
      for (gy = 1; gy < H; gy++) {
        if (grid[gy][gx] !== '#') continue;
        var above = gy > 0 && grid[gy - 1][gx] === '.';
        var below = gy + 1 < H && grid[gy + 1][gx] === '.';
        if (above) {
          // 地表装饰
          // 密度从 0.56 降到 0.34：装饰变大了，再撒原来那么多就杂乱
          // 密度再降 20%：0.34 -> 0.27
          if (rr.f() < 0.27) pushDecor(gx, gy, 'top');
        } else if (below) {
          // 悬挂装饰（洞顶垂藤）
          if (rr.f() < 0.10) pushDecor(gx, gy, 'hang');
        }
        break;   // 每列只取最上一层
      }
    }
    // 保证总数下限（§5.3 不少于 40 个）
    var guard = 0;
    while (decor.length < 46 && guard < 4000) {
      guard++;
      gx = rr.int(3, W - 4);
      var gyy = floorY[gx];
      if (gyy < 0) continue;
      pushDecor(gx, gyy, 'top');
    }

    // 密度修复：§5.4 要求每屏可见范围内至少有 8 个装饰。均匀概率撒点无法保证
    // 每个 30 格窗口都达标（沟槽与边缘处会掉下来），因此在达标前做一轮补齐。
    // 目标从 11 降到 9：规格书要求每屏 >= 8，9 留 1 个余量且明显不挤
    // 目标从 9 降到 7（相对 9 约 -22%）
    var TARGET_PER_SCREEN = 7;
    for (var wx = 0; wx <= W - 30; wx += 1) {
      var cnt = 0, d2;
      for (d2 = 0; d2 < decor.length; d2++) {
        if (decor[d2].x >= wx && decor[d2].x < wx + 30) cnt++;
      }
      if (cnt >= TARGET_PER_SCREEN) continue;
      for (gx = wx; gx < wx + 30 && cnt < TARGET_PER_SCREEN; gx++) {
        if (gx < 2 || gx >= W - 2) continue;
        var fy3 = floorY[gx];
        if (fy3 < 0 || fy3 >= H) continue;
        var dup = false;
        for (d2 = 0; d2 < decor.length; d2++) if (decor[d2].x === gx) { dup = true; break; }
        if (dup) continue;
        pushDecor(gx, fy3, 'top');
        cnt++;
      }
    }
    // 修复后再按 x 排序，保持绘制顺序与裁剪二分可用
    decor.sort(function (a, b) { return a.x - b.x; });
    // 排序会把原本不相邻的同款装饰凑到一起，因此必须在这一步之后
    // 重新保证「同一装饰不得连续重复 3 次」（§5.4）—— 否则补密度那一步
    // 会把不变量破坏掉。
    for (var di3 = 2; di3 < decor.length; di3++) {
      if (decor[di3].set === decor[di3 - 1].set && decor[di3].set === decor[di3 - 2].set) {
        decor[di3].set = (decor[di3].set + 1) % setCount;
      }
    }

    // ------------------------------------------------------------ 汇总
    var rows = [];
    for (gy = 0; gy < H; gy++) rows.push(grid[gy].join(''));

    var json = {
      level_id: levelId,
      theme: th.key,
      name: info.name,
      size: { w: W, h: H },
      layers: { ground: rows },
      spawn: [4, baseY - 2],
      mechanisms: mechs.concat(doors),
      hazards: hazards,
      decor: decor,
      treasures: treasures,
      npcs: npcs,
      checkpoint: checkpoint,
      exit: exit,
      // 生成期元数据，供校验器与调试使用
      meta: {
        maxGap: maxGap, maxStepUp: maxStepUp,
        branches: branches.length,
        dropDone: dropDone,
        mechGroups: mechRunList.length,
        mechKinds: mechRunList.map(function (r) { return r.kind; }),
        hazards: hazards.length,
        layout: layout,
        jumpHeightTiles: +JUMP_H.toFixed(2),
        jumpDistTiles: +JUMP_DIST.toFixed(2),
      },
    };
    return json;
  }

  // ---------------------------------------------------------------- 校验
  // 逐条核对 §5.3 指标与 §5.4 装饰密度，构建期与验收期都跑
  function validate(json, opts) {
    opts = opts || {};
    var errs = [];
    var W = json.size.w, H = json.size.h;
    var rows = json.layers.ground;

    // 宽度按后续需求整体 +40%，因此这里放宽到 160~260（原 §5.3 为 120~180）
    if (W < 160 || W > 260) errs.push('width ' + W + ' not in 160..260');
    if (H < 24 || H > 40) errs.push('height ' + H + ' not in 24..40');

    // 垂直落差 >= 6 格
    // 主地表 = 从底部往上连续实心的最高点。注意不能用「从上往下第一个 #」，
    // 那样会把上层分支平台误当成地表，从而算出并不存在的巨大台阶。
    var surface = [];
    for (var x = 2; x < W - 2; x++) {
      var fy = -1;
      for (var y = H - 1; y >= 0; y--) {
        if (rows[y].charAt(x) === '#') fy = y; else break;
      }
      surface.push(fy);
    }
    var maxDrop = 0;
    for (var i = 1; i < surface.length; i++) {
      if (surface[i - 1] < 0 || surface[i] < 0) continue;
      var d = surface[i] - surface[i - 1];
      if (d > maxDrop) maxDrop = d;
    }
    if (maxDrop < 6) errs.push('no vertical drop >= 6 tiles (max ' + maxDrop + ')');
    // 落差封顶：任何相邻列的地表高差都不应超过 6 格
    if (maxDrop > 6) errs.push('vertical drop ' + maxDrop + ' exceeds cap 6');

    // 沟宽与台阶高度不超过物理上限
    var gx = 0, curFloor = -1;
    var maxGapSeen = 0, maxStepSeen = 0;
    while (gx < surface.length) {
      if (surface[gx] < 0) {
        var s0 = gx;
        while (gx < surface.length && surface[gx] < 0) gx++;
        var gw = gx - s0;
        if (gw > maxGapSeen) maxGapSeen = gw;
        continue;
      }
      if (curFloor >= 0) {
        var st = curFloor - surface[gx];
        if (st > maxStepSeen) maxStepSeen = st;
      }
      curFloor = surface[gx];
      gx++;
    }
    if (maxGapSeen > MAX_GAP_HARD) errs.push('gap ' + maxGapSeen + ' exceeds jump distance (' + MAX_GAP_HARD + ')');
    if (maxStepSeen > MAX_STEP_HARD) errs.push('step up ' + maxStepSeen + ' exceeds jump height (' + MAX_STEP_HARD + ')');

    // 机关 3~6 组，同时生效种类 <= 3
    var groups = (json.meta && json.meta.mechGroups) || 0;
    if (groups < 3 || groups > 6) errs.push('mechanism groups ' + groups + ' not in 3..6');
    var kinds = {};
    for (var m of json.mechanisms) {
      if (m.type === 'stone' || m.type === 'door' || m.type === 'mirror' ||
          m.type === 'emitter' || m.type === 'receiver' || m.type === 'float_platform') continue;
      kinds[m.type] = 1;
    }
    var kindCount = Object.keys(kinds).length;
    if (kindCount > 3) errs.push('simultaneous mechanism kinds ' + kindCount + ' > 3');

    // 宝物 2~3 件（side）
    var side = json.treasures.filter(function (t) { return t.kind === 'side'; }).length;
    if (side < 2 || side > 3) errs.push('side treasures ' + side + ' not in 2..3');

    // 装饰 >= 40，且每屏 >= 8
    if (json.decor.length < 40) errs.push('decor ' + json.decor.length + ' < 40');
    var worst = Infinity, worstAt = 0;
    for (var cx = 0; cx <= W * 16 - 480; cx += 16) {
      var n = 0;
      var x0 = cx / 16, x1 = (cx + 480) / 16;
      for (var di = 0; di < json.decor.length; di++) {
        var dd = json.decor[di];
        if (dd.x >= x0 && dd.x < x1) n++;
      }
      if (n < worst) { worst = n; worstAt = Math.round(x0); }
    }
    // 装饰密度按后续需求下调约 20%，每屏下限从 8 降到 7
    if (worst < 7) errs.push('per-screen decor minimum ' + worst + ' < 7 (at tile x=' + worstAt + ')');

    // 连续重复装饰不超过 2 次同类
    var runS = 0, prevS = -1;
    for (var k = 0; k < json.decor.length; k++) {
      var s = json.decor[k].set;
      if (s === prevS) { runS++; if (runS >= 3) { errs.push('decor set ' + s + ' repeats ' + (runS + 1) + ' times in a row'); break; } }
      else { runS = 0; prevS = s; }
    }

    // 障碍物：每关至少 1 个滚石，否则生命值机制形同虚设
    var hzN = (json.hazards || []).length;
    if (hzN < 1) errs.push('no hazard (boulder) generated');

    // 存档碑 1 个
    if (!json.checkpoint) errs.push('missing checkpoint');

    // 出口
    if (!json.exit) errs.push('missing exit');

    // 分支至少 1 条且通到隐藏宝物
    var branches = (json.meta && json.meta.branches) || 0;
    if (branches < 1) errs.push('no branch path');
    var hidden = json.treasures.filter(function (t) { return t.hidden; }).length;
    if (hidden < 1) errs.push('no hidden treasure on a branch');

    return { ok: errs.length === 0, errors: errs, stats: {
      W: W, H: H, maxDrop: maxDrop, maxGap: maxGapSeen, maxStepUp: maxStepSeen,
      mechGroups: groups, mechKinds: kindCount, sideTreasures: side,
      decor: json.decor.length, minDecorPerScreen: worst, hazards: hzN,
      branches: branches, hiddenTreasures: hidden,
    } };
  }

  CT.LevelGen = { generate: generate, validate: validate, MAX_GAP_HARD: MAX_GAP_HARD, MAX_STEP_HARD: MAX_STEP_HARD };
})();
