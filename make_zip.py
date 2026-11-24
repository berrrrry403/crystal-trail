# -*- coding: utf-8 -*-
"""把整个项目打成一个 zip。

排除三类东西：
  1. 依赖与构建产物（desktop/node_modules、dist/win-unpacked）
  2. 明确不可用的产物（那个装完打不开的 Windows 安装包）
  3. 我跑浏览器自检时留下的 Edge 用户目录缓存（build/browser-profile）

其余全部收进来，并在压缩包根目录写一份清单。
"""
import os
import io
import zipfile
import datetime

ROOT = r"C:\Users\ASUS\Documents\deepseek-harness\default-workspace\crystal-trail"
OUT = r"C:\Users\ASUS\Documents\deepseek-harness\default-workspace\晶途拾光_完整包.zip"
TOP = "晶途拾光"

# 目录前缀排除
EXCLUDE_DIRS = [
    "desktop/node_modules",
    "desktop/node_modules/.pnpm",
    "dist/win-unpacked",
    "build/browser-profile",
    "build/serve.pid",
]
# 具体文件排除
EXCLUDE_FILES = [
    "dist/CrystalTrail-Setup-1.0.0.exe",
    "dist/builder-debug.yml",
    "build/serve.log",
    "build/serve.err.log",
]


def rel(p):
    return os.path.relpath(p, ROOT).replace("\\", "/")


def excluded(relpath):
    base = relpath.split("/")[-1]
    # Office 的 ~$ 开头是打开文件时生成的锁文件，不该进包
    if base.startswith("~$") or base.endswith(".tmp"):
        return True
    for d in EXCLUDE_DIRS:
        if relpath == d or relpath.startswith(d + "/"):
            return True
    for f in EXCLUDE_FILES:
        if relpath == f:
            return True
    return False


files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if not excluded(rel(os.path.join(dirpath, d)))]
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        r = rel(full)
        if excluded(r):
            continue
        files.append(full)

files.sort(key=lambda p: rel(p))

total_raw = sum(os.path.getsize(f) for f in files)

manifest = io.StringIO()
manifest.write("晶途拾光 / Crystal Trail —— 完整包内容清单\n")
manifest.write("=" * 60 + "\n\n")
manifest.write("打包时间：%s\n" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
manifest.write("文件数：%d   解开后约 %.1f MB\n\n" % (len(files), total_raw / 1024 / 1024))
manifest.write("【想直接玩】\n")
manifest.write("  dist/晶途拾光.html      双击这个文件，浏览器打开就能玩\n")
manifest.write("  dist/使用说明.txt       键位、分享方式、存档说明\n\n")
manifest.write("【文档】\n")
manifest.write("  晶途拾光_作品说明.pptx                  5 页，用途/功能/运行/环境/问题\n")
manifest.write("  晶途拾光_实现说明与规格符合性报告.docx   与规格书逐条对照，含偏差记录\n")
manifest.write("  README.md                              技术说明与自检说明\n\n")
manifest.write("【源码】\n")
manifest.write("  src/          28 个手写模块（渲染器、关卡生成、美术生成、音频合成）\n")
manifest.write("  data/         25 关关卡数据、中英文案\n")
manifest.write("  tools/        构建与自检脚本\n")
manifest.write("  index.html    多文件版入口（配合本地服务用）\n")
manifest.write("  verify.ps1    16 步全量自检\n\n")
manifest.write("【自检证据】\n")
manifest.write("  build/qa/           美术、界面、浏览器验证的截图\n")
manifest.write("  build/deck-preview/ PPT 每页渲染图\n")
manifest.write("  build/*.json        各项自检的结构化结果\n\n")
manifest.write("【未包含 / 为什么】\n")
manifest.write("  desktop/node_modules        551 MB，Electron 与打包工具，可用 pnpm install 复原\n")
manifest.write("  dist/win-unpacked           268 MB，Electron 应用解包目录，可重新构建\n")
manifest.write("  dist/CrystalTrail-Setup-1.0.0.exe\n")
manifest.write("      77 MB。这个安装包能装、能卸、快捷方式和注册表都对，但在一台\n")
manifest.write("      机器上装完打不开（安全策略拦大型未签名程序），因此不作为交付物。\n")
manifest.write("      网页版不受影响。桌面端的源码留在 desktop/ 里，工具链齐了可以重打。\n")
manifest.write("  build/browser-profile       40 MB，浏览器自检时产生的 Edge 用户目录缓存\n")

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr("%s/打包清单.txt" % TOP, manifest.getvalue().encode("utf-8-sig"))
    for f in files:
        z.write(f, "%s/%s" % (TOP, rel(f)))

size = os.path.getsize(OUT)
print("输出：%s" % OUT)
print("文件数：%d" % (len(files) + 1))
print("原始体积：%.1f MB" % (total_raw / 1024 / 1024))
print("压缩后：%.2f MB" % (size / 1024 / 1024))
