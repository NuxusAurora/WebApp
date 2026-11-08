# 运行手册

## 环境与版本

共同规格：`phase0-spec-v1` = `7e939d9b3610276a5d5f4e70a3eddfd80b32b112`。2026-11-08 用户授权同一主代理完整实现 Phase 0，原三卡分工由统一实施取代。实施与解耦约定见 `docs/plans/phase-0-implementation.md`。

| 组件 | 当前锁定 |
| --- | --- |
| Node.js / Next.js / React / TypeScript | 24.18.0 / 16.4.5 / 19.3.1 / 5.9.3；frontend/package-lock.json |
| Python / uv | 容器 Python 3.14.10 / uv 0.12.5；镜像完整摘要在 backend/Dockerfile |
| FastAPI / SQLAlchemy / Psycopg / Alembic | 0.162.2 / 2.0.57 / 3.3.8 / 1.20.1；backend/uv.lock |
| Celery / redis-py | 5.7.0 / 7.4.1；backend/uv.lock |
| PostgreSQL / Redis / S3 开发存储 | 18.6 / 8.10.3 / RustFS 1.0.4；compose.yaml 固定多平台摘要 |
| 验证环境 | Windows + Docker Desktop；Engine 29.9.2、Compose 5.6.1；CI ubuntu-24.04 |

运行时依赖和开发依赖均有锁文件。Dockerfile 固定基础镜像摘要，Linux 测试与生产镜像使用同一基础及锁文件。不要通过移动镜像标签静默升级数据库卷。PostgreSQL 18 挂载 `/var/lib/postgresql`。

## 首次配置与完整启动

从仓库根执行：

```sh
node scripts/infra.mjs init
node scripts/phase0.mjs up
```

`init` 从 `.env.example` 生成随机数据库/存储/应用凭据，不覆盖已有 `.env`，不打印密钥。Windows 文件访问权限由当前用户 ACL 管理。`up` 构建生产镜像，等待 postgres/redis/storage 健康，由单一命令执行两次 `alembic upgrade head`（验证幂等），再启动 backend/worker/frontend 并等待健康。迁移没有嵌入 Web/Worker 启动，不会因多副本启动竞争迁移。

- 页面：[http://localhost:3000](http://localhost:3000)。初次检查与“重新检查”均请求同源 health/ready。
- API：[http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)、[ready](http://localhost:8000/api/v1/ready)、[OpenAPI](http://localhost:8000/docs)。
- S3 API：`http://127.0.0.1:9000`；控制台关闭。用户文件上传 API 尚未实现。

`docker compose ps` 查看状态；修改端口后重新 up。默认 Compose 仅启用三个基础依赖；`phase0.mjs up` 显式启用 app profile。只启动基础依赖可执行 `node scripts/infra.mjs up`。

## 配置与边界

| 变量 | 用途 |
| --- | --- |
| COMPOSE_PROJECT_NAME | 默认 structured-learning；并发 checkout 必须使用不同项目名和端口 |
| FRONTEND_PORT / BACKEND_PORT / STORAGE_PORT | 本机端口 3000 / 8000 / 9000；仅绑定 127.0.0.1 |
| POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD | 初始化数据库；已有卷不会随变量修改自动重设密码 |
| DATABASE_URL | `postgresql+psycopg://...@postgres:5432/...`；后端与 Alembic 共用；必须与数据库凭据一致 |
| REDIS_URL | Web 就绪检查，容器内 `redis://redis:6379/0` |
| CELERY_BROKER_URL / CELERY_RESULT_BACKEND | Redis DB 1 / DB 2；Web 和 Worker 独立入口 |
| SECRET_KEY / ENCRYPTION_KEY | SECRET_KEY 至少 32 字符；ENCRYPTION_KEY 是编码 32 字节的 URL-safe base64 |
| STORAGE_ENDPOINT / STORAGE_REGION / STORAGE_BUCKET | 容器内 http://storage:9000 / us-east-1 / learning-dev；Phase 0 不自动创建业务桶 |
| STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY | 本地开发 S3 管理凭据；STORAGE_SECRET_KEY 至少 32 字符 |
| WORKER_APP | `app.tasks:celery_app`，任务名 `phase0.smoke`，无参数，结果 `{"status":"ok"}` |
| DEPENDENCY_TIMEOUT | 每项就绪探测默认 1.5 秒，0.05–10 秒；数据库/Redis 并行执行 |
| BACKEND_INTERNAL_URL / BACKEND_TIMEOUT_MS | 仅前端服务器读取，默认 http://backend:8000 / 3000 毫秒；不使用 NEXT_PUBLIC 暴露配置 |

后端 Settings 集中校验配置，SecretStr 隐藏敏感值。前端只收到内部后端地址与超时，不收到数据库、S3 或应用密钥。代理重新构造受限响应，不转发上游额外字段和错误文本；上游不可达/超时返回 502 UPSTREAM_UNAVAILABLE，上游依赖不可用保留 503 DEPENDENCY_UNAVAILABLE。响应不缓存。

数据库/Redis 只加入 internal data 网络，不发布端口；storage 加入独立 storage-access 网络，仅发布 loopback。前端仅加入 app 网络；后端/Worker 连接 app 与 data，数据库连接不散落到路由。Compose 健康依赖保证启动时序；SQLAlchemy pre-ping、Redis 和 Celery 的重连及有限超时负责持续恢复。

S3 使用可替换的 RustFS 开发实现，因为尝试的 MinIO 历史官方镜像标签不可获取。应用不能依赖其管理 API。参考：[RustFS 容器](https://docs.rustfs.com/en/installation/container/docker)、[Docker 启动顺序](https://docs.docker.com/compose/how-tos/startup-order/)、[Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)、[FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/)、[SQLAlchemy asyncio](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)。

## 开发、迁移、测试与构建

前端，进入 frontend/：

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
```

宿主前端先设置 BACKEND_INTERNAL_URL 为 `http://127.0.0.1:8000`（PowerShell：`$env:BACKEND_INTERNAL_URL='http://127.0.0.1:8000'`）。容器内继续使用服务名。后端推荐直接使用容器，避免为宿主开发额外暴露数据库端口。

后端，进入 backend/，Python 3.14 + uv 0.12.5：

```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
```

独立容器入口，从仓库根：

```sh
docker compose run --rm --no-deps backend alembic upgrade head
docker compose run --rm --no-deps backend alembic current
docker compose build backend frontend
docker compose --profile test build backend-test frontend-test
docker compose run --rm --no-deps backend-test
docker compose run --rm --no-deps frontend-test
```

运行迁移前依赖必须健康。Phase 0 的唯一迁移 `0001_baseline` 不创建业务表，只有 Alembic 的版本表。Web 启动为 `uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log`；Worker 为 `celery -A app.tasks:celery_app worker --loglevel=INFO --concurrency=1`。本机直接启动后端需将环境注入进程，并将 DATABASE_URL、Redis URL、STORAGE_ENDPOINT 改为实际可达的宿主/托管地址；本项目默认不提供宿主数据库端口。

真实任务检查，在已启动环境执行：

```sh
node scripts/phase0.mjs smoke
```

独立 Web/Worker 导入不执行迁移。FastAPI lifespan 关闭 Redis 与引擎，会话退出关闭并回滚未提交事务；Worker 使用独立 Celery 连接，SIGTERM 给予 30 秒退出窗口。任务结果保留 300 秒；验收主动 forget。

自定义配置文件使用 `node -- scripts/phase0.mjs up --env-file .env.local`，smoke/down 同样传该文件。`node --` 终止 Node 自身参数解析；脚本内部以参数数组调用 Docker，兼容 Windows 原生命令参数传递，不需要在 PowerShell 内嵌 Python 引号。

## CI 等效整栈验收

```sh
node --test scripts/infra.test.mjs
node scripts/phase0.mjs verify
```

工作流 `.github/workflows/infra.yml` 运行上述相同命令：Node 检查，Linux 容器中的 Ruff/pytest、TypeScript/Vitest/生产构建，生产镜像构建、空库重复迁移、六服务健康、真实 Celery 结果、S3 读写/字节核对/删除/桶清理，以及依赖与上游故障恢复。测试容器不接网络，模拟测试不替代后续真实连接检查。

`verify` 创建 `p0c-verify-UUID` 项目、随机本机端口和独立卷，临时配置在 `.task-cache/p0c/`。成功或失败均在 finally 删除自己的容器、网络与卷，成功清理后删除配置。`verify --keep` 只在全部自动检查通过后保留项目用于浏览器验收，输出 URL 和临时配置路径；验收后必须按该精确 env/项目名删除自己的资源。中断时可通过保留的 env 文件找到项目，禁止全局 prune 或操作他人卷。

工作流只有仓库读取权限，没有镜像发布、部署或推送。远端 Actions 未触发时必须标为未运行；容器等效检查通过不代表远端执行成功。Git 交付和实际验收结论统一见 HANDOFF.md。

## 停止、数据与故障排查

```sh
node scripts/phase0.mjs down
```

日常 down 保留三个数据卷，再次 up 后仍可使用。只删除明确归属且无人依赖的测试卷。PostgreSQL、Redis AOF、S3 分别保存在项目 postgres-data、redis-data、storage-data 卷。课程学习记录不写入根 Markdown 开发文档。

- Docker command failed：检查 `docker info`、Compose 版本及官方镜像网络。脚本不转发可能带敏感配置的原始 Docker 诊断；手动使用同一 env/项目执行失败步骤定位，分享日志前脱敏。
- 页面“部分基础服务暂不可用”：查看同源 ready 响应和 `docker compose ps`，恢复 postgres/redis 后点击重新检查；不需要重启前端。
- 页面“服务暂时无法连接”：确认 backend 存活、BACKEND_INTERNAL_URL 和有限超时；停止 backend 时同源代理预期返回 502。
- 端口占用：改本环境的端口，再 up。当前 Engine 上内部网络仅加 ports 不会实际发布；存储另有访问网络，数据库/Redis 保持内部。
- 密码错误：不要重新 init 或删除开发卷；已有卷的用户密码需明确修改并同步 DATABASE_URL。init 不覆盖原凭据。
- 验证中断：只对 `.task-cache/p0c/p0c-verify-UUID.env` 对应的同名项目执行 `docker compose --env-file <该文件> --profile app --profile test down --volumes --remove-orphans`，再删除临时配置。
- 日志：后端记录自建请求 ID、方法、路由模板、状态和耗时，不记录正文、请求头、查询串、原始异常或连接串；响应含 X-Request-ID。Phase 0 没有用户、AI 工作流或模型调用日志。

当前配置用于本地开发；生产 TLS、最小权限存储身份、备份恢复、部署和回滚属于 Phase 9，尚未验收。Ruff/pytest/Vitest/生产构建、真实依赖与浏览器验收分别记录，不能相互替代。
