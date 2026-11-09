# 课程设计系统验收 · 2026-11-09

以新建课程为首张标准页，原 Next.js 动态服务、同源 API、课程结构和业务规则保留。没有新增依赖；未发布云端或 Sites。

## 文件清单

| 文件 | 修改 |
| --- | --- |
| `frontend/styles/tokens.css` | 迁移原主题变量，增加语义颜色、4px 间距、字号、容器、控件尺寸、圆角、浮层阴影/层级 Token；保留自动深浅色 |
| `frontend/styles/ui.css` | 统一原 `.button` / `.form-stack`，共享组件与课程标准页响应式样式；移除原冲突规则 |
| `frontend/components/ui.tsx` | Button（四变体、三尺寸、loading）、Input、Select、FormField、Card（三外观）、PageHeader、PageContainer（四宽度）、Breadcrumb |
| `frontend/app/globals.css` | 引入原主题 Token，移除迁出的按钮/控件及旧编辑器拉伸样式，保留其他业务样式 |
| `frontend/app/layout.tsx` | 在原全局样式后接入共享 UI 样式 |
| `frontend/components/course-editor.tsx` | 卡片外标题/说明、移除关闭 X、共享字段、必填反馈、忙碌保护、右对齐操作 |
| `frontend/components/course-space.tsx` | 编辑时使用 800px 容器和返回我的课程；原详情保持全宽，原保存/取消/离开保护不变 |
| `frontend/components/workspace.tsx` | 面包屑接入公共组件与当前页面语义 |
| `frontend/tests/course-editor.test.tsx` | 原生必填、关联错误、忙碌禁用、重复提交保护和重试 |
| `frontend/tests/course-workspace.test.tsx` | 保存失败后保留四字段并重试原接口，更新返回文案断言；原回归继续运行 |
| `DESIGN.md` | Token、组件使用示例、布局、响应式和职责边界规范 |
| `RUNBOOK.md` / `HANDOFF.md` | 当前入口、检查方式与交付状态 |
| 本目录 `desktop-1440.jpg` / `mobile-390.jpg` | 用户要求保留的两张运行效果截图 |

## 实际验证

- Docker Linux 中 `npm run check`、85 项 Vitest、`npm run build` 通过；之后仅修正 CSS 布局/优先级与兼容样式，最终生产镜像重新构建并通过 TypeScript。行为测试对应源码未变，未因 CSS 改动重复运行行为测试。
- Impeccable 对全部修改 UI 文件的最终机械检测返回 `[]`。主代理对新旧共享规则和直接调用方完成复查，没有引入第二套按钮/输入框体系。
- Chrome 深色实际查看 1920×1080、1440×900、1024×768、768×1024、390×844：无页面横向滚动；宽屏表单最大 800px，768px 平板双列、内边距 20px，390px 手机单列、内边距 16px，桌面卡片自然高度约 414px。保存按钮按内容宽度右对齐，间隔 8px。
- 最终手机实测输入框/下拉框至少 44px、输入字号 16px；名称错误 `aria-invalid=true`，边框实测 `rgb(243,161,154)`；连续角计算值 `superellipse(2)`。
- 真实浏览器填写名称/学科/教材/大师之境并保存，观察保存中及控件禁用；刷新后课程仍在列表，独立 API 读取逐字段一致。仅删除本任务创建的验收课程并确认 404；原课程保留，独立 API 会话已退出，原浏览器测试会话保留。
- 实际检查空表单取消、移动导航抽屉，以及课程列表、模型设置、账户设置和昵称原生对话框；无新增业务布局改造，未保存模型/资料修改。失败保留/重试、旧自定义目标、归档/恢复、未保存离开等由自动回归覆盖。

## 解耦复查

通过，限 CourseEditor → UI 与 CourseSpace/Workspace 的直接调用链。UI 仅持有呈现与原生属性；不引用 API、课程类型、用户或路由。CourseEditor 保留局部目标选择/错误与挂载聚焦；CourseSpace 保留网络、持久化、忙碌、会话失败和离开保护。没有新全局可变状态、监听器、反向依赖或库。既有课程表单 `Record<string, FormDataEntryValue>` 契约和历史目标省略逻辑保留。

## 限制

五个指定尺寸已验收，截图为开发浏览器视口模拟；未在真实手机、软键盘或辅助技术设备上操作。浅色兼容变量保留，本轮未新增浅色视觉验收；接口错误和重复触发用自动测试覆盖，未人为中断真实服务。云端发布和全站业务布局重做不属于本次交付。

仅保留用户要求的两张效果图和本摘要；任务临时脚本、测试镜像、候选标签和普通 worktree 在本地交付后回收，运行镜像与用户数据保留。
