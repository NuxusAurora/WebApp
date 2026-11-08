# 项目交接

## 已完成

2026-11-08：Phase 0 已完成本地验收，Phase 1 尚未开始。用户授权当前主代理统一接管 A/B/C，原三人待领取与交叉评审流程由本轮单主代理实施、测试及代码复查取代；未使用子代理，不声称独立评审。

- 实施版本：`b92912e8d5c1f6ab6ff27a012d24a654fd06faf9`；其后仅更新交付文档和完成记录。共同规格标签 phase0-spec-v1 保持不动。
- Next.js + React + TypeScript 工程、同源 health/ready 代理与状态页；有限超时、无缓存、上游异常脱敏，支持检查中、依赖失败、后端不可达和重试恢复。
- FastAPI Settings、SQLAlchemy/Redis 生命周期和 health/ready；数据库/缓存检查并行且有超时，日志记录请求 ID 与路由模板，不记录查询串、正文和原始异常。
- Alembic 空基线 `0001_baseline`，空库迁移及重复执行通过，无业务表；独立 Celery Worker 与 `phase0.smoke`，经 Redis 投递并读取结果，主动清理结果。
- Compose 六服务、隔离网络/数据卷、非 root 应用容器、固定镜像摘要、Python/npm 锁文件；README、RUNBOOK 和 CI 使用同一组实际入口。

## 验收证据

- 5 项 Node 工具检查、15 项后端测试、7 项前端测试通过；Ruff、格式检查、TypeScript 检查与 Next.js 生产构建通过。
- 最终实施版本在隔离 Linux 容器内完整执行 CI 等效入口 `node --test scripts/infra.test.mjs` 与 `node scripts/phase0.mjs verify`：测试/生产镜像构建、六服务健康、重复迁移、真实任务结果、PostgreSQL 认证连接、Redis 与 S3 读写删除、测试桶清理均通过。
- Redis/PostgreSQL 分别停机时 health 仍为 200，ready 与前端代理返回 503，恢复后重新就绪；后端停机时代理返回 502，恢复通过。Worker 在 Redis 恢复及整栈重启后再次执行真实任务成功。完整 stop/up 后迁移版本保留，应用日志与页面未发现所配置密钥。
- 真实浏览器验收：桌面正常状态、检查中、Redis 失效、后端断开、手动重试恢复、Enter 触发重试均通过；390×844 窄屏内容宽度等于视口宽度，无横向溢出。前端采用普通 CSS 的克制状态列表，未加入 Shader 或无业务作用的装饰。
- 首轮验收发现 Docker 重启后重新分配随机宿主端口；仅修复验收脚本，重启后重新发现地址，最终整套检查通过。

解耦复查：通过，范围为 Phase 0 入口、直接调用链与资源退出路径。浏览器不持有内部配置或凭据；UI 只消费状态，代理筛选响应字段；Web 与 Worker 独立，迁移不耦合启动；连接、会话、超时取消与关闭归属明确；测试仅操作随机命名的键、桶、项目和卷，基础设施不直接写业务状态。没有扩展历史重构。

## 下一步

按 mainbook 第 20 章进入 Phase 1：注册/邮箱验证、登录与权限、课程 CRUD、文件上传和用户级隔离。业务表从新迁移开始，不能修改已验收的 0001 基线。当前没有业务账户或课程数据。

运行入口以 [RUNBOOK.md](RUNBOOK.md) 为准。从仓库根执行 `node scripts/infra.mjs init`，然后 `node scripts/phase0.mjs up`。停止用 phase0.mjs down，保留开发卷；完整复验用 phase0.mjs verify。

## 未测与限制

- GitHub Actions 工作流已配置，本机执行了等效容器检查；未获推送授权，远端 Actions 未运行。未发布或部署外部服务。
- 当前仅 Phase 0；生产 TLS、备份恢复、生产凭据策略、业务权限与 AI 能力属于后续阶段，不能从本轮通过推导完成。
- pytest 的 Starlette TestClient 发出 httpx 兼容层弃用提醒，测试全部通过；后续可在依赖维护时切换 httpx2，不影响当前服务运行。

## 清理与交付

本轮测试项目（f1030cc5、d2e45337、0f9ab18f UUID 尾缀）和诊断 p0c-20261108 的容器、网络、卷均已删除；12 个任务镜像标签及本任务新拉取且无人使用的 Python/uv/Node/RustFS 镜像标签已删除。前端 node_modules、.next、tsbuildinfo，后端 .venv、pytest/Ruff/Python 缓存及临时 env 已删除，生成文件合计逻辑大小 582,419,123 字节；这不是精确磁盘净释放量。原始验证资料不长期保留，后续按源码和锁文件复建。

没有全局清理共享 npm/uv 下载缓存或 Docker BuildKit，以免影响其他项目；既有 PostgreSQL/Redis 镜像保留。任务 worktree 在候选本地合入 master、锁释放且确认无依赖后按普通 Git worktree 流程移除。没有推送授权，不执行 push。
