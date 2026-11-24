/* 晶途拾光 — RNG / hash utilities
 * Deterministic PRNG so that level generation and art baking are reproducible
 * across sessions and in the headless QA renderer.
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  // mulberry32 — fast, decent distribution, deterministic from a 32-bit seed.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Stateless integer hash — used for per-tile art variation so that the same
  // tile coordinate always renders identically without storing anything.
  function hash2(x, y, seed) {
    var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function hash01(x, y, seed) {
    return hash2(x, y, seed) / 4294967296;
  }

  // String -> 32-bit seed (FNV-1a)
  function seedOf(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function Rng(seed) {
    this.next = mulberry32(seed >>> 0);
  }
  Rng.prototype.f = function () { return this.next(); };
  Rng.prototype.range = function (a, b) { return a + this.next() * (b - a); };
  Rng.prototype.int = function (a, b) { return a + Math.floor(this.next() * (b - a + 1)); };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  Rng.prototype.chance = function (p) { return this.next() < p; };
  Rng.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  CT.mulberry32 = mulberry32;
  CT.hash2 = hash2;
  CT.hash01 = hash01;
  CT.seedOf = seedOf;
  CT.Rng = Rng;
})();
