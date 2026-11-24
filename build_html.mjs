// Generates index.html from manifest.json so the <script> order can never drift
// from what the headless QA harness loads.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = manifest.files.filter((f) => fs.existsSync(path.join(ROOT, f)));

const tags = files.map((f) => `  <script src="${f}"></script>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#0e1022">
<meta name="description" content="晶途拾光 — 8-bit 像素平台解谜游戏。安静地探索彩晶大陆，把机关想明白，把宝物收齐。">
<link rel="icon" href="favicon.ico" sizes="16x16 32x32">
<title>晶途拾光 · Crystal Trail</title>
<style>
  /* §7.1 整数倍缩放；§7.6 禁止抗锯齿与模糊
     铺满策略：逻辑分辨率随窗口放大 + 整数倍缩放，故不再需要黑边补齐 */
  html, body {
    margin: 0; padding: 0; height: 100%; overflow: hidden;
    background: #0a0c14;
    -webkit-user-select: none; user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: none;
  }
  #stage {
    position: fixed; inset: 0;
    overflow: hidden;
  }
  #screen {
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
    display: block;
    position: absolute;
    left: 0; top: 0;
    background: #0a0c14;
    outline: none;
  }
  #boot {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    color: #8b96b4; font: 13px/1.6 ui-monospace, Consolas, monospace;
    background: #0a0c14; text-align: center; padding: 24px;
  }
  #boot.hidden { display: none; }
</style>
</head>
<body>
<div id="stage"><canvas id="screen" width="1440" height="810"></canvas></div>
<div id="boot">正在装载点阵字库与瓦片…</div>
<script>
  window.addEventListener('error', function (e) {
    var b = document.getElementById('boot');
    if (b) { b.classList.remove('hidden'); b.textContent = '启动失败：' + (e.message || e.error); }
  });
</script>
${tags}
<script>
  window.addEventListener('load', function () {
    var b = document.getElementById('boot');
    if (b) b.classList.add('hidden');
    var c = document.getElementById('screen');
    if (c) c.focus();
  });
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`wrote index.html with ${files.length} scripts`);
