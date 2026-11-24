/* 晶途拾光 — 音频
 * --------------------------------------------------------------------------
 * §8.1 音乐采用 FC 时代的 chiptune 写法：以方波（2 路）、三角波（1 路）、
 *      噪声（1 路）四个声道构成，旋律舒缓、留白多，不使用厚重鼓组与失真音色。
 * §8.3 音效共 14 类，单条时长均不超过 0.8 秒。
 * §8.5 Android 端响应系统音量；BGM 与 SFX 音量分别可调，默认 BGM 70%、SFX 80%。
 *
 * 音频完全用 WebAudio 现场合成，不依赖任何音频文件，因此包体里没有一份
 * OGG 资源 —— 这是「包体上限」与「离线可玩」两项要求下最稳的做法。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function midi(name) {
    // "C5" / "D#4"
    var m = /^([A-G])(#?)(-?\d)$/.exec(name);
    if (!m) return 0;
    var semi = NOTE[m[1]] + (m[2] ? 1 : 0);
    var oct = parseInt(m[3], 10);
    return (oct + 1) * 12 + semi;
  }
  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // 每个主题一首主旋律，其余曲目都是它的变奏（§8.1）
  // 记谱：[音名, 时长(16 分音符)]，0 音名表示休止
  var TRACKS = {
    forest: {
      tempo: 104,
      lead: [
        ['E5', 6], ['G5', 2], ['A5', 4], ['G5', 4],
        ['E5', 6], ['D5', 2], ['C5', 8],
        ['D5', 4], ['E5', 4], ['G5', 6], ['E5', 2],
        ['D5', 4], ['C5', 4], ['A4', 8],
        ['C5', 4], ['D5', 4], ['E5', 4], ['G5', 4],
        ['A5', 6], ['G5', 2], ['E5', 8],
      ],
      bass: [
        ['C3', 8], ['G2', 8], ['A2', 8], ['E2', 8],
        ['F2', 8], ['C3', 8], ['G2', 8], ['C3', 8],
      ],
      harm: [
        ['G4', 8], ['E4', 8], ['C4', 8], ['G3', 8],
      ],
    },
    amber: {
      tempo: 92,
      lead: [
        ['A4', 4], ['C5', 4], ['D5', 8],
        ['C5', 4], ['A4', 4], ['G4', 8],
        ['F4', 4], ['G4', 4], ['A4', 4], ['C5', 4],
        ['D5', 8], ['C5', 8],
        ['A4', 6], ['G4', 2], ['F4', 8],
      ],
      bass: [
        ['D3', 8], ['A2', 8], ['F2', 8], ['C3', 8],
        ['D3', 8], ['A2', 8],
      ],
      harm: [
        ['F4', 8], ['D4', 8], ['A3', 8], ['C4', 8],
      ],
    },
    cloud: {
      tempo: 118,
      lead: [
        ['G5', 4], ['E5', 4], ['D5', 4], ['E5', 4],
        ['G5', 6], ['A5', 2], ['G5', 8],
        ['E5', 4], ['D5', 4], ['C5', 8],
        ['D5', 4], ['E5', 4], ['G5', 8],
        ['A5', 4], ['G5', 4], ['E5', 8],
      ],
      bass: [
        ['C3', 4], ['G2', 4], ['C3', 4], ['G2', 4],
        ['A2', 8], ['F2', 8], ['C3', 8], ['G2', 8],
      ],
      harm: [
        ['E4', 4], ['G4', 4], ['C5', 4], ['G4', 4],
        ['A4', 8], ['F4', 8],
      ],
    },
    water: {
      tempo: 88,
      lead: [
        ['D5', 6], ['F5', 2], ['A5', 4], ['F5', 4],
        ['D5', 8], ['C5', 8],
        ['A4', 6], ['C5', 2], ['D5', 8],
        ['F5', 6], ['E5', 2], ['D5', 8],
      ],
      bass: [
        ['D3', 8], ['A2', 8], ['F2', 8], ['C3', 8],
        ['D3', 8], ['A2', 8],
      ],
      harm: [
        ['A4', 8], ['F4', 8], ['D4', 8], ['A3', 8],
      ],
    },
    star: {
      tempo: 76,
      lead: [
        ['A5', 4], ['G5', 4], ['E5', 4], ['D5', 4],
        ['E5', 8], ['A4', 8],
        ['C5', 4], ['D5', 4], ['E5', 4], ['G5', 4],
        ['A5', 16],
      ],
      bass: [
        ['A2', 8], ['E2', 8], ['F2', 8], ['C3', 8],
        ['A2', 16],
      ],
      harm: [
        ['E4', 8], ['C4', 8], ['A3', 8], ['E3', 8],
      ],
    },
  };

  function Audio() {
    this.ok = false;
    this.ctx = null;
    this.started = false;
    this.bgmName = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.master = null;
    this.tracks = null;
    this.pos = { lead: 0, bass: 0, harm: 0, noise: 0 };
    this.nextTime = 0;
    this.volume = { bgm: 70, sfx: 80 };
    this.muted = false;
    this.muteBgm = false;          // 单独关掉音乐
    this.muteSfx = false;          // 单独关掉音效
    this.paused = false;
    this._noiseBuf = null;
  }

  Audio.prototype.init = function () {
    if (this.ok || this._failed) return this.ok;
    var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) { this._failed = true; return false; }
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = this.volume.bgm / 100;
      this.bgmGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.volume.sfx / 100;
      this.sfxGain.connect(this.master);
      this._makeNoise();
      this.ok = true;
    } catch (e) {
      this._failed = true;
      this.ok = false;
    }
    return this.ok;
  };

  Audio.prototype._makeNoise = function () {
    var len = Math.floor(this.ctx.sampleRate * 0.5);
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    // 噪声声道用确定性 LCG，避免每次启动听感不一致
    var s = 0x2f6e2b1;
    for (var i = 0; i < len; i++) {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      d[i] = ((s / 0x3fffffff) - 1) * 0.6;
    }
    this._noiseBuf = buf;
  };

  Audio.prototype.resume = function () {
    if (!this.ok) this.init();
    if (!this.ok) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.started = true;
    return true;
  };

  // 统一把「总开关 + 分声道开关 + 音量」算成增益
  Audio.prototype.applyGains = function () {
    if (!this.ok) return;
    var b = (this.muted || this.muteBgm) ? 0 : Math.max(0, Math.min(1, this.volume.bgm / 100));
    var s = (this.muted || this.muteSfx) ? 0 : Math.max(0, Math.min(1, this.volume.sfx / 100));
    this.bgmGain.gain.value = b;
    this.sfxGain.gain.value = s;
  };

  Audio.prototype.setVolumes = function (bgm, sfx) {
    this.volume.bgm = bgm; this.volume.sfx = sfx;
    this.applyGains();
  };

  /**
   * setMuted(true)              全体静音（旧用法）
   * setMuted('bgm'|'sfx', bool) 只关某一档
   */
  Audio.prototype.setMuted = function (which, m) {
    if (m === undefined) { this.muted = !!which; this.applyGains(); return; }
    if (which === 'bgm') this.muteBgm = !!m;
    else if (which === 'sfx') this.muteSfx = !!m;
    this.applyGains();
  };

  // ------------------------------------------------------------- 单音
  Audio.prototype._pulse = function (t, dur, f, gain, dest, duty) {
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = 'square';
    // pulse 的占空比用 detune 近似不成立，这里用两个方波叠加模拟窄脉冲
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.setValueAtTime(gain * 0.8, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(dest || this.bgmGain);
    o.start(t); o.stop(t + dur + 0.02);
    if (duty) {
      var o2 = this.ctx.createOscillator();
      var g2 = this.ctx.createGain();
      o2.type = 'square';
      o2.frequency.value = f;
      o2.detune.value = 6;
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(gain * 0.35, t + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o2.connect(g2); g2.connect(dest || this.bgmGain);
      o2.start(t); o2.stop(t + dur + 0.02);
    }
  };

  Audio.prototype._triangle = function (t, dur, f, gain, dest) {
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain * 0.9, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(dest || this.bgmGain);
    o.start(t); o.stop(t + dur + 0.02);
  };

  Audio.prototype._noise = function (t, dur, gain, hp, dest) {
    if (!this._noiseBuf) return;
    var s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    var g = this.ctx.createGain();
    var f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp || 1200;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.bgmGain);
    s.start(t); s.stop(t + dur + 0.02);
  };

  // ------------------------------------------------------------- BGM
  Audio.prototype.playBgm = function (name) {
    if (!this.ok) this.init();
    if (!this.ok) return;
    if (this.bgmName === name) return;
    this.bgmName = name;
    var tr = TRACKS[name] || TRACKS.forest;
    this.tracks = tr;
    this.pos.lead = 0; this.pos.bass = 0; this.pos.harm = 0; this.pos.noise = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.sixteenth = 60 / (tr.tempo * 4);
  };

  Audio.prototype.stopBgm = function () { this.bgmName = null; };

  // 每帧调用：提前 0.2 秒排程，保证节拍不被帧抖动影响
  Audio.prototype.tick = function () {
    if (!this.ok || !this.bgmName || this.paused) return;
    var look = 0.2;
    var now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + 0.02;
    var t = this.tracks, p = this.pos, s16 = this.sixteenth;
    var guard = 0;
    while (this.nextTime < now + look && guard++ < 64) {
      // lead
      var n = t.lead[p.lead % t.lead.length];
      var dur = n[1] * s16;
      if (n[0]) this._pulse(this.nextTime, dur * 0.92, freq(midi(n[0])), 0.10, this.bgmGain, true);
      // bass（三角波）
      var bn = t.bass[p.bass % t.bass.length];
      if (bn) this._triangle(this.nextTime, bn[1] * s16 * 0.95, freq(midi(bn[0])), 0.13, this.bgmGain);
      // harm（第二方波，稀疏点缀）
      var hn = t.harm[p.harm % t.harm.length];
      if (hn && (p.lead % 4 === 0)) this._pulse(this.nextTime, hn[1] * s16 * 0.5, freq(midi(hn[0])), 0.035, this.bgmGain, false);
      // 噪声：极轻的踩点，每 2 个 16 分一次
      if (p.noise % 2 === 0) this._noise(this.nextTime, 0.05, 0.018, 3200, this.bgmGain);

      this.nextTime += dur;
      p.lead++; p.bass++; p.harm++; p.noise++;
      // bass 用更长的音符，按自身时长推进
    }
  };

  // ------------------------------------------------------------- SFX
  // §8.3 音效共 14 类，单条不超过 0.8 秒
  var SFX = {
    jump:        { wave: 'pulse', f0: 330, f1: 620, dur: 0.12, gain: 0.12 },
    land:        { wave: 'noise', f0: 500, f1: 120, dur: 0.08, gain: 0.09 },
    reset:       { wave: 'pulse', f0: 420, f1: 150, dur: 0.28, gain: 0.10 },
    pickup:      { wave: 'arp', dur: 0.30, gain: 0.11 },
    dialogue:    { wave: 'pulse', f0: 880, f1: 880, dur: 0.03, gain: 0.05 },
    celebrate:   { wave: 'arp', dur: 0.60, gain: 0.12 },
    switch_down: { wave: 'pulse', f0: 220, f1: 180, dur: 0.10, gain: 0.11 },
    stone_door:  { wave: 'noise', f0: 900, f1: 260, dur: 0.42, gain: 0.10 },
    beam_align:  { wave: 'pulse', f0: 660, f1: 990, dur: 0.16, gain: 0.09 },
    pad_ok:      { wave: 'pulse', f0: 520, f1: 780, dur: 0.12, gain: 0.10 },
    pad_bad:     { wave: 'pulse', f0: 240, f1: 150, dur: 0.16, gain: 0.09 },
    water_gate:  { wave: 'noise', f0: 1400, f1: 400, dur: 0.50, gain: 0.08 },
    rune_merge:  { wave: 'arp', dur: 0.70, gain: 0.12 },
    cursor:      { wave: 'pulse', f0: 620, f1: 620, dur: 0.04, gain: 0.06 },
    confirm:     { wave: 'pulse', f0: 780, f1: 1040, dur: 0.10, gain: 0.09 },
    back:        { wave: 'pulse', f0: 420, f1: 300, dur: 0.09, gain: 0.08 },
    save_ok:     { wave: 'arp', dur: 0.40, gain: 0.10 },
    page:        { wave: 'noise', f0: 2600, f1: 1200, dur: 0.06, gain: 0.05 },
  };

  Audio.prototype.sfx = function (name) {
    if (!this.ok) return;
    var d = SFX[name];
    if (!d) return;
    var t = this.ctx.currentTime + 0.001;
    var out = this.sfxGain;
    if (d.wave === 'noise') {
      this._noise(t, Math.min(0.8, d.dur), d.gain, d.f0, out);
    } else if (d.wave === 'arp') {
      // 上行五音（§4.2 拾取表现：局部像素闪光 + 短促拾取音）
      var steps = [0, 4, 7, 11, 12];
      var base = 523.25;
      var each = d.dur / steps.length;
      for (var i = 0; i < steps.length; i++) {
        this._pulse(t + i * each, each * 1.6, base * Math.pow(2, steps[i] / 12), d.gain, out, i === 0);
      }
    } else {
      var o = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(d.f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, d.f1), t + d.dur);
      g.gain.setValueAtTime(d.gain, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + Math.min(0.8, d.dur));
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + Math.min(0.8, d.dur) + 0.02);
    }
  };

  Audio.TRACKS = TRACKS;
  CT.Audio = Audio;
})();
