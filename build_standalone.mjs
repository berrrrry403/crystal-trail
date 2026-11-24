// 把网页版打成单个自包含 HTML 文件
// ---------------------------------------------------------------------------
// 产物特点：
//   · 一个 .html 文件，双击就能玩，不需要服务器、不需要联网、不需要安装
//   · 所有 JS 内联，图标内联成 data URI，没有任何外部请求
//   · 仍然是经典 <script>（不是 ES module），所以 file:// 下不会被 CORS 拦
//
// 这个文件可以直接发邮件、放网盘、丢进 GitHub Pages / Netlify / 任意静态空间。
import { ROOT } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const srcHtml = path.join(ROOT, 'index.html');
let html = fs.readFileSync(srcHtml, 'utf8');

// ---------------------------------------------------------------- 图标
const icoPath = path.join(ROOT, 'favicon.ico');
if (fs.existsSync(icoPath)) {
  const b64 = fs.readFileSync(icoPath).toString('base64');
  html = html.replace(
    /<link rel="icon"[^>]*>/i,
    `<link rel="icon" type="image/x-icon" href="data:image/x-icon;base64,${b64}">`,
  );
}

// ---------------------------------------------------------------- 内联脚本
let inlined = 0;
let totalBytes = 0;
const misses = [];

html = html.replace(
  /<script src="([^"]+)"><\/script>/g,
  (_m, rel) => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
      misses.push(rel);
      return `<!-- MISSING ${rel} -->`;
    }
    let code = fs.readFileSync(p, 'utf8');
    // 内联脚本里不能出现 </script>，否则会提前闭合标签
    if (/<\/script/i.test(code)) {
      throw new Error(`${rel} 含有 </script，无法安全内联`);
    }
    // 源文件里的 //# sourceMappingURL 之类在单文件里没有意义，去掉
    code = code.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
    inlined++;
    totalBytes += Buffer.byteLength(code);
    return `<script>\n/* ==== ${rel} ==== */\n${code}\n</script>`;
  },
);

if (misses.length) {
  console.error('缺少脚本：', misses.join(', '));
  process.exit(1);
}

// ---------------------------------------------------------------- 标题与注释
html = html.replace(
  /<!doctype html>/i,
  `<!doctype html>
<!--
  晶途拾光 / Crystal Trail — 单文件网页版
  ------------------------------------------------------------------
  这个文件是自包含的：所有代码与图标都内联在里面，没有任何外部请求。
  双击用浏览器打开即可游玩，支持 file:// 直接运行；也可以原样上传到
  任意静态空间（GitHub Pages / Netlify / 对象存储）作为在线版。
  进度保存在浏览器 localStorage 里。
-->`,
);

// ---------------------------------------------------------------- 输出
const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, '晶途拾光.html');
fs.writeFileSync(outPath, html, 'utf8');

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`单文件网页版 -> ${outPath}`);
console.log(`  内联脚本 ${inlined} 个，合计 ${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`  成品大小 ${kb} KB`);

// ---------------------------------------------------------------- 自检
const checks = [
  ['无外部 script src', !/<script\s+src=/i.test(html)],
  ['无 fetch(', !/\bfetch\s*\(/.test(html)],
  ['无 type="module"', !/type=["']module["']/i.test(html)],
  ['图标已内联', /href="data:image\/x-icon/.test(html)],
  ['无 http(s) 外链引用', !/(src|href)=["']https?:/i.test(html)],
];
let bad = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}`);
  if (!ok) bad++;
}
if (bad) {
  console.error(`自检未通过：${bad} 项`);
  process.exitCode = 1;
}

fs.writeFileSync(path.join(ROOT, 'build', 'standalone-report.json'),
  JSON.stringify({ file: outPath, bytes: Buffer.byteLength(html), scripts: inlined,
    checks: checks.map(([n, ok]) => ({ name: n, ok })) }, null, 1));
