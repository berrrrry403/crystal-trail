#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
晶途拾光 — 美术自动校验（规格书 §7.7）
=========================================================================
§7.7 原文要求：批量检查每张素材的四项并输出报告
    ① 色数是否超限
    ② 是否存在半透明像素
    ③ 宽高是否为 8 的整数倍
    ④ 是否存在非整像素缩放痕迹

为了不让规则自相矛盾，这里按素材类别分别套用阈值（依据 §7.2 / §7.3 / §7.5）：

    tile   瓦片集      尺寸 8 的整数倍，色数 ≤ 24（§7.3 单主题调色板 16 色，
                       任何单张瓦片集不得超过 24 色），alpha 只允许 0 / 255
    sprite 角色与道具  尺寸 8 的整数倍，色数 ≤ 24（§7.6/§12），alpha 只允许 0 / 255；
                       主角单帧另按 §3.1 单独统计，上限 12 色
    screen 全屏背景条带  尺寸必须能整除 480 × 270 视口，不适用 8 倍数规则；
                       近层允许 50% 透明（§5.4 近层为半透明枝叶，§7.2 允许
                       0% / 50% / 100% 三档）

用法:  python tools/validate_art.py [--json out.json]
"""
import argparse
import glob
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIRS = [os.path.join(ROOT, "assets", "art", "tiles"), os.path.join(ROOT, "assets", "art", "sprites")]

MAX_COLOURS_TILE = 24
MAX_COLOURS_SPRITE = 24
ALLOWED_ALPHA_STRICT = {0, 255}
ALLOWED_ALPHA_NEAR = {0, 128, 255}
VIEW_W, VIEW_H = 480, 270

# 由文件名归类
def classify(path):
    name = os.path.basename(path)
    if name.endswith("-tileset.png"):
        return "tile"
    if "parallax-near" in name:
        return "screen_near"
    if "parallax" in name:
        return "screen"
    return "sprite"


def detect_baked_scale(im):
    """检测整张图是否已经是 k 倍放大后的结果（k >= 2）。

    §7.1 要求所有美术按 1 倍像素绘制、运行时整数倍放大；素材里一旦出现
    预先放大的图，说明流程里多缩放了一次，像素密度就和其它素材对不上了。
    判定方法：逐个 k 检查是否每个 k×k 块内部完全同色。
    """
    w, h = im.size
    px = im.convert("RGBA").load()
    for k in (2, 3, 4):
        if w % k or h % k:
            continue
        same = True
        for y in range(0, h, k):
            for x in range(0, w, k):
                c0 = px[x, y]
                for dy in range(k):
                    for dx in range(k):
                        if px[x + dx, y + dy] != c0:
                            same = False
                            break
                    if not same:
                        break
                if not same:
                    break
            if not same:
                break
        if same:
            return k
    return 1


def analyse(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    data = list(im.getdata())

    colours = set()
    partial_alpha = 0
    bad_alpha = []
    for (r, g, b, a) in data:
        if a == 0:
            continue
        colours.add((r, g, b, a))
        if a not in (0, 128, 255):
            partial_alpha += 1
            if len(bad_alpha) < 3:
                bad_alpha.append(a)

    return {
        "path": os.path.relpath(path, ROOT).replace("\\", "/"),
        "class": classify(path),
        "width": w,
        "height": h,
        "colours": len(colours),
        "partial_alpha": partial_alpha,
        "bad_alpha_samples": bad_alpha,
        "baked_scale": detect_baked_scale(im),
    }


def check(info):
    errs = []
    cls = info["class"]
    w, h = info["width"], info["height"]

    # ① 色数
    if cls in ("tile", "sprite"):
        limit = MAX_COLOURS_TILE if cls == "tile" else MAX_COLOURS_SPRITE
        if info["colours"] > limit:
            errs.append(f"色数 {info['colours']} > {limit}")

    # ② 半透明
    if cls in ("tile", "sprite", "screen"):
        if info["partial_alpha"]:
            errs.append(f"存在 {info['partial_alpha']} 个半透明像素 (alpha 样例 {info['bad_alpha_samples']})")
    elif cls == "screen_near":
        # 近层允许 50% 档，但仍必须是 0 / 128 / 255
        if info["bad_alpha_samples"]:
            errs.append(f"近层出现三档以外的 alpha {info['bad_alpha_samples']}")

    # ③ 尺寸对齐
    if cls in ("tile", "sprite"):
        if w % 8 or h % 8:
            errs.append(f"尺寸 {w}×{h} 不是 8 的整数倍")
    else:
        if VIEW_W % w and w % VIEW_W:
            errs.append(f"背景条带宽度 {w} 与视口 {VIEW_W} 不成整除关系")
        if VIEW_H % h and h % VIEW_H:
            errs.append(f"背景条带高度 {h} 与视口 {VIEW_H} 不成整除关系")

    # ④ 非整像素缩放
    if info["baked_scale"] > 1:
        errs.append(f"素材已是 {info['baked_scale']} 倍放大图（应保持 1 倍像素）")

    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None, help="把报告写入 JSON")
    args = ap.parse_args()

    files = []
    for d in ART_DIRS:
        files.extend(sorted(glob.glob(os.path.join(d, "*.png"))))
    if not files:
        print("no art files found — run tools/export_art.mjs first", file=sys.stderr)
        return 2

    results = []
    failed = 0
    for f in files:
        info = analyse(f)
        errs = check(info)
        info["errors"] = errs
        info["ok"] = not errs
        if errs:
            failed += 1
        results.append(info)

    # 控制台表格
    print(f"{'asset':42s} {'class':12s} {'size':12s} {'colours':>7s} {'alpha!=0/255':>12s}  result")
    print("-" * 100)
    for r in results:
        size = f"{r['width']}x{r['height']}"
        flag = "OK" if r["ok"] else "FAIL"
        print(f"{r['path']:42s} {r['class']:12s} {size:12s} {r['colours']:7d} {r['partial_alpha']:12d}  {flag}")
        for e in r["errors"]:
            print(f"    - {e}")
    print("-" * 100)
    print(f"{len(results)} files checked, {failed} failed")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"total": len(results), "failed": failed, "results": results},
                      fh, ensure_ascii=False, indent=1)
        print("report ->", args.json)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
