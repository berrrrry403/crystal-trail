# -*- coding: utf-8 -*-
"""《晶途拾光》AI 使用说明

一份用于说明「AI 参与了什么、人参与了什么」的书面材料。
写法上刻意避开宣传腔：只讲分工、技术路线和可复核的证据。
"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = r"C:\Users\ASUS\Documents\deepseek-harness\default-workspace\crystal-trail"
OUT = os.path.join(ROOT, "晶途拾光_AI使用说明.docx")

INK = RGBColor(0x1F, 0x23, 0x21)
GRAY = RGBColor(0x6B, 0x70, 0x69)
BODY_FONT = "宋体"
HEAD_FONT = "黑体"

doc = Document()

# ---------------------------------------------------------------- 页面
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.left_margin = Cm(2.6)
sec.right_margin = Cm(2.6)
sec.top_margin = Cm(2.4)
sec.bottom_margin = Cm(2.2)
CONTENT_W = Cm(21.0 - 5.2)

# ---------------------------------------------------------------- 正文样式
normal = doc.styles["Normal"]
normal.font.name = BODY_FONT
normal.font.size = Pt(10.5)
normal.font.color.rgb = INK
normal.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
normal.paragraph_format.line_spacing = 1.45
normal.paragraph_format.space_after = Pt(6)


def cn(text):
    """把成对的 ASCII 双引号转成中文引号“ ”，中文排版里直引号很扎眼。"""
    out = []
    opening = True
    for ch in text:
        if ch == '"':
            out.append("\u201c" if opening else "\u201d")
            opening = not opening
        else:
            out.append(ch)
    return "".join(out)


def set_font(run, name, size=None, bold=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def para(text="", size=10.5, bold=False, color=INK, font=BODY_FONT,
         before=0, after=6, indent=0, line=1.45, align=None):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if indent:
        pf.first_line_indent = Cm(indent)
    if align is not None:
        p.alignment = align
    if text:
        r = p.add_run(cn(text))
        set_font(r, font, size, bold, color)
    return p


def h1(text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(16)
    pf.space_after = Pt(7)
    pf.keep_with_next = True
    r = p.add_run(text)
    set_font(r, HEAD_FONT, 14.5, True, INK)
    # 标题下方一条细线
    pPr = p._element.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), "C9C5BA")
    borders.append(bottom)
    pPr.append(borders)
    return p


def h2(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_font(r, HEAD_FONT, 11.5, True, INK)
    return p


def bullet(text, size=10.5):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.4
    p.paragraph_format.left_indent = Cm(0.75)
    r = p.add_run(cn(text))
    set_font(r, BODY_FONT, size, False, INK)
    return p


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:fill"), hexcolor)
    tcPr.append(sh)


def table(headers, rows, widths, size=9.5, head_fill="EDEAE2"):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    hdr = t.rows[0].cells
    for i, htxt in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(3)
        r = p.add_run(cn(htxt))
        set_font(r, HEAD_FONT, size, True, INK)
        shade(hdr[i], head_fill)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.line_spacing = 1.3
            r = p.add_run(cn(val))
            set_font(r, BODY_FONT, size, False, INK)
    # 表头跨页重复 + 禁止单行被拆断，避免表头孤零零留在上一页
    trPr = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement("w:tblHeader")
    th.set(qn("w:val"), "true")
    trPr.append(th)
    for row in t.rows:
        rp = row._tr.get_or_add_trPr()
        cs = OxmlElement("w:cantSplit")
        cs.set(qn("w:val"), "true")
        rp.append(cs)
        for i, w in enumerate(widths):
            row.cells[i].width = w
    for i, w in enumerate(widths):
        t.columns[i].width = w
    return t


# ================================================================== 封面
p = para("", after=0)
p.paragraph_format.space_before = Pt(70)
para("AI 使用说明", 26, True, INK, HEAD_FONT, after=4)
para("项目：晶途拾光 — 8-bit 像素平台解谜游戏", 12, False, GRAY, BODY_FONT, after=2)
para("交付形态：单文件网页版（922 KB，双击即玩）", 12, False, GRAY, BODY_FONT, after=3)
import datetime
para(datetime.date.today().strftime("%Y 年 %m 月 %d 日"), 11, False, GRAY, BODY_FONT, after=40)

para("核心结论", 12, True, INK, HEAD_FONT, after=6)
para("代码实现全部交由 AI 完成；需求定义、验收判断、范围取舍与产品决策由本人完成。",
     11, False, INK, BODY_FONT, after=6, line=1.5)
para("AI 写代码、生成美术与音频、生成关卡数据、搭建自检流水线；本人提供规格书、"
     "规定优先级、逐张截图挑错、推翻不合理的设计条款，并在 AI 给出错误结论时叫停。",
     11, False, INK, BODY_FONT, after=0, line=1.5)

doc.add_page_break()

# ================================================================== 一、分工
h1("一、分工：哪些交给 AI，哪些没有")

para("下表是逐环节的实际分工，不是设想。每一项都能在交付物里找到对应的证据。")

table(
    ["环节", "承担者", "具体情况"],
    [
        ["需求来源", "本人", "提供《8-bit 像素游戏设计与开发规格书》，确定目标与优先级"],
        ["代码实现", "AI", "27 个手写模块、7693 行；渲染器、物理、关卡生成、界面、存档全部由 AI 编写"],
        ["美术素材", "AI", "瓦片、背景、角色、道具、图鉴插画全部程序化生成，零外部图片素材"],
        ["音频", "AI", "WebAudio 实时合成，2 脉冲 + 1 三角 + 1 噪声四个声道，零音频文件"],
        ["关卡数据", "AI", "25 关程序化生成，并逐关校验几何指标与连通性"],
        ["文案", "AI", "中文 401 条 / 3954 字；英文同结构翻译 401 条 / 9928 字符"],
        ["自检脚本", "AI", "34 个脚本，组成 16 步流水线"],
        ["验收判断", "本人", "逐张截图判断哪里不对、该不该改、改成什么样"],
        ["范围取舍", "本人", "决定砍掉安卓端；决定放弃安装包、改走单文件网页版"],
        ["文档要求", "本人", "要求说人话、不要 AI 腔；要求如实报告与规格书的偏差"],
    ],
    [Cm(2.6), Cm(1.9), Cm(11.3)],
)

para("")
para("需要说明的是：\"交给 AI 去做\"并不等于\"AI 说完成就完成\"。本项目的实际节奏是"
     "\"AI 实现 → 自检 → 本人用截图验收 → 打回重做\"，其中被本人打回的次数远多于一次通过。",
     after=4, line=1.5)

# ================================================================== 二、技术路线
h1("二、技术路线")

h2("2.1 为什么不是规格书指定的 Godot")
para("规格书 §9.1 指定 Godot 4。实际开发环境里没有 Godot，且安装所需的下载源不可达。"
     "在这种情况下有两个选择：停下来等环境，或者换一条能立刻跑起来的路。"
     "最终选择自写一个 HTML5 软件渲染器——换来的是双击即玩、无需安装，"
     "代价是没有 Godot 那套编辑器与工具链。这一点在符合性报告里如实标注为偏差，没有回避。")

h2("2.2 渲染：自己写的软件光栅化")
bullet("逻辑帧缓冲固定 480×270，用 Uint32Array 直接操作像素，颜色格式 0xAABBGGRR。")
bullet("所有绘制都是整数像素运算，放大时按整数倍最近邻复制，不做插值，保证边缘硬。")
bullet("渐变只用 4×4 Bayer 抖动实现，透明度只允许 0 / 128 / 255 三档，避免半透明糊边。")
bullet("每个主题严格 16 色，全局另有 32 色公共色板，色数是硬约束而不是事后检查。")
bullet("视口适配：先取能放下 480×270 的最大整数倍率，再把逻辑分辨率抬到刚好铺满窗口。"
       "所以窗口变大时是\"看得更远\"，不是\"拉伸变形\"，也不是\"上下加黑边\"。")

h2("2.3 主循环：逻辑与渲染解耦")
para("游戏逻辑固定 1/60 秒一步，用累加器驱动，与 requestAnimationFrame 完全解耦；"
     "渲染每帧一次，单帧超时按 0.25 秒封顶，避免切后台回来时物理\"瞬移\"。"
     "实测单帧耗时约 1.1 毫秒，预算 16.67 毫秒。")

h2("2.4 关卡：确定性生成 + 几何校验")
para("每个关卡由 \"level:关卡号\" 的字符串种子喂给 mulberry32，同一种子必然生成同一关，"
     "因此关卡数据可以离线产出、进版本库，也能被测试重复验证。")
para("生成器按分段拼装地形（起伏 / 多坑 / 阶梯 / 塔台四种风格，每关抽一种），"
     "再补机关、宝物、存档点与装饰，最后跑几何校验：最大缝隙、最大台阶、"
     "每屏装饰密度、垂直落差、连通性；不达标直接判构建失败。")

h2("2.5 美术与音频：不依赖任何外部素材")
para("瓦片按上下左右邻居的邻接掩码组合生成，再按深度分三类（草地 / 泥土 / 岩层）；"
     "角色是 16×24 的点阵，用 ASCII 字符块描述后组装；"
     "图鉴里的五张 192×128 插画由分层剪影加抖动合成。全部产物在运行时生成，"
     "仓库里没有一张位图，因此单文件 922 KB 就能装下整个游戏。")
para("音频同理：方波、三角波、噪声四条声道实时合成，没有 mp3 或 ogg，也没有加载延迟。")

h2("2.6 交付形态")
bullet("单文件 HTML：28 个模块全部内联，图标转 data URI，物理上不可能有外部请求。")
bullet("只用经典 <script>，不用 ES module、不用 fetch，所以 file:// 直接双击就能跑。")
bullet("同一份代码也能由本地静态服务托管，用于开发时边改边看。")

h2("2.7 自检：机器验证 + 真机验证")
para("自检分两层。第一层是无头 Node 沙箱，直接加载真实游戏代码跑逻辑，"
     "覆盖关卡指标、文本长度、美术色数、行为、性能、连通性；"
     "第二层是真实 Edge 浏览器，用 CDP 驱动真键盘真鼠标，验证启动、存档、"
     "按键位移、掉坑复活、布局等只有真浏览器才暴露的问题。目前 16 步全部通过。")

doc.add_page_break()

# ================================================================== 三、本人的作用
h1("三、本人在开发过程中的作用")

para("这一节按\"本人做了什么、以及它带来了什么改变\"来写，每条都对应一次实际的返工。")

h2("3.1 一开始就把标准定死")
para("启动时只给了一条硬要求：流畅度和画面精细\"两者都不可妥协\"。这条要求直接决定了"
     "后面很多技术选择——比如坚持整数倍缩放而不是随便拉伸、坚持程序化生成而不是贴图拼贴、"
     "坚持固定步长逻辑循环而不是跟着帧率走。没有这条约束，AI 很容易挑最省事的路。")

h2("3.2 验收：用截图挑出 AI 自己没测出来的问题")
para("AI 的自检只能验证它自己想到的东西。真正被找出来的缺陷，基本都是本人"
     "在玩、在看截图时发现的：")
table(
    ["本人发现的问题", "AI 原来的状态", "实际根因"],
    [
        ["掉进沟里卡住，不复活", "自测显示\"掉坑扣命\"通过", "把关卡下边界当成实心地板，人落在坑底永远到不了扣命判定线"],
        ["站着不动还在原地跺脚", "以为是待机动画在播", "重力每帧把身体压下 0.2 像素再弹回，落地判定每帧都触发，脚边尘土与落地音效连成一片"],
        ["路上物件认不出来、太杂乱", "装饰密度按规格书≥8 就\"达标\"", "装饰太小且过于密集，术语上达标、观感上不及格"],
        ["落差太高、每关布局雷同", "指标校验全绿", "落差 6~8 格封不住，生成器只有一种节奏"],
        ["右上角的图标看不懂", "没有任何说明系统", "界面元素缺少首次出现的解释"],
        ["界面整体偏左上、标题被切", "自检全部通过", "动态分辨率上线后，界面坐标仍按 480×270 写死"],
        ["画面留黑边", "规格书要求整数倍缩放+黑边", "需求方明确不要黑边，必须换成逻辑分辨率自适应"],
    ],
    [Cm(3.6), Cm(4.2), Cm(8.0)],
)
para("")
para("这七条里有五条是\"自检通过但观感不合格\"。它们的共同点是："
     "机器能验证的指标都对了，但人一眼就能看出不对。这正是本人必须留在验收环节的原因。",
     line=1.5)

h2("3.3 产品决策：主动推翻规格书")
para("规格书里有一批条款，做出来之后证明不适合这个项目。本人逐条判断并改掉，"
     "同时要求把这些改动如实记录在符合性报告里，而不是悄悄改数字：")
table(
    ["推翻了什么", "原条款", "改成什么"],
    [
        ["无生命值", "§1.4 / §12：全程无生命值、无死亡惩罚", "一局 3 条命，掉坑与撞滚石各扣 1 条，复活不冻结画面"],
        ["关卡长度", "§5.3：120~180 格", "+40%，实际 166~259 格"],
        ["装饰密度", "§5.4：每屏 ≥8 个", "降到 7 个，宁少不杂"],
        ["垂直落差", "至少 1 处 ≥6 格", "统一封顶 6 格，不再出现整屏高墙"],
        ["装饰微动", "前景 1 像素微动", "只在主角站定时微动，移动中完全不动，避免晃眼"],
        ["布局结构", "未规定", "每关抽一种结构（起伏/多坑/阶梯/塔台）"],
    ],
    [Cm(2.8), Cm(5.6), Cm(7.4)],
)
para("")
para("这些是需求变更，不是实现偏差。所以报告里保留原条款、标注\"已覆盖\"并写明原因，"
     "而不是把原文改成\"已满足\"。", line=1.5)

h2("3.4 范围控制：知道什么时候停")
para("项目中期尝试过做安装包。Windows 版打出来了（NSIS，77 MB，能装能卸、"
     "快捷方式和注册表都正确），但装完打不开——这台机器的安全策略会拦截大型未签名程序。"
     "在这种情况下的判断是：不再纠缠安装包，先把\"能被别人玩到\"这件事用网页版解决。"
     "随后安卓端也被明确砍掉，只做 Windows 验证。"
     "控制范围的收益是直接的：省下的时间用来把画面、手感和文档做完。")

h2("3.5 对交付质量的要求")
bullet("要求\"先在网页端跑\"，不接受只靠无头测试就宣称完成。")
bullet("要求整体如实报告与规格书的偏差，包括做不到的部分。")
bullet("要求文档\"说人话\"，不要典型的 AI 腔调与模板化表达。")
bullet("要求单文件版能被别人直接双击打开、能发出去，而不是只有本机能跑。")

# ================================================================== 四、AI 的局限
h1("四、AI 的局限：两处它自己的测试没能发现问题")

h2("4.1 测试替玩家绕过了最坏情况")
para("AI 写过一个\"掉坑必扣命\"的测试，但它把主角的纵坐标直接设到判定线之外，"
     "等于跳过了\"真的从坑口掉下去\"这个过程。于是测试一路绿灯，"
     "而实际问题——人落在坑底、被隐形地板接住、永远不复活——完全没被覆盖。"
     "这个问题是本人截图发现的，之后才改成\"从真实坑口把主角丢进去\"的测法。")

h2("4.2 自我验证的边界设得太窄")
para("安装包的验证只到\"能安装、能卸载、注册表和快捷方式正确\"，"
     "没有覆盖\"装完能不能打开\"。AI 当时据此判断安装包可用，"
     "而实际双击立刻退出。这说明自动化的\"我认为完成了\"和\"它真的能用\"之间还有距离。")

para("")
para("这两条都指向同一个结论：AI 适合承担实现，不适合独自担任验收。"
     "验收需要在真实设备上、以使用者的眼光去看，这是目前必须由人来做的一环。",
     line=1.5)

# ================================================================== 五、使用方式
h1("五、使用方式与可复核性")

h2("5.1 迭代方式")
para("整个项目的节奏是固定的四步循环：")
para("提出需求 → AI 实现并自检 → 本人在浏览器里实际玩、看截图 → 指出问题、打回重做。", 11, False, INK,
     BODY_FONT, before=2, after=8, indent=0, align=WD_ALIGN_PARAGRAPH.CENTER)
para("需求通常是一句话加一张截图（\"这个状态就应该复活了\"、\"角色不动的时候不要一直跺脚\"），"
     "AI 负责定位根因、改代码、补回归测试，本人负责确认改对了没有。")

h2("5.2 哪些环节 AI 可以独立完成")
bullet("明确的实现任务：给定行为描述，写代码、补测试、跑自检。")
bullet("机械性重构与批量替换：坐标系统改造、多语言接入、命名统一。")
bullet("文档与报告的初稿，以及数据统计、格式校验。")
bullet("代码审阅与自我诊断：AI 能提出假设并写验证脚本去证实或推翻它。")

h2("5.3 哪些环节必须由人决策")
bullet("产品方向与优先级：做不做安装包、要不要安卓端、先解决哪个问题。")
bullet("观感判断：好不好看、乱不乱、手感对不对——这类没有指标可依。")
bullet("推翻既定条款：规格书写了什么，不等于就应该照做。")
bullet("最终验收：在真实设备上、以使用者身份确认\"它真的能用\"。")

doc.add_page_break()
h2("5.4 可复核的证据")
para("项目根目录的 verify.ps1 是 16 步全量自检，一条命令即可复跑；"
     "所有自动检查的结构化结果、逐页截图、逐关数据都随包提供：")
table(
    ["证据", "位置", "内容"],
    [
        ["全量自检", "verify.ps1", "16 步：关卡指标、文本、美术色数、行为、性能、连通性、真机浏览器"],
        ["功能自检", "build/features-report.json", "18 项，覆盖取名、静音、语言切换、教程、图鉴插画"],
        ["真机浏览器", "build/browser-report.json", "15 项，真实 Edge + CDP 驱动"],
        ["截图证据", "build/qa/", "美术、界面、菜单、图鉴、标题页等逐项截图"],
        ["偏差记录", "晶途拾光_实现说明与规格符合性报告.docx", "与规格书逐条对照，含六项需求覆盖"],
    ],
    [Cm(2.6), Cm(5.4), Cm(7.8)],
)

# ================================================================== 六、数字
h1("六、关键数字")

table(
    ["项目", "数值"],
    [
        ["手写源码", "27 个模块，7693 行"],
        ["构建与自检脚本", "34 个"],
        ["关卡", "25 关（5 主题 × 5 关）"],
        ["文本", "中文 401 条 / 3954 字；英文 401 条 / 9928 字符"],
        ["可收集物", "拾遗宝物 60 件、本源彩晶 5 枚、守护印记 5 枚"],
        ["美术", "全部程序化生成，零外部图片素材"],
        ["音频", "WebAudio 实时合成，零音频文件"],
        ["单帧耗时", "约 1.1 ms（预算 16.67 ms）"],
        ["自检", "16 步全量流水线，当前全部通过"],
        ["交付体积", "单文件 922 KB；完整包 2.68 MB"],
    ],
    [Cm(4.6), Cm(11.2)],
)

para("")
para("说明：以上数字均由脚本从实际交付物中统计得出，可用 verify.ps1 复跑核对。",
     9.5, False, GRAY, BODY_FONT, before=4)

doc.save(OUT)
print("saved:", OUT)
print("paragraphs:", len(doc.paragraphs), "tables:", len(doc.tables))
