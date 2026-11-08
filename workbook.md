# Workbook

当前没有活动开发任务。

2026-11-08（frontend-redesign-20261108）：按用户选择完成深蓝索引桌面工作台，保留 Phase 1；学习目标改为三档，并将 AI 难度规则写入 docs/plans/learning-difficulty-plan.md。实现 a6ccc8e 已本地合入，localhost:3000 已更新，23 项前端测试、类型检查、生产构建和浏览器验收通过；解耦复查通过，主代理替代独立审查。任务 QA 数据、构建与原始证据共 485,450,678 逻辑字节已清理，任务 worktree 在最终合入后回收；主线外部 Adapter 删除保留，不推送。详见 HANDOFF.md。

2026-11-08（phase1-phase2-20261108）：用户最新范围为完成 Phase 1 后停止，Phase 2 未实施。Phase 1 实现版本 1ede57e：账户/邮箱验证/会话/密码与资料管理、隔离课程 CRUD、受限文本上传与签名下载。5 项工具、26 项后端、11 项前端测试及容器/生产构建、真实 PostgreSQL/S3、并发令牌消费和浏览器验收通过，解耦复查通过。任务测试资源、8 个镜像标签与 615,492,618 逻辑字节缓存已清理；本地交付按 master 队列，合入后回收任务 worktree，不推送。验收范围和限制集中见 HANDOFF.md，运行方式见 RUNBOOK.md。

2026-11-08（phase0-c-infra-20261108）：用户将范围扩展为完整 Phase 0，由同一主代理接管 A/B/C。实现与完整验收代码为 b92912e8d5c1f6ab6ff27a012d24a654fd06faf9；27 项工具/前后端测试、Linux 容器中的检查与生产构建、真实依赖/迁移/Worker/S3、故障恢复及浏览器验收通过，解耦复查通过。已清理任务测试资源和生成缓存，候选按锁本地合入 master 后回收独立 worktree；未推送，远端 CI 未运行。具体证据、清理字节数、限制与 Phase 1 接续集中见 HANDOFF.md，运行入口见 RUNBOOK.md。

2026-11-08：已初始化当前目录的 Git 仓库，origin 为 https://github.com/NuxusAurora/WebApp.git。已核对 fetch/push 地址；尚无提交，未拉取或推送。保留原有 mainbook.md，无临时缓存。

2026-11-08（mainbook-clarifications-20261108）：已补齐 mainbook.md 的学习状态与前置条件、结构草稿/确认/重新生成、多知识点练习关联及临时/正式 ID 映射、课程记录与开发文档边界；同步数据库、API、Prompt 示例和验收项。已核对 23 章结构、代码围栏、13 段 JSON 示例、表格列数及相关定义；按 CRLF 行尾规则的 Git 空白检查通过。本次仅文档修改，未执行应用测试，无临时产物。原有正文在任务开始前即未提交，且 HEAD 中 mainbook.md 为空；为避免将既有修改纳入本任务提交，保留工作区结果，未提交或推送。下一步可依修订规格开展分阶段开发。

2026-11-08（phase0-cards-20261108）：已编写 docs/plans/phase-0-task-cards.md，包含 A 前端、B 后端与集成、C 基础设施与 CI 三张待领取任务卡，以及共享接口、文件归属、启动依赖、交叉评审和阶段验收条件；文内附可转发领取指令。已对照 mainbook Phase 0 核对范围与依赖，检查暂存差异及空白通过；仅任务卡文件以 536733f 本地提交并按锁快进合入 master，未推送。既有 mainbook/workbook 修改保留为未提交状态；本次未启动实现、未运行应用测试，无临时产物或任务 worktree。开工前由 B 协调将当前规格修订保存为三人共同提交基线。

2026-11-08（phase0-spec-baseline-20261108）：用户授权保存共同规格。完整 mainbook、历史 workbook 修订、更新后的 Phase 0 任务卡与新建 HANDOFF 一并纳入共同基线；固定引用 phase0-spec-v1，具体提交通过该标签解析。保留既有 master 合并历史及 .gitignore。已核对 mainbook 内容摘要未变、23 章、13 段 JSON 示例、文档围栏/表格和三卡基线约定；按 CRLF 规则检查提交空白。三张开发卡仍待领取，应用实现及运行验收尚未开始。本次仅保存本地 Git 基线，不推送；无临时产物或开发 worktree。开工入口见 HANDOFF.md。
