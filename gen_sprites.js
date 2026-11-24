/* 晶途拾光 — 角色 / NPC / 宝物 / 装饰物 生成
 * --------------------------------------------------------------------------
 * §3.1 主角规格：16 × 24 像素（含帽子与靴子），脚底留 1 像素透明边；
 *      色数单帧不超过 12 色；1 像素深色描边（非纯黑，取主题最深色）。
 * §3.2 主角共 6 组动作，8 至 12 帧每秒，逐帧硬切：
 *      待机 4 / 行走 6 / 跳跃 4 / 拾取 4 / 对话 2 / 庆祝 6
 * §3.4 造型红线：2 至 3 头身、圆润、无生物恐怖元素。
 *
 * 角色用 ASCII 像素图描述：头 / 身 / 腿三段积木按动作表拼装，眼睛单独盖印，
 * 描边由 Art.addOutline 统一生成。这样 26 帧动作共享同一套积木，
 * 既保证比例不漂移，也让「同一帧内不超过 12 色」在结构上成立。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});
  var A = CT.Art;
  var G = CT.Palette.G;
  var gc = CT.Palette.gc;

  var HERO_W = 16, HERO_H = 24;

  // 11 色调色表 + 描边 = 12 色，正好打在 §3.1 的上限
  function heroMap() {
    return {
      H: gc(G.HOOD), h: gc(G.HOOD_M), d: gc(G.HOOD_D),
      S: gc(G.SHIRT), s: gc(G.SHIRT_M), t: gc(G.SHIRT_D),
      P: gc(G.PANTS), p: gc(G.PANTS_M),
      B: gc(G.BOOT), K: gc(G.SKIN), k: gc(G.SKIN_D),
    };
  }

  // ------------------------------------------------------------ 头部积木
  // 8 行；第 3~6 行是脸，眼睛盖印在第 3~4 行。
  // 兜帽三段色（亮/中/暗）明确分开，否则米白帽与肤色糊成一片。
  // 头部重新分配比例：兜帽 4 行（尖顶 + 帽檐），脸 4 行且加宽到 10 像素。
  // 之前脸只占 8 像素宽、2 行可见，远看就是一团米白。
  var HEAD_A = [
    '.....HHHHHH.....',
    '...HHHHHHHHHH...',
    '..HHhhhhhhhhHH..',
    '..HdkkkkkkkkdH..',
    '..HdKKKKKKKkdH..',
    '..HdKKKKKKKkdH..',
    '...dKKKKKKkd...',
    '....kKKKKKKk....',
  ];
  // 呼吸帧：帽顶收窄 1 像素，读作轻微起伏
  // 行走时的轻微起伏：帽檐宽 1 像素，读作兜帽随步幅上下
  var HEAD_B = [
    '.....HHHHHH.....',
    '..HHHHHHHHHHHH..',
    '..HHhhhhhhhhHH..',
    '..HdkkkkkkkkdH..',
    '..HdKKKKKKKkdH..',
    '..HdKKKKKKKkdH..',
    '...dKKKKKKkd...',
    '....kKKKKKKk....',
  ];
  // 对话帧：点头，帽檐压下一线
  var HEAD_TALK = [
    '.....HHHHHH.....',
    '...HHHHHHHHHH...',
    '..HHhhhhhhhhHH..',
    '..HdkkkkkkkkdH..',
    '..HdKKKKKKKkdH..',
    '..HdKKKKKKKkdH..',
    '...dKKKKKKkd...',
    '....kKKKKKKk....',
  ];

  // ------------------------------------------------------------ 躯干积木
  // 7 行。手臂用 t（上衣暗部）与躯干的 S/s 拉开，轮廓才读得出
  var TORSO_A = [
    '....sSSSSSSs....',
    '..BtSSSSSSSSt...',
    '..BtSSSSSSSSt...',
    '.BBtSSSSSSSSt...',
    '..BtSSSSSSSSt...',
    '...KSSSSSSSSK...',
    '....PPPPPPPP....',
  ];
  var TORSO_UP = [
    '...KSSSSSSSSK...',
    '..BtSSSSSSSSt...',
    '..BtSSSSSSSSt...',
    '..BtSSSSSSSSt...',
    '...BsSSSSSSs....',
    '....PPPPPPPP....',
    '....PPPPPPPP....',
  ];
  var TORSO_LEAN = [
    '.....sSSSSSs....',
    '...BBsSSSSSSs...',
    '...BBtSSSSSts...',
    '...BBtSSSSSts...',
    '....BtSSSSSts...',
    '....KSSSSSSSK...',
    '.....PPPPPPP....',
  ];

  // ------------------------------------------------------------ 腿部积木
  var LEGS = {
    stand: [
      '....PPPPPPPP....',
      '....PPPPPPPP....',
      '.....PP..PP.....',
      '.....PP..PP.....',
      '.....BB..BB.....',
      '.....BB..BB.....',
      '....BBB..BBB....',
    ],
    strideA: [
      '....PPPPPPPP....',
      '....PPPPPPPP....',
      '....PPP..PP.....',
      '....PP...PP.....',
      '...BB....BB.....',
      '...BB....BB.....',
      '..BBB...BBB.....',
    ],
    strideB: [
      '....PPPPPPPP....',
      '....PPPPPPPP....',
      '.....PPPPP......',
      '.....PP.PP......',
      '.....BB.BB......',
      '....BB...BB.....',
      '...BBB..BBB.....',
    ],
    strideC: [
      '....PPPPPPPP....',
      '....PPPPPPPP....',
      '....PP..PPP.....',
      '....PP...PP.....',
      '....BB....BB....',
      '....BB....BB....',
      '...BBB...BBB....',
    ],
    strideD: [
      '....PPPPPPPP....',
      '....PPPPPPPP....',
      '.....PPPPP......',
      '......PP.PP.....',
      '......BB.BB.....',
      '.....BB...BB....',
      '....BBB..BBB....',
    ],
    // 上升：屈膝收腿
    tuck: [
      '....PPPPPPPP....',
      '....PPPPPPPP....',
      '....PPP.PPP.....',
      '...BB.....BB....',
      '...BB.....BB....',
      '................',
      '................',
    ],
    // 下落：伸腿
    spread: [
      '....PPPPPPPP....',
      '....PPPPPPPP....',
      '....PPP..PP.....',
      '....PP....PP....',
      '...BB......BB...',
      '...BB......BB...',
      '..BBB.....BBB...',
    ],
    // 落地缓冲：屈膝下蹲
    land: [
      '....PPPPPPPP....',
      '...PPPPPPPPPP...',
      '...PPP....PPP...',
      '....BB....BB....',
      '....BB....BB....',
      '...BBB....BBB...',
      '................',
    ],
    // 拾取：深蹲
    crouch: [
      '....PPPPPPPP....',
      '...PPPPPPPPPP...',
      '...PPP....PPP...',
      '....BB..BB......',
      '....BB..BB......',
      '...BBB..BBB.....',
      '................',
    ],
    // 庆祝：双腿分开小跳
    hop: [
      '....PPPPPPPP....',
      '....PPPPPPPP....',
      '...PPP....PPP...',
      '..BB........BB..',
      '..BB........BB..',
      '.BBB........BBB.',
      '................',
    ],
  };

  // ------------------------------------------------------------- 拼装
  function assemble(head, torso, legs, eyes, outlineColor) {
    var rows = head.concat(torso, legs); // 8 + 7 + 7 = 22 行
    var b = A.fromRows(rows, heroMap());
    stampEyes(b, eyes, outlineColor);
    // 拼装结果贴在 16×24 画布第 1 行，四周各留 1 像素给描边（§3.1 脚底留 1 像素透明边）
    var canvas = A.buf(HERO_W, HERO_H);
    A.blit(canvas, 0, 1, b);
    return A.addOutline(canvas, outlineColor);
  }

  function stampEyes(b, mode, eyeColor) {
    if (mode === 'none') return;
    var eye = eyeColor;   // 与描边同色，才能守住 §3.1「单帧不超过 12 色」
    // 眼睛落在头部第 3~4 行（拼装后即缓冲区第 3、4 行）
    // 脸现在占第 4~7 行，眼睛落在第 5~6 行，左右对称
    if (mode === 'open') {
      A.fill(b, 5, 5, 2, 2, eye);
      A.fill(b, 9, 5, 2, 2, eye);
      // 一点高光，让眼神不呆
      A.set(b, 5, 5, gc(G.WHITE));
      A.set(b, 9, 5, gc(G.WHITE));
    } else if (mode === 'blink') {
      A.fill(b, 5, 6, 2, 1, eye);
      A.fill(b, 9, 6, 2, 1, eye);
    } else if (mode === 'up') {
      // 庆祝时眼睛看向上方
      A.fill(b, 5, 5, 2, 2, eye);
      A.fill(b, 9, 5, 2, 2, eye);
      A.set(b, 6, 5, gc(G.WHITE));
      A.set(b, 10, 5, gc(G.WHITE));
    }
  }

  // 6 组动作的帧表（§3.2）
  var ANIM = {
    idle: {
      fps: 8, frames: [
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.stand, eyes: 'open' },
        { head: HEAD_B, torso: TORSO_A, legs: LEGS.stand, eyes: 'open' },
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.stand, eyes: 'open' },
        { head: HEAD_B, torso: TORSO_A, legs: LEGS.stand, eyes: 'blink' },
      ],
    },
    walk: {
      fps: 10, frames: [
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.strideA, eyes: 'open' },
        { head: HEAD_B, torso: TORSO_A, legs: LEGS.strideB, eyes: 'open' },
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.strideC, eyes: 'open' },
        { head: HEAD_B, torso: TORSO_A, legs: LEGS.strideD, eyes: 'open' },
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.strideC, eyes: 'open' },
        { head: HEAD_B, torso: TORSO_A, legs: LEGS.strideB, eyes: 'open' },
      ],
    },
    jump: {
      fps: 12, frames: [
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.land, eyes: 'open' },
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.tuck, eyes: 'open' },
        { head: HEAD_B, torso: TORSO_A, legs: LEGS.tuck, eyes: 'open' },
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.spread, eyes: 'open' },
      ],
    },
    pickup: {
      fps: 10, frames: [
        { head: HEAD_A, torso: TORSO_LEAN, legs: LEGS.stand, eyes: 'open' },
        { head: HEAD_A, torso: TORSO_LEAN, legs: LEGS.crouch, eyes: 'blink' },
        { head: HEAD_B, torso: TORSO_LEAN, legs: LEGS.crouch, eyes: 'blink' },
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.stand, eyes: 'open' },
      ],
    },
    talk: {
      fps: 8, frames: [
        { head: HEAD_A, torso: TORSO_A, legs: LEGS.stand, eyes: 'open' },
        { head: HEAD_TALK, torso: TORSO_A, legs: LEGS.stand, eyes: 'open' },
      ],
    },
    celebrate: {
      fps: 12, frames: [
        { head: HEAD_A, torso: TORSO_UP, legs: LEGS.land, eyes: 'up' },
        { head: HEAD_B, torso: TORSO_UP, legs: LEGS.hop, eyes: 'up' },
        { head: HEAD_A, torso: TORSO_UP, legs: LEGS.hop, eyes: 'up' },
        { head: HEAD_B, torso: TORSO_UP, legs: LEGS.hop, eyes: 'up' },
        { head: HEAD_A, torso: TORSO_UP, legs: LEGS.spread, eyes: 'up' },
        { head: HEAD_A, torso: TORSO_UP, legs: LEGS.land, eyes: 'up' },
      ],
    },
  };

  var heroCache = {};
  function buildHero(themeKey) {
    if (heroCache[themeKey]) return heroCache[themeKey];
    var outline = CT.Palette.get(themeKey).c[14]; // §3.1 描边用主题最深色
    var out = {};
    for (var name in ANIM) {
      var def = ANIM[name];
      var frames = [];
      for (var i = 0; i < def.frames.length; i++) {
        var f = def.frames[i];
        frames.push(assemble(f.head, f.torso, f.legs, f.eyes, outline));
      }
      out[name] = { fps: def.fps, frames: frames };
    }
    heroCache[themeKey] = out;
    return out;
  }

  // -------------------------------------------------------------- 主角光效
  // §3.1 脚下 9 × 3 像素椭圆微光；收集彩晶后光色切换为主题主色
  function buildFootGlow(color) {
    var b = A.buf(9, 3);
    A.ellipse(b, 4, 1, 4, 1, color);
    return b;
  }

  // ---------------------------------------------------------------- 宝物
  // 主线彩晶：菱形晶体。外描边用主题最深色（§3.1 非纯黑描边）
  function buildCrystal(color, accent, outline) {
    var shape = [
      '.......##.......',
      '......####......',
      '.....######.....',
      '....########....',
      '...##########...',
      '...##########...',
      '..############..',
      '...##########...',
      '...##########...',
      '....########....',
      '.....######.....',
      '......####......',
      '.......##.......',
    ];
    var b = A.fromRows(shape, { '#': color });
    // 内部高光：左上受光棱面
    A.fill(b, 6, 5, 2, 4, accent);
    A.fill(b, 7, 4, 1, 1, accent);
    A.fill(b, 5, 6, 1, 2, accent);
    // 右下暗面
    A.dither(b, 8, 7, 6, 6, gc(G.SHADE), 6);
    return A.addOutline(b, outline === undefined ? gc(G.OUTLINE) : outline);
  }

  // 拾遗宝物：系带小盒，五行内可辨；局部像素闪光由渲染层叠加
  function buildTreasure(color, accent) {
    var b = A.buf(12, 12);
    A.fill(b, 1, 4, 10, 6, color);              // 盒身
    A.fill(b, 1, 3, 10, 1, accent);             // 盒盖
    A.fill(b, 1, 9, 10, 1, gc(G.SHADE));        // 底暗线
    A.fill(b, 6, 3, 2, 7, accent);              // 竖向缎带
    A.fill(b, 1, 6, 10, 1, accent);             // 横向缎带
    A.set(b, 3, 5, gc(G.WARM));
    A.set(b, 9, 7, gc(G.WARM));
    A.fill(b, 7, 2, 2, 1, accent);              // 顶部小绳结
    return A.addOutline(b, gc(G.OUTLINE));
  }

  // 守护印记：环状符文
  function buildMark(color, accent) {
    var b = A.buf(12, 12);
    A.ellipse(b, 6, 6, 5, 5, color);
    A.ellipse(b, 6, 6, 3, 3, 0);
    // 内部菱形符文
    A.set(b, 6, 3, accent);
    A.fill(b, 5, 4, 3, 1, accent);
    A.fill(b, 4, 5, 5, 2, accent);
    A.fill(b, 5, 7, 3, 1, accent);
    A.set(b, 6, 8, accent);
    return A.addOutline(b, gc(G.OUTLINE));
  }

  // ---------------------------------------------------------------- NPC
  // 全部为友善或中立的自然生灵，尺寸 16×16 至 24×24，不得大于主角 1.5 倍
  var npcCache = {};
  function buildNpc(kind, P) {
    var key = kind;
    if (npcCache[key]) return npcCache[key];
    var b, i;
    var outline = P.c[14];   // §3.1 非纯黑描边，取主题最深色
    if (kind === 'firefly') {
      // 林间萤灵：三颗光点加一对薄翼
      b = A.buf(20, 20);
      A.ellipse(b, 10, 10, 5, 5, P.c[4]);
      A.ellipse(b, 10, 10, 4, 4, P.c[15]);
      A.ellipse(b, 10, 10, 2, 2, gc(G.WHITE));
      for (i = 0; i < 3; i++) {
        var ang = (i / 3) * Math.PI * 2 + 0.4;
        A.set(b, Math.round(10 + Math.cos(ang) * 7), Math.round(10 + Math.sin(ang) * 7), P.c[0]);
      }
      // 薄翼：两片抖动叶
      for (var wy = -3; wy <= 3; wy++) {
        var ww = 4 - Math.abs(wy);
        A.fill(b, 3, 10 + wy, ww, 1, P.c[1]);
        A.fill(b, 17 - ww, 10 + wy, ww, 1, P.c[1]);
      }
      A.fill(b, 2, 9, 1, 3, P.c[0]);
      A.fill(b, 17, 9, 1, 3, P.c[0]);
    } else if (kind === 'elder') {
      // 石苔长老：圆润石块 + 青苔 + 两只小眼（无尖角，§3.4）
      b = A.buf(24, 22);
      A.ellipse(b, 12, 12, 10, 9, P.c[11]);
      A.ellipse(b, 12, 11, 9, 8, P.c[3]);
      for (var py = 4; py < 20; py++) {
        var t = (py - 4) / 16;
        if (t > 0.45) A.fill(b, 3 + Math.round(t * 2), py, 18 - Math.round(t * 4), 1, P.c[11]);
      }
      A.ellipse(b, 10, 8, 6, 4, P.c[2]);
      A.ellipse(b, 6, 6, 3, 2, P.c[1]);
      // 青苔斑
      A.fill(b, 5, 5, 4, 1, P.c[7]);
      A.fill(b, 14, 6, 3, 1, P.c[7]);
      A.fill(b, 8, 16, 5, 2, P.c[12]);
      A.hline(b, 4, 19, 16, P.c[12]);
      A.set(b, 8, 10, gc(G.OUTLINE)); A.set(b, 9, 10, gc(G.OUTLINE));
      A.set(b, 14, 10, gc(G.OUTLINE)); A.set(b, 15, 10, gc(G.OUTLINE));
      A.set(b, 8, 10, gc(G.WHITE)); A.set(b, 14, 10, gc(G.WHITE));
    } else if (kind === 'messenger') {
      // 云絮信使：蓬松云团，边缘柔和（用抖动做柔边，不用渐变）
      b = A.buf(24, 20);
      A.ellipse(b, 12, 13, 10, 6, P.c[1]);
      A.ellipse(b, 8, 9, 6, 5, P.c[0]);
      A.ellipse(b, 15, 10, 5, 4, P.c[0]);
      A.ellipse(b, 12, 7, 5, 4, P.c[1]);
      A.dither(b, 3, 15, 18, 4, P.c[2], 7);
      A.dither(b, 3, 17, 18, 2, P.c[3], 4);
      A.set(b, 9, 12, gc(G.OUTLINE)); A.set(b, 14, 12, gc(G.OUTLINE));
      A.hline(b, 10, 15, 3, P.c[3]);
      A.hline(b, 13, 15, 3, P.c[3]);
    } else if (kind === 'clam') {
      // 河蚌灵：半开贝壳 + 珍珠光
      b = A.buf(22, 18);
      A.ellipse(b, 11, 12, 10, 5, P.c[11]);
      A.ellipse(b, 11, 11, 9, 4, P.c[2]);
      A.ellipse(b, 11, 8, 9, 3, P.c[3]);
      A.ellipse(b, 11, 6, 7, 2, P.c[2]);
      // 壳纹
      for (i = -3; i <= 3; i++) A.vline(b, 11 + i * 3, 9, 3, P.c[4]);
      A.ellipse(b, 11, 9, 3, 2, gc(G.WARM));
      A.set(b, 11, 9, gc(G.WHITE));
      A.hline(b, 2, 16, 18, P.c[12]);
      A.set(b, 7, 10, gc(G.OUTLINE)); A.set(b, 15, 10, gc(G.OUTLINE));
    } else {
      // 苔痕向导：两片叶子 + 一根木杖
      b = A.buf(22, 22);
      A.fill(b, 5, 6, 2, 15, P.c[9]);          // 木杖（2 像素宽）
      A.set(b, 5, 5, P.c[8]);
      A.set(b, 4, 20, P.c[8]);
      A.ellipse(b, 13, 11, 6, 7, P.c[5]);      // 叶身
      A.ellipse(b, 13, 9, 4, 5, P.c[4]);
      A.vline(b, 13, 4, 8, P.c[6]);            // 叶脉
      A.fill(b, 10, 8, 3, 1, P.c[6]);
      A.fill(b, 14, 11, 3, 1, P.c[6]);
      A.ellipse(b, 12, 6, 3, 3, P.c[3]);       // 小芽
      A.set(b, 14, 11, gc(G.OUTLINE)); A.set(b, 15, 11, gc(G.OUTLINE));
      A.set(b, 14, 11, gc(G.WHITE));
      A.dither(b, 0, 18, 16, 4, P.c[12], 7);
    }
    var out = A.addOutline(b, outline);
    npcCache[key] = out;
    return out;
  }

  // ------------------------------------------------------------ 装饰物积木
  /* §5.4：每屏至少 8 个装饰物件，同一装饰不得连续重复 3 次，同类装饰必须准备
   * 2 至 3 个变体。这里提供一组参数化积木，每主题用它们组出 8 类以上装饰。 */

  // 装饰物积木（第二版）
  // 第一版是 7~14 像素的椭圆 + 噪点，缩到 16 像素瓦片的尺度后成了「认识的形状里
  // 最不认识的那一类」。这一版的原则：每件东西 14~28 像素、轮廓用明确的几何体、
  // 顶部一定有一行亮色压边、底部一定有一行暗色投影。数量上也做了减法。
  function pTuft(P, rng, cols) {               // 蕨类 / 草丛
    var w = 15 + ((rng.f() * 5) | 0);
    var h = 16 + ((rng.f() * 7) | 0);
    var b = A.buf(w, h + 3);
    var bx = w >> 1;
    var n = 5 + ((rng.f() * 3) | 0);
    for (var i = 0; i < n; i++) {
      var spread = (i - (n - 1) / 2) / Math.max(1, (n - 1) / 2);
      var len = Math.round(h * (0.66 + rng.f() * 0.34) * (1 - Math.abs(spread) * 0.22));
      for (var s = 0; s < len; s++) {
        var t = s / len;
        var px = bx + spread * 5.5 * t * t;
        var py = h - 1 - s;
        A.set(b, Math.round(px), py, t > 0.7 ? cols[0] : (t > 0.32 ? cols[1] : cols[2]));
        if (s > 2 && s % 4 === 0) A.set(b, Math.round(px) + (spread >= 0 ? 1 : -1), py, cols[2]);
      }
    }
    A.fill(b, bx - 3, h, 7, 2, cols[2]);
    A.hline(b, bx - 4, h + 2, 9, cols[2]);
    return b;
  }

  function pMushroom(P, rng, cols) {           // 蘑菇：伞 + 菌褶 + 柄 + 白点
    var w = 13 + ((rng.f() * 3) | 0) * 2;
    var capH = 6;
    var stemH = 7 + ((rng.f() * 3) | 0);
    var b = A.buf(w, capH + stemH + 3);
    var cx = w >> 1;
    for (var y = 0; y < capH; y++) {
      var t = y / (capH - 1);
      var half = Math.round((w / 2 - 1) * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))));
      A.fill(b, cx - half, y, half * 2 + 1, 1, y < 2 ? cols[1] : cols[0]);
    }
    A.hline(b, 1, capH - 1, w - 2, cols[3]);
    A.fill(b, cx - 2, capH, 5, 1, cols[3]);
    A.fill(b, cx - 1, capH + 1, 3, stemH, cols[2]);
    A.vline(b, cx - 1, capH + 1, stemH, cols[3]);
    A.set(b, cx, 1, gc(G.WHITE));
    A.set(b, cx - 3, 2, gc(G.WHITE));
    A.set(b, cx + 3, 3, gc(G.WHITE));
    A.hline(b, cx - 3, capH + stemH + 1, 7, cols[3]);
    return b;
  }

  function pStone(P, rng, cols) {              // 圆润石块：受光面 + 投影
    var w = 14 + ((rng.f() * 6) | 0);
    var h = 9 + ((rng.f() * 4) | 0);
    var b = A.buf(w, h + 3);
    var cx = w >> 1;
    for (var y = 0; y < h; y++) {
      var t = y / (h - 1);
      var half = Math.round((w / 2 - 1) * Math.sqrt(Math.max(0, 1 - Math.pow(t * 2 - 1, 2))));
      A.fill(b, cx - half, y, half * 2 + 1, 1, t < 0.36 ? cols[1] : cols[0]);
    }
    A.fill(b, cx - 4, 2, 5, 2, cols[1]);
    A.hline(b, 2, h - 1, w - 4, cols[2]);
    A.hline(b, 1, h + 1, w - 2, cols[2]);
    if (rng.f() < 0.7) {
      for (var i = 0; i < 3; i++) A.set(b, 3 + ((rng.f() * (w - 6)) | 0), 1 + ((rng.f() * 2) | 0), cols[3]);
    }
    return b;
  }

  function pFlower(P, rng, cols) {             // 小花：茎 + 五瓣花冠
    var h = 13 + ((rng.f() * 5) | 0);
    var b = A.buf(11, h + 3);
    var cx = 5;
    A.fill(b, cx, 5, 1, h - 4, cols[2]);
    A.set(b, cx - 1, h - 5, cols[2]);
    A.set(b, cx + 1, h - 7, cols[2]);
    A.fill(b, cx - 1, 1, 3, 1, cols[0]);
    A.fill(b, cx - 2, 2, 5, 3, cols[0]);
    A.fill(b, cx - 1, 5, 3, 1, cols[0]);
    A.set(b, cx, 3, cols[1]);
    A.hline(b, cx - 2, h + 1, 5, cols[2]);
    return b;
  }

  function pCrystal(P, rng, cols) {            // 晶簇：2~3 根带棱面的尖柱
    var w = 13 + ((rng.f() * 5) | 0);
    var h = 16 + ((rng.f() * 8) | 0);
    var b = A.buf(w, h + 3);
    var n = 2 + ((rng.f() * 2) | 0);
    for (var i = 0; i < n; i++) {
      var bx = 2 + ((rng.f() * (w - 6)) | 0);
      var bh = Math.round(h * (0.55 + rng.f() * 0.45));
      var bw = 4 + ((rng.f() * 2) | 0);
      for (var y = 0; y < bh; y++) {
        var t = y / bh;
        var shrink = t > 0.7 ? Math.round((t - 0.7) * bw * 2.2) : 0;
        var ww = Math.max(1, bw - shrink);
        var lx = bx + ((bw - ww) >> 1);
        A.fill(b, lx, h - y, ww, 1, y < bh * 0.25 ? cols[1] : cols[0]);
        if (ww > 1) A.set(b, lx, h - y, cols[2]);        // 左侧暗棱
      }
    }
    A.hline(b, 1, h + 1, w - 2, cols[2]);
    return b;
  }

  function pVine(P, rng, cols) {               // 垂落藤蔓：主蔓 + 明显的叶
    var len = 18 + ((rng.f() * 14) | 0);
    var b = A.buf(13, len);
    for (var y = 0; y < len; y++) {
      var xx = 6 + Math.round(Math.sin(y * 0.34) * 3);
      A.fill(b, xx, y, 2, 1, cols[0]);
      if (y % 6 === 2) { A.fill(b, xx + 2, y, 4, 2, cols[1]); A.set(b, xx + 2, y, cols[0]); }
      if (y % 6 === 5) { A.fill(b, xx - 4, y, 4, 2, cols[1]); A.set(b, xx - 2, y, cols[0]); }
    }
    return b;
  }

  function pLily(P, rng, cols) {               // 荷叶：圆盘 + 缺口 + 叶脉
    var w = 16 + ((rng.f() * 6) | 0);
    var b = A.buf(w, 9);
    var cx = w >> 1, cy = 4;
    for (var y = 0; y < 8; y++) {
      var t = y / 7;
      var half = Math.round((w / 2 - 1) * Math.sqrt(Math.max(0, 1 - Math.pow(t * 2 - 1, 2))));
      A.fill(b, cx - half, y, half * 2 + 1, 1, t < 0.4 ? cols[1] : cols[0]);
    }
    A.set(b, cx + 1, cy, 0);
    A.set(b, cx + 2, cy, 0);
    A.set(b, cx, cy, cols[2]);
    for (var k = 1; k <= 4; k++) A.set(b, cx - k, cy - (k >> 1), cols[2]);
    A.hline(b, 2, 8, w - 4, cols[2]);
    return b;
  }

  function pCoral(P, rng, cols) {              // 珊瑚丛：三根分叉的枝
    var w = 15 + ((rng.f() * 6) | 0);
    var h = 14 + ((rng.f() * 7) | 0);
    var b = A.buf(w, h + 3);
    for (var i = 0; i < 3; i++) {
      var bx = 3 + i * 4 + ((rng.f() * 2) | 0);
      var bh = Math.round(h * (0.6 + rng.f() * 0.4));
      for (var y = 0; y < bh; y++) {
        var xx = bx + Math.round(Math.sin(y * 0.5 + i * 2) * 1.5);
        A.set(b, xx, h - y, y > bh - 3 ? cols[1] : cols[0]);
        if (y === Math.round(bh * 0.55)) A.set(b, xx + 1, h - y, cols[1]);
      }
    }
    A.hline(b, 1, h + 1, w - 2, cols[2]);
    return b;
  }

  function pShell(P, rng, cols) {              // 贝壳：扇形 + 放射纹
    var w = 13 + ((rng.f() * 4) | 0);
    var b = A.buf(w, 10);
    var cx = w >> 1;
    for (var y = 0; y < 9; y++) {
      var t = y / 8;
      var half = Math.round(t * (w / 2 - 1));
      A.fill(b, cx - half, y, half * 2 + 1, 1, y < 2 ? cols[1] : cols[0]);
    }
    for (var i = -2; i <= 2; i++) {
      for (var s = 2; s < 9; s++) A.set(b, cx + Math.round(i * s * 0.32), s, cols[1]);
    }
    A.hline(b, 2, 9, w - 4, cols[2]);
    return b;
  }

  function pFlag(P, rng, cols) {               // 飘带旗
    var h = 20 + ((rng.f() * 10) | 0);
    var b = A.buf(16, h + 2);
    A.vline(b, 1, 1, h - 1, cols[2]);
    A.set(b, 1, 0, cols[1]);
    for (var y = 2; y < h - 5; y++) {
      var ww = 9 + Math.round(Math.sin(y * 0.55) * 3);
      A.fill(b, 2, y, ww, 1, ((y >> 1) & 1) ? cols[0] : cols[1]);
    }
    A.hline(b, 0, h, 5, cols[2]);
    return b;
  }

  function pPillar(P, rng, cols) {             // 石笋 / 水晶立柱
    var w = 12 + ((rng.f() * 7) | 0);
    var h = 18 + ((rng.f() * 16) | 0);
    var b = A.buf(w, h + 3);
    for (var y = 0; y < h; y++) {
      var t = y / h;
      var ww = Math.max(2, Math.round(w * (1 - t * 0.55)));
      var lx = (w - ww) >> 1;
      A.fill(b, lx, y, ww, 1, y < 3 ? cols[1] : cols[0]);
      A.set(b, lx, y, cols[2]);
    }
    A.hline(b, 1, h + 1, w - 2, cols[2]);
    return b;
  }

  function pRing(P, rng, cols) {               // 铜色机关环
    var w = 15 + ((rng.f() * 7) | 0);
    var b = A.buf(w, 9);
    A.ellipse(b, w >> 1, 4, (w >> 1) - 1, 3, cols[0]);
    A.ellipse(b, w >> 1, 4, (w >> 1) - 4, 1, 0);
    A.set(b, (w >> 1) - 2, 2, cols[1]);
    A.set(b, (w >> 1) + 2, 3, cols[1]);
    A.hline(b, 2, 8, w - 4, cols[1]);
    return b;
  }

  function pPuff(P, rng, cols) {               // 云絮 / 云块
    var w = 18 + ((rng.f() * 12) | 0);
    var b = A.buf(w, 12);
    A.ellipse(b, w >> 1, 7, (w >> 1) - 1, 4, cols[0]);
    A.ellipse(b, (w >> 1) - 4, 5, (w >> 2), 3, cols[1]);
    A.ellipse(b, (w >> 1) + 5, 6, (w >> 3) + 1, 3, cols[1]);
    A.dither(b, 1, 9, w - 2, 3, cols[2], 6);
    return b;
  }

  function pLog(P, rng, cols) {                // 倒伏树干：圆柱 + 端面年轮
    var w = 26 + ((rng.f() * 10) | 0);
    var h = 11 + ((rng.f() * 3) | 0);
    var b = A.buf(w, h + 3);
    var cy = (h - 1) / 2;
    for (var x = 0; x < w; x++) {
      var edge = Math.min(1, Math.min(x, w - 1 - x) / 3);
      var half = Math.round((h / 2 - 1) * (0.55 + 0.45 * edge));
      for (var y = 0; y < h; y++) {
        var d = Math.abs(y - cy);
        if (d <= half) A.set(b, x, y, d < half * 0.45 ? cols[1] : cols[0]);
      }
    }
    for (var i = 0; i < 5; i++) {
      var lx = 5 + ((rng.f() * (w - 12)) | 0);
      A.hline(b, lx, Math.round(cy) - 1, 4 + ((rng.f() * 4) | 0), cols[2]);
    }
    A.ellipse(b, w - 4, Math.round(cy), 3, 3, cols[2]);
    A.ellipse(b, w - 4, Math.round(cy), 1, 1, cols[1]);
    A.hline(b, 2, h + 1, w - 4, cols[3]);
    return b;
  }

  function pMural(P, rng, cols) {              // 星象壁画 / 符文砖
    var w = 18 + ((rng.f() * 8) | 0);
    var h = 14 + ((rng.f() * 6) | 0);
    var b = A.buf(w, h + 3);
    A.fill(b, 0, 0, w, h, cols[0]);
    A.rect(b, 0, 0, w, h, cols[1]);
    for (var i = 0; i < 4; i++) {
      A.set(b, 2 + ((rng.f() * (w - 4)) | 0), 2 + ((rng.f() * (h - 4)) | 0), cols[2]);
    }
    A.hline(b, 3, h >> 1, w - 6, cols[2]);
    A.hline(b, 2, h + 1, w - 4, cols[1]);
    return b;
  }

  // 每主题的装饰配方：8 类以上，各含 2~3 变体（§5.4）
  var PROP_SETS = {
    forest: [
      { fn: 'tuft', cols: [4, 3, 6], c: [1, 2, 3] },
      { fn: 'mushroom', cols: [4, 2, 9, 10], c: [1, 2, 3] },
      { fn: 'flower', cols: [0, 15, 5], c: [1, 2] },
      { fn: 'stone', cols: [11, 7, 12, 6], c: [1, 2, 3] },
      { fn: 'log', cols: [9, 8, 10, 6], c: [1, 2] },
      { fn: 'vine', cols: [5, 4], c: [1, 2, 3] },
      { fn: 'tuft', cols: [3, 2, 5], c: [1, 2] },
    ],
    amber: [
      { fn: 'crystal', cols: [8, 11, 4], c: [1, 2, 3] },
      { fn: 'pillar', cols: [5, 8, 4], c: [1, 2] },
      { fn: 'stone', cols: [6, 4, 7, 9], c: [1, 2, 3] },
      { fn: 'vine', cols: [8, 5], c: [1, 2] },
      { fn: 'flower', cols: [2, 11, 6], c: [1, 2] },
      { fn: 'crystal', cols: [11, 0, 5], c: [1, 2] },
      { fn: 'tuft', cols: [5, 6, 7], c: [1, 2] },
    ],
    cloud: [
      { fn: 'puff', cols: [0, 1, 2], c: [1, 2, 3] },
      { fn: 'flag', cols: [4, 8, 3], c: [1, 2] },
      { fn: 'flower', cols: [0, 8, 5], c: [1, 2] },
      { fn: 'stone', cols: [5, 6, 12, 3], c: [1, 2] },
      { fn: 'vine', cols: [2, 3], c: [1, 2] },
      { fn: 'puff', cols: [1, 2, 3], c: [1, 2] },
      { fn: 'tuft', cols: [2, 4, 6], c: [1, 2] },
    ],
    water: [
      { fn: 'lily', cols: [9, 8, 6], c: [1, 2, 3] },
      { fn: 'coral', cols: [9, 8, 6], c: [1, 2] },
      { fn: 'shell', cols: [2, 1, 4], c: [1, 2, 3] },
      { fn: 'flower', cols: [11, 1, 8], c: [1, 2] },
      { fn: 'stone', cols: [6, 4, 12, 10], c: [1, 2] },
      { fn: 'coral', cols: [8, 11, 6], c: [1, 2] },
      { fn: 'tuft', cols: [9, 8, 6], c: [1, 2] },
    ],
    star: [
      { fn: 'pillar', cols: [5, 2, 7], c: [1, 2, 3] },
      { fn: 'mural', cols: [6, 8, 0], c: [1, 2] },
      { fn: 'ring', cols: [8, 11], c: [1, 2, 3] },
      { fn: 'crystal', cols: [2, 0, 4], c: [1, 2] },
      { fn: 'stone', cols: [5, 6, 12, 8], c: [1, 2] },
      { fn: 'vine', cols: [11, 2], c: [1, 2] },
      { fn: 'flower', cols: [0, 8, 5], c: [1, 2] },
    ],
  };

  var propCache = new Map();
  function buildProp(themeKey, setIndex, variant) {
    var key = themeKey + ':' + setIndex + ':' + variant;
    var hit = propCache.get(key);
    if (hit) return hit;
    var P = CT.Palette.get(themeKey);
    var sets = PROP_SETS[themeKey];
    var spec = sets[setIndex % sets.length];
    var cols = spec.cols.map(function (i) { return P.c[i]; });
    var rng = new CT.Rng(CT.hash2(setIndex, variant, CT.seedOf('prop:' + themeKey)));
    var fn = PROPS[spec.fn];
    var b = fn(P, rng, cols);
    // 前景装饰统一加深色描边：地形本身也是同色系，没有描边装饰会糊进地面
    b = A.addOutline(b, P.c[14]);
    propCache.set(key, b);
    return b;
  }

  var PROPS = {
    tuft: pTuft, mushroom: pMushroom, stone: pStone, flower: pFlower,
    crystal: pCrystal, vine: pVine, lily: pLily, coral: pCoral,
    shell: pShell, flag: pFlag, pillar: pPillar, ring: pRing,
    puff: pPuff, log: pLog, mural: pMural,
  };

  function propSetCount(themeKey) { return PROP_SETS[themeKey].length; }

  // -------------------------------------------------------------- UI 面板
  // §7.5 单线像素边框，边框线宽 1 像素
  function buildPanel(w, h, P, accent) {
    var b = A.buf(w, h);
    A.fill(b, 0, 0, w, h, gc(G.PANEL));
    A.rect(b, 0, 0, w, h, gc(G.PANEL_HI));
    A.rect(b, 1, 1, w - 2, h - 2, gc(G.PANEL_LO));
    // 四角装饰角标
    var c = accent !== undefined ? accent : gc(G.ACCENT);
    A.set(b, 2, 2, c); A.set(b, 3, 2, c);
    A.set(b, w - 3, 2, c); A.set(b, w - 4, 2, c);
    A.set(b, 2, h - 3, c); A.set(b, 3, h - 3, c);
    A.set(b, w - 3, h - 3, c); A.set(b, w - 4, h - 3, c);
    return b;
  }

  CT.Sprites = {
    HERO_W: HERO_W, HERO_H: HERO_H,
    ANIM: ANIM,
    buildHero: buildHero,
    buildFootGlow: buildFootGlow,
    buildCrystal: buildCrystal,
    buildTreasure: buildTreasure,
    buildMark: buildMark,
    buildNpc: buildNpc,
    buildProp: buildProp,
    propSetCount: propSetCount,
    buildPanel: buildPanel,
    PROP_SETS: PROP_SETS,
    reset: function () { heroCache = {}; npcCache = {}; propCache.clear(); },
  };
})();
