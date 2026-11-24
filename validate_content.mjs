// Validator for data/text/content.json against §6.4 length & tone rules.
// Exits non-zero on any violation so it can gate the build.
import { loadPartial, ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const CT = loadPartial(['src/core/rng.js', 'src/core/fb.js', 'src/art/palette.js',
  'src/generated/font.js', 'src/art/font.js']);

const file = path.join(ROOT, 'data', 'text', 'content.json');
const raw = fs.readFileSync(file, 'utf8');
let D;
try { D = JSON.parse(raw); } catch (e) { fail(['JSON parse error: ' + e.message]); }

const errs = [];
function fail(list) { console.error('FAIL\n' + list.map(s => '  - ' + s).join('\n')); process.exit(1); }
function need(cond, msg) { if (!cond) errs.push(msg); }

// §6.4 禁用词（含 §2.3 压迫性词汇与套话）
const BANNED = ['勇士', '冒险者', '命运', '使命', '传说', '英雄', '诅咒', '毁灭', '吞噬',
  '深渊', '恐怖', '血腥', '死亡', '牺牲', '末日', '宿命', '奇迹', '震撼', '极致', '颠覆',
  '蜕变', '毁灭', '诅咒'];

const THEMES = ['forest', 'amber', 'cloud', 'water', 'star'];
const MECHS = ['pressure_switch', 'light_beam', 'sequence_pads', 'wind', 'water_flow', 'rune_puzzle'];

function len(s) { return [...s].length; }

function checkText(where, s, min, max) {
  if (typeof s !== 'string') { errs.push(`${where}: not a string`); return; }
  const n = len(s);
  if (min !== null && n < min) errs.push(`${where}: too short (${n} < ${min})   "${s}"`);
  if (max !== null && n > max) errs.push(`${where}: too long (${n} > ${max})   "${s}"`);
  if (s !== s.trim()) errs.push(`${where}: leading/trailing whitespace`);
  if (s.includes('!') || s.includes('！')) errs.push(`${where}: exclamation mark forbidden   "${s}"`);
  if (/[A-Za-z0-9]/.test(s)) errs.push(`${where}: ASCII letters/digits forbidden   "${s}"`);
  for (const w of BANNED) if (s.includes(w)) errs.push(`${where}: banned word "${w}"   "${s}"`);
  // 字体覆盖（等价于「可用 GB2312 常用字」）
  for (const ch of s) {
    if (ch === ' ' || ch === '\n') continue;
    if (!CT.Font.hasGlyph(ch)) errs.push(`${where}: char not in font/GB2312 "${ch}"   "${s}"`);
  }
  // 命令式快速筛查（"快去/你要/请你/务必/应该"）
  for (const w of ['快去', '请你', '务必', '应该去', '你必须', '得要']) {
    if (s.includes(w)) errs.push(`${where}: imperative tone "${w}"   "${s}"`);
  }
}

// ---------- crystals
need(Array.isArray(D.crystals) && D.crystals.length === 5, `crystals must be 5, got ${D.crystals?.length}`);
const CRYSTAL_NAMES = { 'crystal-forest': '翠源晶', 'crystal-amber': '暖珀晶', 'crystal-cloud': '流云晶', 'crystal-water': '澜光晶', 'crystal-star': '星核晶' };
for (const c of D.crystals || []) {
  need(CRYSTAL_NAMES[c.id] === c.name, `crystal ${c.id} name should be ${CRYSTAL_NAMES[c.id]}, got ${c.name}`);
  checkText(`crystal ${c.id}.desc`, c.desc, 8, 12);
}

// ---------- marks
need(Array.isArray(D.marks) && D.marks.length === 5, `marks must be 5, got ${D.marks?.length}`);
for (const m of D.marks || []) {
  checkText(`mark ${m.id}.name`, m.name, 4, 6);
  checkText(`mark ${m.id}.desc`, m.desc, 8, 12);
  need(THEMES.includes(m.theme), `mark ${m.id}: bad theme ${m.theme}`);
}

// ---------- intros / blessings
need(D.intros?.length === 5, `intros must be 5, got ${D.intros?.length}`);
for (const it of D.intros || []) {
  checkText(`intro ${it.theme}`, it.intro, 60, 100);
  need(it.npc === '云絮信使', `intro ${it.theme}: npc must be 云絮信使`);
}
need(D.blessings?.length === 5, `blessings must be 5, got ${D.blessings?.length}`);
for (const b of D.blessings || []) checkText(`blessing ${b.theme}`, b.blessing, null, 40);

// ---------- treasures (60, 2/2/2/3/3 per theme)
const wantLevels = { '01': 2, '02': 2, '03': 2, '04': 3, '05': 3 };
need(D.treasures?.length === 60, `treasures must be 60, got ${D.treasures?.length}`);
const names = new Set();
const ids = new Set();
for (const t of D.treasures || []) {
  checkText(`treasure ${t.id}.name`, t.name, 4, 6);
  checkText(`treasure ${t.id}.desc`, t.desc, 8, 12);
  checkText(`treasure ${t.id}.place`, t.place, 4, 8);
  need(!names.has(t.name), `treasure name duplicated: ${t.name}`);
  need(!ids.has(t.id), `treasure id duplicated: ${t.id}`);
  names.add(t.name); ids.add(t.id);
  need(t.kind === 'side', `treasure ${t.id}: kind must be side`);
  const m = /^(forest|amber|cloud|water|star)-(\d\d)-t\d$/.exec(t.id);
  need(!!m, `treasure ${t.id}: id pattern`);
  if (m) need(m[1] === t.theme && `${m[1]}-${m[2]}` === t.level, `treasure ${t.id}: theme/level mismatch`);
}
for (const th of THEMES) {
  for (const lv of Object.keys(wantLevels)) {
    const got = (D.treasures || []).filter(t => t.level === `${th}-${lv}`).length;
    need(got === wantLevels[lv], `${th}-${lv}: expected ${wantLevels[lv]} treasures, got ${got}`);
  }
}

// ---------- npc dialogue
need(D.npcDialogue?.length === 10, `npcDialogue must be 10, got ${D.npcDialogue?.length}`);
for (const d of D.npcDialogue || []) {
  need(d.rounds?.length === 3, `${d.theme}/${d.npc}: rounds must be 3`);
  (d.rounds || []).forEach((r, i) => {
    need(r.lines?.length >= 1 && r.lines.length <= 2, `${d.theme}/${d.npc} round${i}: lines must be 1-2`);
    (r.lines || []).forEach((ln, j) => checkText(`${d.theme}/${d.npc} r${i}l${j}`, ln, 12, 18));
  });
}

// ---------- hints
need(D.hints?.length === 6, `hints must be 6, got ${D.hints?.length}`);
for (const h of D.hints || []) {
  need(MECHS.includes(h.mech), `hint mech unknown: ${h.mech}`);
  need(h.levels?.length === 3, `hint ${h.mech}: levels must be 3`);
  (h.levels || []).forEach((s, i) => checkText(`hint ${h.mech} L${i + 1}`, s, null, 20));
}
for (const m of MECHS) need((D.hints || []).some(h => h.mech === m), `hint missing for mech ${m}`);

// ---------- glossary：每个首次出现的图标都要有一句说明
const GLOSSARY_KEYS = ['hud_treasure', 'treasure', 'crystal', 'mark', 'rune', 'checkpoint',
  'exit', 'door', 'boulder', 'pressure_switch', 'light_beam', 'sequence_pads',
  'wind', 'water_flow', 'rune_altar', 'npc'];
need(Array.isArray(D.glossary), 'glossary missing');
for (const g of D.glossary || []) {
  checkText(`glossary ${g.key}.name`, g.name, 2, 6);
  checkText(`glossary ${g.key}.desc`, g.desc, 6, 18);
}
for (const k of GLOSSARY_KEYS) {
  need((D.glossary || []).some(g => g.key === k), `glossary missing entry: ${k}`);
}

if (errs.length) fail(errs);

// 长度分布统计，便于人工复核
const stats = {
  treasures: D.treasures.length,
  uniqueNames: names.size,
  introRange: [Math.min(...D.intros.map(i => len(i.intro))), Math.max(...D.intros.map(i => len(i.intro)))],
  blessingRange: [Math.min(...D.blessings.map(b => len(b.blessing))), Math.max(...D.blessings.map(b => len(b.blessing)))],
  npcLineRange: (() => { const a = D.npcDialogue.flatMap(d => d.rounds.flatMap(r => r.lines.map(len))); return [Math.min(...a), Math.max(...a)]; })(),
  hintRange: (() => { const a = D.hints.flatMap(h => h.levels.map(len)); return [Math.min(...a), Math.max(...a)]; })(),
};
console.log('content.json OK');
console.log(JSON.stringify(stats, null, 2));
