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
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 300
    lineHeight: 1.6
  metadata:
    fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 300
    lineHeight: 1.6
rounded:
  control: "6px"
  panel: "12px"
  bubble: "18px"
spacing:
  unit: "4px"
  group: "16px"
  section: "24px"
  page: "24px"
  wide-page: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "4px 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#37516d"
    rounded: "{rounded.control}"
    padding: "4px 12px"
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

2026-11-09 后续审核操作覆盖：意见仅由右上角箭头展开，批准为14px绿色按钮，左对齐于完整意见下方；不显示展开/收起文字。底部只保留左对齐的保存与确认操作，保存成功原按钮变灰显示“草稿已保存”，再编辑恢复“保存草稿”。“确认无误”待核对为橙色并显示警告toast，核对完成为绿色；移除独立保存状态、底部差异/模型依据，以及重新加载和关闭编辑入口。归档/掌握状态的必要复核移至实际确认区。业务内容/数据不变，验收见HANDOFF最新节。

2026-11-09 知识点局部重构：按用户此次任务书替代该页旧的白字同权重与嵌套滚动约定；其他页面不变。Operate 模式，深色背景沿用 #181818，内容单元 #222427、编辑区 #2b2e33、正文 #edf0f5、辅助文字 #abb3bf、细分隔线 #373c44，蓝色用于操作/选中/焦点，橙色标记待核对、绿色仅表达无待核对项。课程标题 26px/500，模块 20px/500、知识点标题 16px/500，字段与辅助信息 12–14px；连续曲率沿用共享 corner-shape。内容上限1200px，课程标题/状态/编辑操作与原三页签保持；主内容统一滚动。知识点默认展开首项及空名称项，标题呈现真实名称/编号/重要程度；定义整行，学习要求桌面等高双栏，800px 以下单栏。审核原文默认两行预览、展开完整，不生成摘要或虚构核对统计；只有显式核对操作按原逻辑移除待核对项。保存/确认主按钮按草稿脏状态选择，删除沿用确认。实际视觉及功能验证集中见 HANDOFF 最新节。

2026-11-09 知识点：课程详情增加知识点页签，沿用 Operate 模式、原主题 Token、连续曲率及局部滚动。采用已确认小节选择器和同页条目/表单，名称、定义、目标、掌握标准和重要程度在原内容区编辑，不增加弹窗或装饰图谱。草稿保存、差异复核、显式确认和归档勾选分开呈现，未保存/生成中离开受保护；窄屏目标/标准改单列。机械检测无问题，实际浏览器因 IAB 超时、Chrome 控制不可用尚未新增验收，不能据构建判断视觉通过。

2026-11-09 教材目录空态精简：只显示一个44px高的“上传”按钮，移除常驻标题、说明、模型选择、图片列表和手动/OCR入口；系统自动选首个启用的视觉模型，上传后生成待核对草稿。已有内容和结果的核对、编辑、保存及显式确认仍按原逻辑呈现；状态/错误按需显示。详细行为和验收限制见HANDOFF最新节，覆盖下文历史导入界面说明。

2026-11-09 新建课程局部视觉：本次仅 `course-create-page` 采用1040px内容上限、30px/600标题、50px控件和46px按钮，以及 #17191c背景/#15181c侧栏/#202225卡片/#262b32输入。主题别名在该页外壳局部解析；焦点蓝#3985d6、主按钮#3278c5（白字4.54:1）。短桌面窗口收紧间距、输入48px；手机保留原生导航抽屉与单列。全部原文案/选项/交互保持，编辑页及其他页面继续遵循下述共享约定。实现和验收集中见 `docs/verification/course-create-visual-20261109/README.md`。

2026-11-09 课程设计系统（Operate，以本节覆盖下文历史表单尺寸与深色全白字约定）：

- `frontend/styles/tokens.css` 为原有主题变量的唯一来源，沿用 `--ink/--surface/--ground/--line/--accent` 等名称，并提供语义别名；继续随系统切换深浅色。深色保留 #181818 页面与 #222222 面板，输入底 #252a30，主文字 #f2f4f7、次文字 #b2bbc6、辅助字 #a1acb9。品牌实心按钮 #2869b0，悬停 #1e5592；链接/焦点仍用原主题 accent。
- 间距以 4px 为单位：4/8/12/16/20/24/32/40/48；页面标题 26px、卡片标题 18px、字段/正文 14px、辅助字 13px。沿用系统中文字体和已有轻字重，连续曲率圆角继续由全局 `corner-shape: squircle` 负责。
- PageContainer 统一 narrow 640 / standard 800 / wide 1120 / full 自适应，页面不自行定义任意宽度。课程新建与编辑使用 standard；其他现有业务布局保持。
- `frontend/styles/ui.css` 维护既有 `.button`、`.form-stack` 和新的公共组件，避免平行组件体系。Button 支持 primary/secondary/ghost/danger，small/medium/large 高度 32/36/40px，禁用/loading 均有状态；手机按钮至少 44px。Input/Select 默认 40px，手机课程表单至少 44px，品牌蓝焦点在原边框内绘制；错误使用语义 danger。
- `frontend/components/ui.tsx` 提供 Button、Input、Select、FormField、Card、PageHeader、PageContainer、Breadcrumb。原生 select 保留操作系统箭头、弹出层及键盘选择，不引入自绘菜单与第三方库。Card 有 default/secondary/interactive 外观；交互语义由调用者选择合适的按钮或链接。已有 `.status-tag` 与分隔线继续复用共享颜色/圆角变量；既有 Dialog 和 Sidebar 继续使用各自行为模块与受控主题变量。
- 首张标准页：顶部面包屑返回上级、卡片外标题/说明、内容自然撑开的卡片；不再显示独立返回按钮。面包屑显示“个人空间 > 我的课程 > 新建课程”或课程详情/编辑层级，祖先名称可点击、当前页为文本；保留忙碌禁用与未保存确认。名称独占一行，学科/教材桌面双列、<768px 单列，学习目标独占一行，取消/保存右对齐、间距 8px。卡片内边距桌面 24、平板 20、手机 16px。短屏仅主内容内滚动，所有操作可达。

公共组件只负责呈现与原生属性传递，不依赖课程、API、用户或导航控制器。CourseEditor 持有目标选择与字段校验；CourseSpace 仍持有网络、忙碌、错误、持久化与离开保护。请求字段、旧自定义目标兼容及异步失败路径保持；没有引入全局状态、额外监听器或新依赖。

复用示例：`<PageContainer size="standard"><PageHeader title="设置" /><Card>…</Card></PageContainer>`；提交按钮显式 `type="submit"`，默认 Button 为 `type="button"`。FormField 的 id 对应控件 id，说明使用 `${id}-description`，错误使用 `${id}-error` 与控件 `aria-describedby`/`aria-invalid` 关联。

2026-11-09 Sidebar 局部重构（Operate，覆盖下文历史导航尺寸与配色）：品牌/学习与设置分组/连接入口/账户菜单四区，保留原 SVG 图标。展开 248px，折叠 64px，740px 以下以同一实例呈现模态抽屉，平板无偏好时默认折叠。侧栏深色 #17191d、hover #22262b、active #293746；文字 #e5e7eb、次级 #929aa5，活动文字白色、图标 #a9d1ff；主内容主题不变，浅色保留对应 token。产品名 20px/400，LEARNING STUDIO 10px，分组 11px/500；导航 40px 高、14px 字、18px 图标、12px 图文间距、8px 连续角。200ms ease-in-out 折叠/抽屉、150ms hover，减少动态关闭动画。底部连接入口保留真实检查页，36px 默认头像配真实用户菜单，不重复顶部用户名。URL 决定活动项；不加虚假菜单或路由。实现与运行截图见 docs/verification/sidebar-20261109。

2026-11-08 课程布局调整（Operate）：首页采用一个带连续角的全宽矩形，内含搜索、新建、课程行与分页；去掉页内大标题/说明、目录标题及状态分类，只列学习中课程。行末绿色“进入”按钮为明确入口，点击后单独显示全宽详情，返回回到原列表。归档资料移到账户设置，按需展开并恢复学习；原配色、字体、输入与焦点规范保留。

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

目录图片识别：上传/勾选图片后，选择已确认支持图片的模型，主操作为“模型识别目录”；就地说明图片发送范围，只生成待核对草稿。“从文字整理（备用）”折叠保留本地 OCR 和文字处理。模型设置增加“支持图片识别”能力选项，未知能力不推断；原有目录核对、页码空值及确认保护保留。

模型发现：模型页按已保存连接自动读取可用模型，新增“服务模型”和刷新操作；选择后填入返回的名称/上下文/能力。缺失字段保留可编辑状态与简短说明，失败就地提示并保留手填；保存才写入配置，显式测试才调用生成。沿用现有滚动表单、固定保存区和未保存保护。

课程详情按用户要求只保留“课程概览”和“教材目录”，移除“学习资料”页签及入口；页签键盘切换与未保存保护保留，既有文件数据不删除。

教材目录在课程详情的独立页签内完成，保持 Operate 模式与原有连续角、字阶及自动深浅色。正式树和草稿分开呈现；图片导入用原生折叠区域，章节按阅读顺序编辑，起止页码成组显示，未知页码留空。待核对项逐项确认后保存；确认区列出变更并对归档项单独确认。保存失败保留输入，切换页签/课程或离开页面保护未保存内容。实际浏览器交互与视觉限制集中记录在 HANDOFF.md。

- 使用真实课程、教材、文件和接口状态，简洁命名操作。
- 保持目录与详情边缘对齐、分组间距清楚、原生键盘行为可用。
- 不添加虚构统计、未接入功能的交互入口或装饰性 Shader。
- 不将当前页筛选写成全局搜索，不在错误时显示空列表成功状态。
- 不为布局覆盖 API、安全边界或用户原有目标。
