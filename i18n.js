/* 晶途拾光 — 多语言
 * --------------------------------------------------------------------------
 * 分两层处理：
 *
 * 1) 叙事文本（宝物、对话、提示、图鉴、故事）体量大，放在
 *    data/text/content.json 与 content.en.json 两份 JSON 里，运行时整表切换，
 *    通过 CT.DATA.content 换引用，其余代码不用改。
 *
 * 2) 界面文案（按钮、标题、HUD）原本是散落在绘制函数里的中文短句。
 *    这里采用「以中文字面量本身为键」的查表方式：代码里写
 *
 *        CT.I18N.T('开始新的旅程')
 *
 *    切到英文时返回对应的英文，切回中文时原样返回。这样不用给几十条
 *    短句各起一个键名，也避免了「改了字面量忘了改表」的漂移。
 */
(function () {
  'use strict';
  var CT = (window.CT = window.CT || {});

  var LANGS = ['zh', 'en'];
  var LANG_NAMES = { zh: '中文', en: 'English' };

  // 界面文案：中文 -> 英文
  var EN = {
    // 主角与 NPC 名字
    '林间萤灵': 'Grove Wisp',
    '石苔长老': 'Stone Elder',
    '云絮信使': 'Cloud Courier',
    '河蚌灵': 'Clam Spirit',
    '苔痕向导': 'Moss Guide',
    '旅伴': 'Companion',

    // 对话
    '这一带的路径还算清楚。': 'The path here is still easy to follow.',
    '走累了就在石碑旁边停一停。': 'Rest by the stone when you tire.',

    // 顶部提示
    '力气用尽 · 本关重新开始': 'Out of strength - restarting this level',
    '提示': 'Hint',
    '拾得 ': 'Found ',
    '宝物': 'treasure',
    '获得 ': 'Got ',
    '本源彩晶': 'Prism Shard',
    '守护印记': 'Guardian Mark',
    '拾得符文碎片': 'Picked up a rune piece',
    '已在石碑旁留下记号': 'Marked the stone',
    '进度已记录': 'Progress saved',
    '符文拼合完成': 'Runes assembled',
    '还缺 ': 'Still missing ',
    ' 块符文碎片': ' rune pieces',
    '符文已经拼好了': 'The runes are already set',

    // HUD
    '晶 ': 'Shard ',

    // 标题页
    '晶途拾光': 'Crystal Trail',
    '开始新的旅程': 'New Journey',
    '继续旅程': 'Continue',
    '图鉴': 'Codex',
    '设置': 'Settings',
    '方向键选择 · 空格或 E 确认': 'Arrows to choose - Space or E to confirm',
    '全程无战斗 · 无死亡惩罚': 'No combat - no death penalty',

    // 存档位
    '选择存档位': 'Choose a slot',
    '存档 ': 'Slot ',
    '自动存档': 'Auto save',
    '未知': 'Unknown',
    '收集 ': 'Collected ',
    '空存档': 'Empty',
    '空格 / E 确认 · Esc 返回': 'Space / E confirm - Esc back',

    // 暂停
    '暂停': 'Paused',
    '继续': 'Resume',
    '返回标题': 'Title screen',
    '收集完成度 ': 'Collected ',

    // 图鉴
    '尚未寻得': 'Not found yet',
    '%   ←→ 翻页  Esc 返回': '%   left/right to page - Esc back',
    '←→ 翻页 · Esc 返回': 'left/right to page - Esc back',
    'Esc 返回': 'Esc to go back',
    '共 ': 'Total ',

    // 设置
    '音乐音量': 'Music volume',
    '音效音量': 'Sound volume',
    '关闭音乐': 'Music off',
    '关闭音效': 'Sound off',
    '触屏布局': 'Touch layout',
    '语言': 'Language',
    '返回': 'Back',
    '←→ 调整 · Esc 返回': 'left/right adjust - Esc back',
    '开': 'On',
    '关': 'Off',

    // 结算
    '关卡完成': 'Level clear',
    '空格继续': 'Space to continue',
    '空格查看结局': 'Space for the ending',
    '旅途的尽头': "The Journey's End",
    '五枚本源彩晶回到了它们该在的位置。': 'The five shards are back where they belong.',
    '大陆的光重新连成一条线。': 'The light of the continent joins into one line.',
    '拾光者把旧布包放下，坐在殿门口。': 'The Lightgatherer sets the satchel down and sits at the hall gate.',
    '前面的路还有很长。': 'The road ahead is still long.',
    '空格返回标题': 'Space to return to title',

    // 触屏控件
    '标准': 'Standard',
    '紧凑': 'Compact',
    '左手': 'Left-handed',
    '跳': 'Jump',
    '交': 'Use',

    // 图鉴画廊 / 故事
    '旅途留影': 'Travel Album',
    '完整的故事': 'The Full Story',
    '集齐五枚彩晶': 'Collect all five shards',
    '故事才会讲完': 'and the story will be told',
    '取得本源彩晶后解锁': 'Unlocks with a Prism Shard',
    '？？？': '???',

    // 教程
    '按 ← → 向右走': 'Press Left / Right to walk',
    '按空格跳一下': 'Press Space to jump',
    '按住空格能跳得更高': 'Hold Space to jump higher',
    '教程结束，慢慢走': 'Tutorial done - take your time',

    // 名字输入
    '给拾光者起个名字': 'Name the Lightgatherer',
    '直接敲键盘输入 · 回车确定': 'Type on the keyboard - Enter to confirm',
    '随机': 'Random',
    '就这样': 'Done',
    '还没有名字': 'No name yet',
  };

  var lang = 'zh';

  function T(zhLiteral) {
    if (lang === 'zh') return zhLiteral;
    var v = EN[zhLiteral];
    return v === undefined ? zhLiteral : v;
  }

  // 取当前语言的叙事文本块
  function content() {
    var d = CT.DATA;
    if (!d) return null;
    if (d.text && d.text[lang]) return d.text[lang];
    return d.content || null;          // 兼容构建期只注入 content 的情形
  }

  function setLang(next) {
    if (LANGS.indexOf(next) < 0) next = 'zh';
    lang = next;
    if (CT.DATA) {
      if (CT.DATA.text && CT.DATA.text[lang]) CT.DATA.content = CT.DATA.text[lang];
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    }
    // 字体：英文用 8×8 拉丁点阵，中文用 12×12。切换后行高与折行都要跟着变。
    if (CT.Font && CT.Font.setLang) CT.Font.setLang(lang);
    return lang;
  }

  // 带占位符的拼接：T('拾得 ') 这类前后缀在英文里要用空格分开
  function join(prefix, value) {
    if (lang === 'zh') return prefix + value;
    var a = T(prefix);
    return a + value;
  }

  CT.I18N = {
    T: T,
    join: join,
    content: content,
    setLang: setLang,
    get lang() { return lang; },
    LANGS: LANGS,
    LANG_NAMES: LANG_NAMES,
    EN: EN,
    // 供自检使用：英文表是否覆盖了代码里出现的全部字面量
    has: function (lit) { return Object.prototype.hasOwnProperty.call(EN, lit); },
  };
})();
