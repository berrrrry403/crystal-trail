/* 晶途拾光 — 文本输入
 * --------------------------------------------------------------------------
 * canvas 里没法直接调出中文输入法，所以这里挂一个不可见的 <input>：
 * 玩家在浏览器里按正常方式打字（含中文输入法），内容实时同步回游戏，
 * 游戏只负责把它画到点阵字上。
 *
 * 无 DOM 环境（无头自检）下自动退化为「键盘逐字输入 ASCII」，
 * 保证同一套游戏逻辑在两种环境里都能跑。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var MAX_LEN = 10;
  var el = null;              // 隐藏的 input
  var onChange = null;        // 内容变化回调
  var asciiFallback = '';     // 无 DOM 时的缓冲
  var enabled = false;

  function hasDom() {
    return typeof document !== 'undefined' && document.createElement &&
           typeof document.body !== 'undefined' && document.body;
  }

  function ensureElement() {
    if (el || !hasDom()) return el;
    try {
      el = document.createElement('input');
      el.type = 'text';
      el.maxLength = MAX_LEN;
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('spellcheck', 'false');
      // 放到屏幕外，但保持可聚焦 —— display:none 的 input 无法唤起输入法
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '0';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.opacity = '0';
      el.style.border = '0';
      el.style.padding = '0';
      el.style.background = 'transparent';
      el.style.color = 'transparent';
      el.style.fontSize = '16px';   // 避免移动端聚焦时页面缩放
      el.addEventListener('input', function () {
        var v = el.value || '';
        if (v.length > MAX_LEN) { v = v.slice(0, MAX_LEN); el.value = v; }
        if (onChange) onChange(v);
      });
      el.addEventListener('keydown', function (e) {
        // 阻止空格/方向键冒泡出去触发游戏操作
        if (e.key === ' ' || e.key.indexOf('Arrow') === 0) e.stopPropagation();
      });
      document.body.appendChild(el);
    } catch (e) {
      el = null;
    }
    return el;
  }

  function open(initial, changeCb) {
    onChange = changeCb || null;
    enabled = true;
    asciiFallback = initial || '';
    var e = ensureElement();
    if (e) {
      e.value = initial || '';
      try { e.focus(); e.select(); } catch (err) { /* 忽略 */ }
    }
  }

  function close() {
    enabled = false;
    if (el) {
      try { el.blur(); } catch (e) { /* 忽略 */ }
      el.value = '';
    }
    onChange = null;
  }

  function value() {
    if (el) return el.value || '';
    return asciiFallback;
  }

  function setValue(v) {
    v = (v || '').slice(0, MAX_LEN);
    if (el) {
      el.value = v;
      if (onChange) onChange(v);
    } else {
      asciiFallback = v;
      if (onChange) onChange(v);
    }
    return v;
  }

  // 无 DOM 时的兜底：把可打印 ASCII 追加进缓冲
  function feedKeyCode(code, key) {
    if (el) return false;            // 有 input 时交给它自己处理
    if (!enabled) return false;
    if (code === 'Backspace') {
      asciiFallback = asciiFallback.slice(0, -1);
      if (onChange) onChange(asciiFallback);
      return true;
    }
    if (key && key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) < 127) {
      if (asciiFallback.length < MAX_LEN) {
        asciiFallback += key;
        if (onChange) onChange(asciiFallback);
      }
      return true;
    }
    return false;
  }

  CT.TextInput = {
    MAX_LEN: MAX_LEN,
    open: open,
    close: close,
    value: value,
    setValue: setValue,
    feedKeyCode: feedKeyCode,
    get active() { return enabled; },
    get domAvailable() { return !!ensureElement(); },
  };
})();
