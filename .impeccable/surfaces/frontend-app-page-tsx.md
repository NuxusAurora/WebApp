---
version: 1
slug: "frontend-app-page-tsx"
primary_target: "frontend/app/page.tsx"
related_targets: ["frontend/components/workspace.tsx","frontend/components/account.tsx","frontend/components/course-space.tsx","frontend/components/profile.tsx","frontend/app/system/page.tsx","frontend/app/globals.css"]
---

# Phase 1 工作台改版

模式：Operate。用户确认桌面优先、快速管理课程和资料；2026-11-08 在方向页选择 blue-index，code-first。范围覆盖课程工作区、登录/账户和系统状态；追加默认关闭的本地测试登录，正常认证及 Phase 2 不变。

## Direction contract

THESIS: 用清晰的课程索引和稳定的详情区域完成管理任务，替换居中的简易表单与松散列表；不使用宣传页 hero、虚构学习统计或装饰性动效。

OWN-WORLD: 深蓝 #152d4b 导航承载全局定位；#2869b0 用于主操作、选中和焦点；#edf3f9 是工作区浅底，内容白色。使用紧凑的中文系统无衬线、固定字阶、统一 8/12px 控件与面板连续曲率圆角、单线边界。签名细节是蓝白索引带：选中课程的标题、状态与资料操作在同一阅读轴上。

THEME: 通过 prefers-color-scheme 跟随系统深浅色；用户指定深色黑底：#000000 工作区/导航、#0a0a0a 内容面、中性近黑控件底与灰色边界，保留 #8dbbff 操作蓝。成功通知为黄绿色 18px 连续角气泡，3 秒淡入淡出，手动关闭 180ms；减少动态时关闭动画。保留原框蓝色焦点边界与内描边。

ACCOUNT: 按用户参考图居中显示头像、昵称、邮箱；五列指标为消耗 Token、使用峰值、最长学习项目用时、最长/当前连续学习天数。尚无统计接口，值显示 —、状态待接入。下方修改密码与昵称使用原生短表单对话框；修改邮箱按用户选择禁用并标记待接入。测试登录按钮仅本地显式启用，登录固定独立普通账户。

STORY: 用户先扫课程目录，再阅读当前课程的教材和目标，直接整理资料；新建和编辑在详情区域完成。登录、账户和状态页使用相同组件语言，真实状态替代营销内容。

FIRST VIEWPORT: 用户追加指定 3200×2000、100% 缩放适屏。大屏为 260px 导航、最大 2400px 内容区与 36% 详情列，标准桌面沿用 220px 导航/420px 详情。页面固定 100dvh，长列表局部滚动，按钮保持可见；窄屏改为目录/详情切换，不再纵向堆叠。登录删除介绍区，只显示居中表单。选择、忙碌、空、错误和危险操作仍有可见反馈。

FORM: 自拟候选 5，科学博物馆的展项标识与分类索引；用户选择 blue-index。seed:7aeb6b277e009f0b。选定草图 blue-index 为布局参考，原始临时草图在交付后清理；无批准的图像 comp。保留字体样张的层级精度、时刻表的列对齐和分组列表的信息纪律，不移植其器物或控件。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

验收：主要桌面、390px 手机与实际内嵌浏览器宽度；真实课程和文件交互、键盘焦点、长内容和异步失败。依据用户的主代理规则，在本线程完成复查与文档，不使用技能建议的子代理，不声称独立评审。

## Phase 2 本地模型设置

Operate 模式，延续既有深蓝索引、自动深浅色、连续曲率和视口局部滚动。新增主导航模型设置：选择连接，下分连接与密钥 / 模型与测试 / 调用记录。表单显式保存，内容区可滚动，底部保存动作保持可达。新建、空、加载、保存失败保留输入、未保存离开确认、测试忙碌和真实结果分别呈现。仅本地 OpenAI 兼容；测试仅发送固定内容，不发送课程资料；真实模型效果不在本轮验收。
