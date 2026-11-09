# Sidebar 运行验收 · 2026-11-09

本地 Next.js 生产容器中的真实运行界面，Chrome 深色主题、100% 缩放。改造前为源码基线 658fbda；改造后为本次 sidebar-refactor-20261109 实现。以下五张截图按用户要求保留，不是生成图或静态样板。

| 状态 | 实际视口 | 截图 |
| --- | --- | --- |
| 改造前桌面 | 1440×900 | [before-desktop.jpg](before-desktop.jpg) |
| 改造前手机布局 | 390×844 | [before-mobile.jpg](before-mobile.jpg) |
| 改造后展开 | 1440×900 | [after-desktop-expanded.jpg](after-desktop-expanded.jpg) |
| 改造后折叠 | 1440×900 | [after-desktop-collapsed.jpg](after-desktop-collapsed.jpg) |
| 改造后手机抽屉 | 390×844 | [after-mobile-drawer.jpg](after-mobile-drawer.jpg) |

## 实现与文件

- frontend/components/app-sidebar.tsx：一个共享 Sidebar，内部依次为品牌、学习/设置分组、连接入口、账户菜单；单个原生 dialog 在桌面为非模态侧栏、手机为模态抽屉，不复制两套导航。
- frontend/components/sidebar.css：局部 token、248/64px 宽度、40px 导航、18px 图标、连续角、150ms Hover、200ms 折叠与抽屉动画、自动深浅色和减少动态。
- frontend/lib/workspace-navigation.ts：原 /、/system 及 /?view=ai、/?view=profile，URL 解析、历史同步、离开保护；保留 Next history state。
- frontend/components/workspace.tsx、frontend/app/system/page.tsx：复用外壳与原业务组件、真实用户和 ConnectionStatus，移除重复的顶部用户名。
- frontend/components/icon.tsx、frontend/app/globals.css：扩展既有 SVG 图标，接入局部样式并删除失效旧侧栏样式。
- frontend/tests/sidebar.test.tsx、sidebar-test-dom.ts、course-workspace.test.tsx：折叠/损坏和不可写偏好、媒体监听清理、移动关闭、账户菜单、URL/返回取消、退出失败和匿名状态页回归。
- docs/plans/sidebar-refactor.md、DESIGN.md、.impeccable/surfaces/frontend-app-page-tsx.md、RUNBOOK.md、HANDOFF.md：约定、实际行为、运行与限制。

## 验证

80 项前端测试、TypeScript、生产构建通过；Impeccable detect 返回 []。主代理检查最终变更及直接调用链，解耦约定通过：UI 临时状态归 Sidebar，用户/脏状态与 API 归 Workspace，URL 同步归导航工具，连接检查仍归原 ConnectionStatus；没有新增依赖、认证/数据库/API/课程结构改动，无独立评审。

实际浏览器覆盖课程列表和只读详情、模型设置、账户菜单/入口、连接状态；URL、刷新、浏览器前进/后退正确。折叠刷新后仍为 64px，展开实测 248px；折叠 Tooltip 未被裁切。320px、390px、1024px、1440px、3200px 下无整页横向溢出；手机默认隐藏侧栏、只有一个导航实例、打开后原生 modal 使背景不可交互，遮罩/Escape/导航点击均关闭并恢复菜单入口焦点。状态页真实显示 API 已连接、数据库/缓存正常，刷新后仍在 /system；控制台错误列表为空。

离开确认在浏览器实际触发，自动化连接被原生确认框阻塞后由用户手动处理，再继续其余验收；取消及历史恢复契约由自动回归覆盖，本轮未独立完成原生确认框取消的浏览器闭环。没有保存课程编辑、目录或模型配置。真实触屏设备和浅色未新增视觉验收；未声称其他浏览器全部兼容。

用户要求的功能已实现；快捷键属于可选增强，本次未增加。仅更新本地前端，不推送或更新云端/Sites。部署健康与清理结果集中记录在 HANDOFF.md。
