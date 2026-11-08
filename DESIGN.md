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
typography:
  title:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  metadata:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "8px"
  panel: "12px"
spacing:
  unit: "8px"
  group: "16px"
  section: "24px"
  page: "36px"
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
    padding: "26px"
---

## Overview

用户在方向页选择“深蓝索引”。工作台借用分类标识的清晰阅读轴：左侧定位、中部选课、右侧处理信息。设计服务于课程和资料管理；课程内容、真实状态与明确操作构成界面，不制造学习进度或尚未接入的 AI 结果。

## Colors

深蓝导航区与浅蓝工作区建立全局层级，白色面板承载内容。行动蓝用于主操作、选中与焦点；绿色只表示学习中或成功，红色用于危险操作和错误。辅助文字使用带蓝色相的 muted。普通与占位文字至少 4.5:1，大字至少 3:1；禁用控件保持可识别状态。

## Typography

使用系统中文无衬线，避免额外字体加载。主标题 28/650，课程详情标题 24/650，面板标题 20/650，正文 14，操作 13，元信息 11–12。标题字距不小于 -0.02em；数量使用等宽数字。长名称允许折行，次要教材信息可以省略并通过详情阅读。

## Layout

标准桌面为 220px 导航、弹性课程目录和 420px 详情，内容间距 24px，页面水平留白 36px。导航固定在视口中，账户与退出始终可到达。1180px 以下收紧到 190px 导航/360px 详情；940px 以下改为顶部导航；740px 以下列表与详情纵向排列，选择课程/新建时定位详情。最低支持 320px；1600px 起限制内容最大宽度。登录保持双区布局，手机只显示表单。

## Elevation & Depth

面板采用单线边界，没有叠加大阴影。唯一轻阴影为分段选择的活动项：0 1px 3px #152d4b12。焦点用清晰轮廓而非装饰光晕。状态变化使用 150ms 颜色过渡，尊重减少动态偏好。

## Shapes

共享样式以 `corner-shape: squircle` 实现连续曲率圆角，控件半径 8px、面板 12px，登录容器 16px；头像和状态点保留圆形。支持该属性的引擎渲染连续角；不支持的引擎保留普通圆角作为可用性回退，不能称已达到连续曲率验收。当前 Chrome 已验证计算值为 superellipse(2)。属性依据 [CSSWG 工作草案](https://drafts.csswg.org/css-borders-4/#corner-shape)。

## Components

主操作使用实心蓝按钮；普通操作用白底边框；永久删除须有明确确认。分段按钮筛选当前页，不能暗示全库搜索。详情页签支持左右方向键及 Home/End。编辑在详情区进行，保存前离开必须保留放弃提示。输入使用可见标签、原生约束与明确错误；文件选择保留原生输入和键盘焦点。空态、读取中、错误和成功分别表达。

学习目标固定为“及格就好 / 多学一点 / 大师之境”，默认中档；旧自定义文本主动替换前完整保留。详情说明描述目标，不宣称 AI 已运行。具体策略见学习难度开发计划。

## Do's and Don'ts

- 使用真实课程、教材、文件和接口状态，简洁命名操作。
- 保持目录与详情边缘对齐、分组间距清楚、原生键盘行为可用。
- 不添加虚构统计、未接入功能的交互入口或装饰性 Shader。
- 不将当前页筛选写成全局搜索，不在错误时显示空列表成功状态。
- 不为布局覆盖 API、安全边界或用户原有目标。
