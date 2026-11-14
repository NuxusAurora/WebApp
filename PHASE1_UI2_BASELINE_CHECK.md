# Learning Protocol 2.0 · Phase 1 / UI-2 基线核实

核实日期：2026-11-14（太平洋时间）。源码基线：本地 `master` 的 `11c414d5714946d44fac00e2520d52e388515cfb`，核实时领先 `origin/master` 57 个提交。Phase 1 实现为 `cb994d5`，UI-2 实现为 `e7d88fd`；两者均已进入该基线。核实前已有 `mainbook.md`、`workbook.md` 未提交差异。

**Gate 0 未通过。** 两阶段的源码和自动化回归通过；本机目标开发环境尚未应用 Phase 1 的 `0012_learning_lesson_plans`，共享前端也未运行已审查的 UI-2 候选。UI-2 有三种视口的深色实测与截图，浅色缺浏览器实测。这里记录阻塞和恢复条件，不重做两阶段。

## 依据与范围

通读 Learning Protocol 2.0 一体化规格及其四份直接引用：Learning Protocol 1.0 开发协议（含附录 A/B）、Learning Protocol 1.1 前端 UI 设计规范、[Phase 0 审计](IMPLEMENTATION_AUDIT.md)、[UI-1 审计](UI_IMPLEMENTATION_AUDIT.md)。对照 [DESIGN](DESIGN.md)、[PRODUCT](PRODUCT.md)、[HANDOFF](HANDOFF.md)、[RUNBOOK](RUNBOOK.md) 及当前源码、运行 API、PostgreSQL 元数据和 UI-2 实际截图。两份早期审计为历史对照，不作为当前通过证据。

顺序采用 2.0 第 13 节；用户本轮明确覆盖附件中「每阶段停下等审阅」的工作指令。Gate 0 通过仍是本轮 Phase 2 文件级计划和后续开发的前置条件。

## 后端 Phase 1

| 检查 | 证据与结果 |
| --- | --- |
| 教学计划与步骤 Schema | [contracts.py](backend/app/learning/contracts.py) 实现 `LessonPlanDraft`、内部 `LessonPlan` 和 `Step`。计划包含题面、目标、难度、先修、有序步骤和内部参考答案；步骤从 1 连续且至少一步，包含目标、概念、所需上下文、完成标准、常见错误、禁止项和预期结论。禁止未知字段；冻结模型用元组保存数组。 |
| 题目身份与计划存储 | [models.py](backend/app/learning/models.py) 的 `LearningLessonPlan` 保存唯一 `question_id`、`plan_id`、会话、知识点、内容版本、计划版本、创建时间和 JSON 负载。题目及计划 UUID 由平台分配；题面在同一计划内，无独立题目表。步骤定义在有序 JSON 中，无独立步骤内容实体。[plans.py](backend/app/learning/plans.py) 的 `insert_plan` 校验会话和现行知识点版本，`read_plan` 按会话与计划共同查找，授权和事务归调用方。辅窗路由的 `Question` 请求体用于自由提问，不代表教学题目身份。 |
| 模型输出与检测边界 | `StepOutput` 为 `title/content`，`NewQuestionOutput` 从冻结计划组装 `problem`，`TextOutput` 用于提示、换讲法、检测题、检测反馈、辅窗回答，`CompletionOutput` 属平台。结构化模型输出拒绝额外的 `final`、进度或状态字段；内部计划不是公开 API 数据。Phase 1 未约定独立 `UnderstandingCheck` 或答题尝试表；现有检测仍为旧快照字段，独立身份和评价生命周期留待后续。 |
| 增量迁移 | [0012_learning_lesson_plans.py](backend/migrations/versions/0012_learning_lesson_plans.py) 接续 `0011`，只新增 `learning_lesson_plans`、索引和冻结触发器。源码候选运行 `alembic heads` 返回唯一 `0012_learning_lesson_plans`。无回填、旧表更新或重置；计划非空时拒绝降级。 |
| 开发 PostgreSQL | `structured-learning`，PostgreSQL 18.6。运行后端 `alembic current` / `alembic heads` 均为 `0011_learning_lessons`；数据库只读查询独立确认 `alembic_version=0011_learning_lessons`，`to_regclass('public.learning_lesson_plans')` 为空。**目标环境未应用迁移。** |
| 旧记录兼容 | [lesson_state.py](backend/app/learning/lesson_state.py) 返回旧主窗原字段，不合成计划或任务。开发库有 6 个学习会话、3 条主窗快照、1 条独立辅窗问答，原修订号、请求号和问答序号唯一约束仍在。只查询元数据和计数；本轮无数据库写入，计数不替代历史逐行摘要校验。 |
| 旧整栈验收 | [scripts/phase0.mjs](scripts/phase0.mjs) 已改为读取唯一 Alembic head，对照 `alembic_version`，检查表名单含新计划表，并在重启后核对修订号。[phase2-check.py](scripts/fixtures/phase2-check.py) 补注册学习和教材列表的 ORM 元数据。原硬编码 `0008` 的断言已修正，CI 入口未变。 |

在运行 FastAPI 的 OpenAPI 中确认下列路由（前缀 `/api/v1`）。现有响应沿用 `success/data/error` 约定：

| 路由 | 已有契约 |
| --- | --- |
| `GET /learning/projects`、`POST /learning/projects`、`POST /learning/projects/{project_id}/open` | 列出、创建或恢复小节项目。创建或恢复使用 `section_id`（创建时）及可选 `knowledge_point_id`。 |
| `GET /learning/projects/textbooks`、`GET/PUT/DELETE /learning/projects/textbooks/{course_id}` | 教材列表、正式目录读取、教材显示的添加和移除；不删除课程或会话。 |
| `GET /learning/conversations/{conversation_id}/lesson` | 空态 `{revision:0}`；有记录返回 `revision/problem/step/complete/support/check`。 |
| `POST /learning/conversations/{conversation_id}/lesson` | `request_id/revision/action/response?`；旧动作 `start/next/explain/hint/check/evaluate`。旧流的 `next` 仍读取旧 `step.final`；冻结计划写路径、独立 `complete` / `next-question` 和公开任务快照属于 Phase 2。 |
| `GET/POST /learning/conversations/{conversation_id}/turns` | 独立问答；GET 以 `before` 分页；POST 为 `request_id/after/question`，返回 `id/position/question/answer`。无教学题目归属字段，旧问答不作归因。 |

## 前端 UI-2

- **外壳和上下文：** `frontend/components/{workspace,learning-conversation,learning-context-path,lesson-workspace}.tsx`、`frontend/lib/learning.ts`。独立应用栏与教学上下文栏；课程、章、节和知识点取现有 API，缺章信息时不造占位值；状态来自主窗快照。新知识点深链接和旧 `?view=learning&project=…` 均保留。
- **导航和布局：** `frontend/components/{app-sidebar,learning-project-navigation}.tsx`、`frontend/components/sidebar.css`、`frontend/styles/learning.css`。教材、章节、小节、知识点通过字重和缩进分层，当前点有底色、侧线和 `aria-current`；保留课程管理、教材添加/移除与会话恢复。搜索仅覆盖已加载目录。展开/折叠 248/64px，主文最大 800px、独立滚动；主区不足 960px 时助手覆盖，手机单列与原生导航抽屉。浅色/深色走原有 Token 与系统主题。
- **回归与记录：** `frontend/tests/{learning-workspace.test.tsx,sidebar.test.tsx,sidebar-test-dom.ts}`、`DESIGN.md`、`RUNBOOK.md`、`HANDOFF.md`。测试覆盖真实字段映射、目录过滤、教材添加/移除失败重试与重加、深链接及旧项目恢复、自动收栏与恢复偏好。
- **截图与交互：** 已逐张打开「审查前端 UI 实现」交付的 `1280x720-dark.jpg`、`1024x768-dark.jpg`、`390x844-navigation-dark.jpg`。看到桌面上下文/选中项、1024px 深色主辅并排、手机导航抽屉。根据该对话的实测记录，候选连接真实本机 API；搜索、选点、返回、恢复步骤及手机关闭问答后的焦点/滚动恢复通过；1024px 为 64/600/360px。截图为前序交付，本轮未重跑交互。浅色关键 Token 的对比度有前序计算，浏览器浅色和真机软键盘未验收。
- **运行版：** `localhost:3000` 首页、health、ready 都为 200；运行前端静态产物包含旧教学工作台标记，却没有 UI-2 特有的 `learning-context-path` 或「搜索已加载目录」标记。健康检查不能证明该实例已部署 UI-2。应以当前源码候选验证，不能拿共享实例替代。

## 验证结果

| 命令或证据 | 结果 |
| --- | --- |
| 依据当前源码构建 backend test 镜像，独立无网络容器运行 `alembic heads && ruff check . && ruff format --check . && pytest -q` | 唯一源码头 `0012`；Ruff 通过，92 文件格式一致，206 项测试通过（含 Phase 1 的 29 项契约/兼容测试）；既有 Starlette TestClient 弃用警告 1 条。此处 pytest 的数据库验证使用隔离测试库。 |
| 依据当前源码构建 frontend test 镜像，独立无网络容器运行 `npm run check && npm test` | TypeScript 通过；12 个文件、146 项测试通过。 |
| `node --test scripts/infra.test.mjs scripts/production.test.mjs` | 10 项通过。 |
| 独立 PostgreSQL 迁移与旧数据、`node scripts/phase0.mjs verify`、前端生产构建和设计规则扫描 | 前序交付记录通过：从含旧记录的 `0011` 升级、11 张旧表逐行摘要相同、ORM 往返、重复升级、冻结和降级门禁；UI-2 候选生产构建和设计规则扫描通过。核对了当前基线对应后端/前端源码分别与两实现提交间无差异；这些检查本轮未重复。 |
| 开发堆栈 | PostgreSQL SQL 使用 `BEGIN READ ONLY`；已检查运行版迁移号、业务表/约束及聚合计数、OpenAPI、首页与探针。未执行迁移、重启、修改课程或提交教学操作，也未调用真实模型。 |

两个任务专用测试容器已自动回收，镜像标签已删除。未清理共享 BuildKit 缓存、运行镜像、用户交付截图或现有数据。

## 恢复 Gate 0 的最小步骤

1. 使用现有 [运行手册](RUNBOOK.md) 为本机开发库制作可恢复备份，核对旧表的行摘要；用包含 `0012` 的当前候选后端对已有数据库执行增量迁移。当前运行镜像自身的 `head` 是 `0011`，直接用它运行 `upgrade head` 无法补齐。
2. 再核对开发库为 `0012_learning_lesson_plans`，新表及冻结触发器存在，旧表摘要不变，旧主窗和辅窗可读，health/ready 正常。新计划开始写入后，若回退应用版本应保留新表，不强降迁移。
3. 使用已核对源码的 UI-2 构建，在本机候选或目标实例打开已保存会话；补浅色桌面和窄屏实测，核对文字、选中/焦点和主辅窗布局。无需改写 UI-2 功能；实测若发现缺陷，再记录证据。真实手机软键盘保留为 UI-6 的验收项。

目标开发环境尚未满足基线要求。Phase 2 文件级开发计划与实现未开始。
