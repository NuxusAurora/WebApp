# 运行手册

## 当前状态与环境

共同规格：`phase0-spec-v1` = `7e939d9b3610276a5d5f4e70a3eddfd80b32b112`。

2026-11-08，P0-C：依赖层已完成本机运行验证；应用服务为待联调配置。A/B 尚未交付代码、锁文件、Dockerfile 和启动/测试入口，因此整栈构建、迁移、Worker smoke、应用 CI 和浏览器验收均未执行。根 HANDOFF 由 B 汇总，本节是 C 的接续入口。

| 组件 | 固定版本/依据 |
| --- | --- |
| 验证脚本 | Node.js 24.18.0，仅标准库，无 npm 安装 |
| PostgreSQL | 本机镜像实际 18.6，Compose 固定多平台摘要 |
| Redis | 本机镜像实际 8.10.3，Compose 固定多平台摘要 |
| S3 开发服务 | RustFS 1.0.4，官方镜像，Compose 固定多平台摘要 |
| 本机 Docker | Engine 29.9.2；Compose 5.6.1 |
| CI | ubuntu-24.04、固定 Node 版本、Actions 固定完整提交号 |

镜像摘要集中在 `compose.yaml`；不要移动标签或静默升级已存在的数据卷。PostgreSQL 18 挂载 `/var/lib/postgresql`。Docker Desktop 需已启用 Linux 容器。CI 的实际 Docker 版本由托管 runner 提供，尚未执行远端工作流。

## 配置与首次启动

从当前 checkout 根执行：

```sh
node scripts/infra.mjs init
node scripts/infra.mjs check
node scripts/infra.mjs up
node scripts/infra.mjs smoke
```

`init` 从 `.env.example` 生成 `.env`，生成随机数据库、存储和应用密钥。数据库 URL 与数据库密码一起生成；ENCRYPTION_KEY 是 32 字节 URL-safe base64。已有文件不会覆盖。脚本日志不输出凭据，`.env` 和任务缓存被 Git 忽略。Windows 文件访问权限由当前用户 ACL 管理。

| 变量 | 用途与注意事项 |
| --- | --- |
| COMPOSE_PROJECT_NAME | 开发项目名，默认 structured-learning；每个并发工作区必须使用不同名字 |
| POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD | PostgreSQL 初始化配置；改已有卷的环境变量不会重置数据库用户密码 |
| DATABASE_URL | 后端连接串；示例暂用 postgresql+psycopg，最终驱动及格式由 B 确认 |
| REDIS_URL | 后端 Redis 连通检查，DB 0 |
| CELERY_BROKER_URL / CELERY_RESULT_BACKEND | Worker broker DB 1 / result DB 2，待 B 核对实际配置字段 |
| SECRET_KEY / ENCRYPTION_KEY | 只传入 backend / worker；最终格式校验由 B 实现 |
| STORAGE_ENDPOINT | 容器内 http://storage:9000 |
| STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY | 仅本地开发使用的 S3 管理凭据，不传入前端 |
| STORAGE_REGION / STORAGE_BUCKET | us-east-1 / learning-dev；smoke 不使用开发桶，而是创建并清理独立测试桶 |
| BACKEND_INTERNAL_URL | 仅前端服务端读取；容器内 http://backend:8000 |
| FRONTEND_PORT / BACKEND_PORT / STORAGE_PORT | 默认 3000 / 8000 / 9000；改端口后重新 up，不改变容器内部端口 |
| WORKER_APP | 等待 B 提供的可导入 Celery app；故意不填猜测的模块名 |

默认 `up` 仅启动 postgres、redis、storage。Compose 没有固定容器名、外部共享网络或全局命名卷，资源名带项目名前缀。数据库与 Redis 只加入内部 `data` 网络，不发布端口；存储另加入 `storage-access` 网络以发布本机端口。前端仅加入 `app` 网络，且只收到后端服务端地址；后端/Worker 组合应用与数据网络。

开发存储使用 RustFS，因为尝试的 MinIO 官方历史镜像标签已无法获取。RustFS 为可替换的开发 S3 实现，不改变 S3 契约；应用不得依赖其管理 API。参考：[官方容器说明](https://docs.rustfs.com/en/installation/container/docker)、[1.0.4 发布](https://github.com/rustfs/rustfs/releases/tag/1.0.4)。网络与依赖语义参照 [Docker Compose 网络](https://docs.docker.com/compose/how-tos/networking/)、[启动顺序](https://docs.docker.com/compose/how-tos/startup-order/)。

## 并发与宿主开发

每个开发者先在自己的 `.env` 设置独立的 `COMPOSE_PROJECT_NAME` 和未占用的宿主端口。也可显式指定文件/项目；Node 的 `--` 用于终止 Node 参数解析：

```sh
node -- scripts/infra.mjs init --env-file .env.local
node -- scripts/infra.mjs up --env-file .env.local --project learning-local
node -- scripts/infra.mjs smoke --env-file .env.local --project learning-local
node -- scripts/infra.mjs down --env-file .env.local --project learning-local
```

每次操作同一环境必须使用同一参数。不要将容器内的 postgres、redis、storage、backend 服务名直接用于宿主应用。优先将 A/B 应用运行在 Compose 内；需要宿主开发时，可在自己的临时覆盖文件中将 PostgreSQL/Redis 分别发布到 `127.0.0.1:15432` / `127.0.0.1:16379`，并给相应服务添加独立的非内部访问网络，再将宿主后端的 DATABASE_URL、REDIS_URL、Celery URL 改为这些地址；STORAGE_ENDPOINT 使用 `http://127.0.0.1:<STORAGE_PORT>`，宿主前端 BACKEND_INTERNAL_URL 使用 `http://127.0.0.1:<BACKEND_PORT>`。宿主覆盖方式尚未验收，B 优先使用容器内集成检查。

内部网络服务只加 ports 在本机 Engine 29.9.2 下没有实际发布端口；已由回归检查覆盖存储访问网络。不要为连接方便把数据库/Redis 改成公网监听。

## 应用接入与迁移顺序（待 A/B 输入）

`compose.yaml` 已声明 frontend、backend、worker 三个 `app` profile 服务，构建上下文分别是 frontend/ 与 backend/，依赖健康检查成功后启动。应用启动命令保留各自 Dockerfile 的 CMD；C 不覆盖其内部目录或依赖安装方式。

继续接入需要：

1. A 提交前端 Dockerfile、锁文件、实际 check/test/build 命令和同源 health/ready 路径；当前前端探针按共享约定使用 `/api/v1/health`，需核对 A 的实现。
2. B 提交后端 Dockerfile、锁文件、启动/检查/测试命令、数据库 URL 驱动及密钥格式、Celery app 与 smoke 任务名/返回值。
3. C 对齐变量与探针，填入 WORKER_APP，将应用检查加入 CI；不得用成功的依赖 CI 代替应用测试。
4. 先启动依赖，再构建应用；由单一操作者执行 B 发布的迁移命令（Alembic upgrade head），确认重复执行无副作用，再启动 app profile。Web/Worker 入口不自动并发竞争迁移。
5. 根据 B 的实际任务入口投递并读取 smoke 结果，检查 ready、前端同源代理和浏览器状态；停止依赖、观察失败，再恢复并验收。

在以上入口尚未交付前，不提供猜测的 pytest、npm 或 Celery smoke 命令冒充已验证流程。B 负责按项目合并队列组织同一候选提交的阶段验收，A 评审 C。

## 检查、CI 与停止

```sh
node --test scripts/infra.test.mjs
node scripts/infra.mjs verify
node scripts/infra.mjs down
```

`verify` 每次生成 `p0c-verify-<UUID>`，专用临时 env 文件位于 `.task-cache/p0c/`，端口由 Docker 分配。它验证 Compose 配置、数据库认证 SELECT 1、Redis 写/读/删除、独立 S3 桶及对象写/读/删除/不存在，再执行 stop/up 并重复验证；finally 删除仅该 UUID 项目的容器、网络与卷，成功后删除其 env 文件。脚本不迁移或修改业务表。

`.github/workflows/infra.yml` 在 push、pull_request 或手动触发时运行上述两条检查，只有只读仓库权限，无镜像发布或部署。工作流不因新提交自动取消正在清理资源的旧任务。未获授权不推送；截至本次记录，远端 Actions 未运行。应用 CI 等待上一节的入口，不属于当前绿色依赖检查的证明范围。

`down` 保留全部开发卷，`up` 再次启动后数据仍在。日常不使用 down --volumes。只有确认当前项目名、数据归属和无依赖后才可删除测试卷。

## 故障排查与数据

- Docker command failed：先运行 `docker info`、`docker compose version`，确认引擎及镜像仓库可达。脚本避免输出可能含敏感配置的原始诊断；需要手动检查时不要把完整 Compose config/env 转发到日志或聊天。
- 端口占用：修改本环境的 STORAGE_PORT，应用接入后同理修改 FRONTEND_PORT/BACKEND_PORT，再 up。数据库和 Redis 默认无宿主端口。
- health 超时：使用相同 env 和项目参数执行 `docker compose ps`，定位组件后检查对应日志，先脱敏。健康启动依赖只保证启动时序；持续重连及超时由 B 的连接层负责。
- init 拒绝覆盖：继续使用已有 `.env`，无需重新生成或重置数据。切换凭据需同时更新连接串和已存在的服务凭据；不要通过删除开发卷解决密码问题。
- 验证中断/清理失败：保留的 `.task-cache/p0c/p0c-verify-<UUID>.env` 可定位本次测试项目；仅对该文件对应的相同 UUID 项目执行 compose down --volumes，再删除该临时 env。不要执行全局 docker prune，不碰其他项目卷。
- PostgreSQL、Redis AOF 和 S3 数据分别在项目 postgres-data、redis-data、storage-data 卷。仓库根文档只记录软件开发；课程记录不写入这些 Markdown 文件。

当前配置仅供本地开发：端口绑定 loopback，Redis 依赖私有网络，S3 使用本地管理凭据。生产部署、TLS、最小权限存储身份、密钥注入、备份/恢复及回滚需要 Phase 9 的独立验证；当前没有生产部署或已验证的备份恢复命令。

## 验证与解耦结论

2026-11-08，Windows 本机：5 项 Node 回归检查通过；隔离 Compose 启动、PostgreSQL 认证连接、Redis 读写清理、S3 字节一致性/删除/桶清理、stop/up 恢复通过，自动验证项目与卷已删除。首次暴露的内部网络端口问题已修复，并增加回归检查。

解耦复查：依赖层范围通过。基础设施仅组合配置/进程，不导入应用或写业务状态；测试桶、Redis 键和测试 Compose 项目均有明确创建与清理归属；前端不收到凭据，数据服务地址集中配置。保留项：应用 Dockerfile CMD、Worker app、配置校验和持续重连依赖 A/B 实现，整栈边界尚未验证。

P0-C 保持进行中，等待 A/B 入口与交叉评审；不将本轮本地依赖验证算作 Phase 0 完成。
