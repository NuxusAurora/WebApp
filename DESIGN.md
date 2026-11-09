---
name: 学习工作台 · 深蓝索引
description: 以课程目录和稳定详情区组织个人教材、目标与资料。
colors:
  ink: "#24354a"
  ink-strong: "#1b2b40"
  muted: "#536a83"
  surface: "#ffffff"
  ground: "#edf3f9"
  line: "#d8e2ed"
  accent: "#2869b0"
  accent-strong: "#1e5592"
  accent-soft: "#eaf2fc"
  rail: "#152d4b"
  rail-muted: "#b3c5d9"
  rail-current: "#294867"
  success: "#256b53"
  success-bg: "#edf6f1"
  danger: "#a03831"
  danger-bg: "#fff2ef"
  toast-bg: "#e8f5bc"
  toast-ink: "#344717"
typography:
  title:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "22.5px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12.6px"
    fontWeight: 400
    lineHeight: 1.6
  metadata:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "10.8px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "8px"
  panel: "12px"
  bubble: "18px"
spacing:
  unit: "8px"
  group: "16px"
  section: "24px"
  page: "24px"
  wide-page: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#37516d"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  navigation:
    backgroundColor: "{colors.rail-current}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  status:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
    padding: "3px 8px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "20px"
  toast-success:
    backgroundColor: "{colors.toast-bg}"
    textColor: "{colors.toast-ink}"
    rounded: "{rounded.bubble}"
    padding: "10px 12px 10px 16px"
---

## Overview

用户在方向页选择“深蓝索引”。工作台借用分类标识的清晰阅读轴：左侧定位、中部选课、右侧处理信息。设计服务于课程和资料管理；课程内容、真实状态与明确操作构成界面，不制造学习进度或尚未接入的 AI 结果。

## Colors

深蓝导航区与浅蓝工作区建立全局层级，白色面板承载内容。行动蓝用于主操作、选中与焦点；绿色只表示学习中或成功，红色用于危险操作和错误。辅助文字使用带蓝色相的 muted。普通与占位文字至少 4.5:1，大字至少 3:1；禁用控件保持可识别状态。

通过 prefers-color-scheme 自动跟随系统深浅色，不提供独立偏好状态。用户以截图指定炭灰背景：工作区 #181818、导航 #191c1e、内容面 #222222、输入框 #363636，控件辅助底为中性灰，边界 #858585；主背景、导航和输入底色取自用户参考图。按用户后续要求，深色标题、正文、说明、占位、导航、链接、状态与按钮文字统一 #ffffff，以字号、字重和间距保持层级。焦点保留 #8dbbff，主按钮底 #2869b0、危险按钮底 #a03831，成功气泡底 #425b25，均使用白字并满足对比度。浅色成功气泡仍为 #e8f5bc/#344717。完整深色 token 在 globals.css 媒体查询及 sidecar 中维护。

## Typography

使用系统中文无衬线，避免额外字体加载。按用户纠正，恢复缩小前的原字号，改为统一减轻字重：正文、输入、元信息使用 --weight-body: 300；标题、按钮、标签、选中项和强调文字使用 --weight-emphasis: 400。标准工作区主标题 25/400，课程详情标题 22/400，面板标题 20/400，正文 14/300，操作 13/400，元信息 10–12/300；2400px 以上主标题 34、课程标题 28、输入正文 16。字号不再乘缩放比例，不使用页面 zoom/transform 或降低文字透明度；颜色、图标、行高、间距和控件最小高度保留。标题字距不小于 -0.02em；数量使用等宽数字。目录名称允许折行，详情标题最多两行并提供完整 title，编辑框保留完整名称。

## Layout

用户指定 3200×2000、100% 缩放为主验收尺寸。应用占满 100dvh，导航、标题和操作区固定，课程/资料长列表只在各自区域滚动。2400px 以上使用 260px 导航、最大 2400px 内容区、36% 详情列和 48px 页面留白；标准桌面沿用 220px 导航/420px 详情并收紧留白。保存、取消及上传按钮留在可见区域，禁止通过缩放或裁掉字段实现适屏。

940px 以下导航移至顶部；740px 以下目录与详情切换显示，用“返回课程目录”返回，编辑退出保留未保存提示。资料只显示在资料页签。账户页按用户参考图排列居中头像/昵称/邮箱、横向五项统计、下方账户操作；缺失统计显示 — 和简短待接入状态。修改昵称与密码为原生 dialog 短表单，遮罩不关闭，支持焦点恢复与未保存确认；修改邮箱按用户确认禁用并显示待接入。

登录页按用户要求只保留居中表单，标准最大宽 440px、大屏 520px；开发构建可显示测试登录按钮。极短窗口、放大辅助显示或超长旧内容可在对应面板滚动；不承诺任意内容全量同时显示。最低宽度仍为 320px。

用户要求移除无课程时的图标/介绍和未选课程的详情占位，空列表保留目录标题、数量和分页，未选课程时详情区留空；筛选无结果和加载失败仍有可恢复反馈。登录表单删除常驻“验证邮箱 / 重发验证邮件 / 重置密码”底栏，注册/未验证登录进入验证流程，找回密码发码后进入重置，重发验证码仅在验证步骤提供。

## Elevation & Depth

面板采用单线边界，没有叠加大阴影。分段选择活动项为 0 1px 3px #152d4b12；浮动成功 toast 使用 0 4px 18px #152d4b22，不叠加边框。焦点用清晰轮廓而非装饰光晕。状态变化使用 150ms 颜色过渡，尊重减少动态偏好。

## Shapes

共享样式以 `corner-shape: squircle` 实现连续曲率圆角，控件半径 8px、面板 12px，登录容器 16px；头像和状态点保留圆形。支持该属性的引擎渲染连续角；不支持的引擎保留普通圆角作为可用性回退，不能称已达到连续曲率验收。当前 Chrome 已验证计算值为 superellipse(2)。属性依据 [CSSWG 工作草案](https://drafts.csswg.org/css-borders-4/#corner-shape)。

## Components

主操作使用实心蓝按钮；普通操作用白底边框；永久删除须有明确确认。分段按钮筛选当前页，不能暗示全库搜索。详情页签支持左右方向键及 Home/End。编辑在详情区进行，保存前离开必须保留放弃提示。输入使用可见标签、原生约束与明确错误；文件选择保留原生输入和键盘焦点。空态、读取中、错误和成功分别表达。

表单输入框、文本框和选择框的焦点直接高亮原边框：行动蓝边框加 1px 内描边，不向外扩散或改变尺寸，避免滚动容器裁切。按钮及导航仍使用原有键盘焦点规则。

成功提示使用右上角黄绿色气泡，在 3 秒周期中淡入、停留、淡出；手动关闭淡出 180ms，不占用布局、不移动焦点。课程上传/删除成功沿用同一通知；新通知重新计时并重播动画，退出页面清理定时器。减少动态偏好下关闭动画并保留阅读时间。窄屏 toast 距两侧各 12px。错误及账户验证的后续操作说明继续就地展示。

学习目标固定为“及格就好 / 多学一点 / 大师之境”，默认中档；旧自定义文本主动替换前完整保留。详情说明描述目标，不宣称 AI 已运行。具体策略见学习难度开发计划。

## Do's and Don'ts

课程详情按用户要求只保留“课程概览”和“教材目录”，移除“学习资料”页签及入口；页签键盘切换与未保存保护保留，既有文件数据不删除。

教材目录在课程详情的独立页签内完成，保持 Operate 模式与原有连续角、字阶及自动深浅色。正式树和草稿分开呈现；图片导入用原生折叠区域，章节按阅读顺序编辑，起止页码成组显示，未知页码留空。待核对项逐项确认后保存；确认区列出变更并对归档项单独确认。保存失败保留输入，切换页签/课程或离开页面保护未保存内容。实际浏览器交互与视觉限制集中记录在 HANDOFF.md。

- 使用真实课程、教材、文件和接口状态，简洁命名操作。
- 保持目录与详情边缘对齐、分组间距清楚、原生键盘行为可用。
- 不添加虚构统计、未接入功能的交互入口或装饰性 Shader。
- 不将当前页筛选写成全局搜索，不在错误时显示空列表成功状态。
- 不为布局覆盖 API、安全边界或用户原有目标。
