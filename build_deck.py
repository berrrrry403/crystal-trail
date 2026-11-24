# -*- coding: utf-8 -*-
"""晶途拾光 — 作品说明（5 页）

设计取向：不用模板、不放图标、不堆居中大标题。
纸张底色 + 近黑文字 + 一个绿色主色和琥珀点缀，左对齐、留白多、句子短。
"""
import os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

ROOT = r"C:\Users\ASUS\Documents\deepseek-harness\default-workspace\crystal-trail"

# ------------------------------------------------------------------ 配色
PAPER = RGBColor(0xF7, 0xF5, 0xF0)     # 纸白
INK = RGBColor(0x1F, 0x23, 0x21)       # 近黑
MUTED = RGBColor(0x6B, 0x70, 0x69)     # 灰绿
LINE = RGBColor(0xD8, 0xD4, 0xC9)      # 分隔线
GREEN = RGBColor(0x33, 0x57, 0x4A)     # 主色：森林深绿
AMBER = RGBColor(0xB4, 0x7E, 0x36)     # 点缀：琥珀

YAHEI = "微软雅黑"
MONO = "Consolas"

W, H = Inches(13.333), Inches(7.5)
MARGIN = Inches(0.95)
CONTENT_W = W - MARGIN * 2


def set_cjk(run, name=YAHEI):
    """python-pptx 默认只设 latin 字体，中文要另外写 ea，否则回退到宋体。"""
    run.font.name = name
    rpr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rpr.find(
            "{http://schemas.openxmlformats.org/drawingml/2006/main}" + tag.split(":")[1]
        )
        if el is None:
            from lxml import etree
            el = etree.SubElement(
                rpr, "{http://schemas.openxmlformats.org/drawingml/2006/main}" + tag.split(":")[1]
            )
        el.set("typeface", name)


def textbox(slide, x, y, w, h):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    return tb, tf


def para(tf, text, size, color=INK, bold=False, font=YAHEI, space_before=0,
         space_after=0, line=None, first=False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.space_before = Pt(space_before)
    p.space_after = Pt(space_after)
    if line:
        p.line_spacing = line
    r = p.add_run()
    r.text = text
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.color.rgb = color
    set_cjk(r, font)
    return p


def rule(slide, x, y, w, color=LINE, thickness=Emu(9525)):
    """一条干净的发丝线。

    add_shape 会带上主题样式（渐变 + 立体效果），渲染出来像一条灰带子。
    这里把 <p:style> 整个摘掉，只留纯色填充和无线条。
    """
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.oxml.ns import qn
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, thickness)
    st = sh._element.find(qn("p:style"))
    if st is not None:
        sh._element.remove(st)
    sh.fill.solid()
    sh.fill.fore_color.rgb = color
    sh.line.fill.background()
    sh.shadow.inherit = False
    return sh


def new_slide(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = PAPER
    return s


def header(slide, kicker, title):
    """左上角一行小字 + 标题，标题下方一条细线。"""
    _, tf = textbox(slide, MARGIN, Inches(0.62), CONTENT_W, Inches(0.3))
    para(tf, kicker, 11, MUTED, font=MONO, first=True)
    _, tf2 = textbox(slide, MARGIN, Inches(0.92), CONTENT_W, Inches(0.66))
    para(tf2, title, 30, INK, bold=True, first=True)
    rule(slide, MARGIN, Inches(1.72), CONTENT_W)


def footer(slide, idx):
    _, tf = textbox(slide, MARGIN, H - Inches(0.62), Inches(6), Inches(0.3))
    para(tf, "晶途拾光 · 作品说明", 10, MUTED, font=MONO, first=True)
    _, tf2 = textbox(slide, W - MARGIN - Inches(1.2), H - Inches(0.62), Inches(1.2), Inches(0.3))
    p = para(tf2, "%02d / 05" % idx, 10, MUTED, font=MONO, first=True)
    p.alignment = PP_ALIGN.RIGHT


def rows(slide, items, top, key_w=Inches(2.55), gap=Inches(0.30),
         key_size=14, val_size=15):
    """左列关键词（等宽、灰），右列说明。不是卡片，就是两列字。"""
    y = top
    for key, val_lines in items:
        _, tk = textbox(slide, MARGIN, y, key_w - Inches(0.18), Inches(0.4))
        para(tk, key, key_size, GREEN, bold=True, font=MONO, first=True)
        _, tv = textbox(slide, MARGIN + key_w, y - Inches(0.02),
                        CONTENT_W - key_w, Inches(0.4))
        for i, ln in enumerate(val_lines):
            para(tv, ln, val_size, INK, first=(i == 0), line=1.35,
                 space_before=0 if i == 0 else 4)
        y += gap + Inches(0.22) * (len(val_lines) - 1)
    return y


# ================================================================== 建 deck
prs = Presentation()
prs.slide_width = W
prs.slide_height = H

# ---------------------------------------------------------------- 1 封面
s = new_slide(prs)
_, tf = textbox(s, MARGIN, Inches(2.05), CONTENT_W, Inches(0.34))
para(tf, "8-bit 像素解谜 · 单人 · 无战斗", 12, MUTED, font=MONO, first=True)

_, tf = textbox(s, MARGIN, Inches(2.48), CONTENT_W, Inches(1.0))
para(tf, "晶途拾光", 58, INK, bold=True, first=True)

_, tf = textbox(s, MARGIN, Inches(3.55), CONTENT_W, Inches(0.94))
para(tf, "走完五个主题、二十五关，把机关想明白。", 19, GREEN, first=True)
para(tf, "不会死，也不会打。掉进沟里扣一条命，站起来接着走。", 19, GREEN, space_before=6)

rule(s, MARGIN, Inches(4.82), CONTENT_W)

_, tf = textbox(s, MARGIN, Inches(5.06), Inches(5.4), Inches(1.2))
para(tf, "用途", 11, MUTED, font=MONO, first=True)
para(tf, "给人玩。不用打赢谁，也不用怕输，只想让人在解谜和收集里松一口气。",
     14, INK, space_before=6, line=1.4)

_, tf = textbox(s, MARGIN + Inches(6.4), Inches(5.06), Inches(5.0), Inches(1.2))
para(tf, "另一层", 11, MUTED, font=MONO, first=True)
para(tf, "给人看。一份能跑起来的交付物：规格里哪条做到、哪条改了，都写在附件报告里。",
     14, INK, space_before=6, line=1.4)

footer(s, 1)

# ---------------------------------------------------------------- 2 核心功能
s = new_slide(prs)
header(s, "02  FUNCTION", "核心功能")

rows(s, [
    ("25 关 / 5 主题", ["青藓初林、琥珀岩窟、云漫高台、碧泽水庭、星纹古殿，每关地形都不一样。"]),
    ("6 类机关", ["踩压开关、光路方块、时序踏板、风场、水位闸门、符文拼合，都要先想再做。"]),
    ("60 件宝物", ["拾遗宝物 60 件，加 5 枚本源彩晶、5 枚守护印记，收齐才算走完。"]),
    ("3 条命", ["掉坑、撞滚石各扣一条；复活是瞬时的，画面不会卡住。命用完本关重来，宝物保留。"]),
    ("中英双语", ["设置里随时切，存档各自记住；295 条文案、74 条界面全部翻译。"[:0] +
                 "设置里随时切，存档记住选择。英文版含 395 条文案与 74 条界面。"]),
    ("留影与故事", ["每枚彩晶解锁一张 192×128 插画，五张连起来是一条完整的故事线。"]),
], top=Inches(2.02), gap=Inches(0.62))
footer(s, 2)

# ---------------------------------------------------------------- 3 运行方式
s = new_slide(prs)
header(s, "03  HOW TO RUN", "运行方式")

_, tf = textbox(s, MARGIN, Inches(2.02), Inches(6.05), Inches(3.4))
para(tf, "① 直接双击", 17, GREEN, bold=True, first=True)
para(tf, "打开《晶途拾光.html》就行。922 KB 一个文件，不联网、不装东西、不用管理员。",
     14, INK, space_before=6, line=1.45)
para(tf, "档案里所有代码和图标都装在这一个文件里，所以发给别人也只是一个文件。",
     13, MUTED, space_before=4, line=1.4)

para(tf, "② 或者起个本地服务", 17, GREEN, bold=True, space_before=22)
para(tf, "node tools/serve.mjs   →   http://127.0.0.1:8777/", 14, INK, font=MONO,
     space_before=6)
para(tf, "存档走 localStorage。file:// 下多数浏览器也能存，起服务最稳。",
     13, MUTED, space_before=4, line=1.4)

_, tf = textbox(s, MARGIN + Inches(6.55), Inches(2.02), Inches(4.85), Inches(3.6))
para(tf, "操  作", 11, MUTED, font=MONO, first=True)
for k, v in [("← →  /  A D", "移动"), ("空格  /  W", "跳跃，按住跳得更高"),
             ("E  /  回车", "交互、翻页、确认"), ("↓", "从薄平台落下"),
             ("Esc", "暂停 / 返回"), ("F11", "全屏")]:
    p = tf.add_paragraph()
    p.space_before = Pt(7)
    r = p.add_run(); r.text = k
    r.font.size = Pt(13); r.font.color.rgb = GREEN; set_cjk(r, MONO)
    r2 = p.add_run(); r2.text = "    " + v
    r2.font.size = Pt(13); r2.font.color.rgb = INK; set_cjk(r2, YAHEI)

_, tf = textbox(s, MARGIN, Inches(4.92), CONTENT_W, Inches(1.2))
para(tf, "③ 想做在线链接", 17, GREEN, bold=True, first=True)
para(tf, "把这个 HTML 原样丢到任意静态托管就行，不用构建：GitHub Pages 改名 index.html，"
         "Netlify / Vercel 直接拖进去，对象存储设成 text/html。",
     14, INK, space_before=6, line=1.45)
footer(s, 3)

# ---------------------------------------------------------------- 4 必要环境
s = new_slide(prs)
header(s, "04  REQUIREMENTS", "必要环境")

rows(s, [
    ("浏览器", ["Chrome / Edge / Firefox / Safari 近年版本都行。桌面端最舒服。"]),
    ("手机", ["也能开，会自动出触屏控件；但关卡是按键鼠调的，手感一般。"]),
    ("安装", ["不需要。没有安装包，没有运行库，没有管理员权限，也不联网。"]),
    ("改代码", ["需要 Node（只用于构建和自检）。游戏本身零第三方依赖，28 个模块全是手写。"]),
    ("自检", ["PowerShell 跑 verify.ps1，16 步：关卡指标、文本、美术、行为、性能、真机浏览器。"]),
], top=Inches(2.02), gap=Inches(0.66))

_, tf = textbox(s, MARGIN, Inches(6.05), CONTENT_W, Inches(0.6))
para(tf, "一台 2019 年之后的普通电脑，打开就是满帧。", 13, MUTED, first=True)
footer(s, 4)

# ---------------------------------------------------------------- 5 已知问题
s = new_slide(prs)
header(s, "05  KNOWN ISSUES", "已知问题")

items = [
    ("没有安装包",
     "Windows 打包过一版（NSIS，77 MB，装完注册表和快捷方式都对），但这台机器的安全策略会拦"
     "大型未签名程序，装完打不开，所以不发布。网页版没有这个问题。"),
    ("存档绑浏览器",
     "进度存在 localStorage，换浏览器、换设备、清缓存都会丢。游戏里有 3 个手动槽 + 1 个自动槽，救不了跨浏览器。"),
    ("英文偏直译",
     "英文是后加的，个别句子读起来有点硬，不如中文自然。"),
    ("六项数值覆盖了规格书",
     "关卡长度 +40%、每关装饰 8→7、落差封顶 6 格、装饰只在站立时微动、新增生命值、每关换布局。"
     "都是后续提的要求，报告第五章逐条标了原条款和覆盖原因。"),
    ("引擎不是 Godot",
     "规格书指定 Godot 4，这里是自写的 HTML5 软件渲染器（480×270 帧缓冲、整数倍放大）。"
     "换来的是双击即玩，代价是没有 Godot 那套工具链。"),
    ("插画是程序画的",
     "五张图鉴插画由代码合成，不是手绘。远看有构图，近看不如美术画的细。"),
]

y = Inches(2.0)
for key, val in items:
    _, tk = textbox(s, MARGIN, y, Inches(2.55) - Inches(0.18), Inches(0.32))
    para(tk, key, 14, AMBER, bold=True, first=True)
    _, tv = textbox(s, MARGIN + Inches(2.55), y - Inches(0.03),
                    CONTENT_W - Inches(2.55), Inches(0.72))
    para(tv, val, 13, INK, first=True, line=1.34)
    y += Inches(0.80)

footer(s, 5)

# ================================================================== 保存
out = os.path.join(ROOT, "晶途拾光_作品说明.pptx")
prs.save(out)
print("saved:", out)
print("slides:", len(prs.slides.__iter__.__self__._sldIdLst))
