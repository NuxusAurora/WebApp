# 运行手册

## GPT Sites 公开体验入口

[公开体验版](https://learning-workbench-public.jacky2007a.chatgpt.site) 为 public，点击“测试登录”即可试用，使用独立示例和浏览器存储。正式版 localhost:3000 仍连接原后端。公开版的更新、测试、来源和限制集中见 sites-demo/README.md；托管身份和发布回执见该目录 .openai/hosting.json 与 publication.json。复用现有 Site ID，不重复创建站点。

## 账户页、主题与开发测试账户

账户页入口仍为工作台“账户设置”：五项统计暂未接入，修改邮箱按用户确认禁用；昵称和密码通过短表单及原有 API 修改。主题通过 prefers-color-scheme 自动跟随系统；成功提示为黄绿色淡入淡出气泡，减少动态下保留提示时间。

测试登录默认关闭。在仅供本地开发的 .env 中设置 `TEST_LOGIN_ENABLED=true`，重新构建前端并更新 backend/frontend 后，登录页显示“测试登录”，点击进入固定普通测试账户。后端还要求 PUBLIC_ORIGIN 的主机为 localhost/127.0.0.1/::1；关闭或非本地配置返回 404。入口不包含密码，复用正常 12 小时会话和隔离规则，不覆盖同名邮箱。此账户和其学习内容保留供用户开发测试；无需读取验证码。关闭开关后同样重建前端以隐藏入口。单独运行前端时还需构建变量 `NEXT_PUBLIC_TEST_LOGIN_ENABLED=true`。

本机 localhost:3000 已启用 TEST_LOGIN_ENABLED=true；登录页点击“测试登录”直接进入独立测试账户。普通环境仍默认关闭。

当前回归：前端 30 项、后端 30 项、工具 5 项。测试配置同时覆盖默认关闭、非本地拒绝、邮箱冲突、限流及测试账户隔离。视觉验收范围与限制见 HANDOFF.md。

## 前端工作台与学习目标

保存成功通知由 frontend/components/toast.tsx 统一提供局部 hook 和展示组件：课程与个人资料保存成功显示 3 秒黄绿色气泡，淡入淡出，手动关闭经过 180ms 淡出；减少动态时关闭动画，错误保持原位。`npm test` 当前共 30 项，覆盖重复通知和定时器退出清理。

用户当前主验收尺寸为 3200×2000、浏览器 100% 缩放。界面固定视口，长课程/资料只在列表内滚动；窄屏从目录进入详情并可返回，资料内容在“学习资料”页签，账户设置在“个人资料/登录安全”切换。登录页已移除介绍区。

当前课程目录、详情/编辑及文件选择分别位于 frontend/components/course-space.tsx、course-editor.tsx、course-files.tsx；三档学习目标统一定义在 frontend/lib/learning-goals.ts，保存到现有 learning_goal。AI 难度策略实施与验收见 docs/plans/learning-difficulty-plan.md；目前没有模型请求。

设计规范为 DESIGN.md；共享颜色、布局、焦点与 corner-shape 在 frontend/app/globals.css。连续角在支持的引擎启用；不支持引擎的普通圆角只作为兼容回退。前端验证命令为 `npm run check`、`npm test`（30 项）和 `npm run build`。仅更新前端时从根执行 `docker compose --profile app build frontend` 和 `docker compose --profile app up -d --no-deps --wait frontend`；本轮测试登录同时涉及后端，按上节更新前后端，不重启数据库。

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

- 页面：[http://localhost:3000](http://localhost:3000) 为账户/课程工作台；[连接状态](http://localhost:3000/system) 的初次检查与“重新检查”请求同源 health/ready。
- API：[http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)、[ready](http://localhost:8000/api/v1/ready)、[OpenAPI](http://localhost:8000/docs)。
- S3 API：`http://127.0.0.1:9000`；控制台关闭。Phase 1 经后端上传纯文本并取得短期签名下载链接。

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
| STORAGE_ENDPOINT / STORAGE_REGION / STORAGE_BUCKET | 容器内 http://storage:9000 / us-east-1 / learning-dev；首次上传创建私有业务桶，不修改桶策略 |
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

运行迁移前依赖必须健康。`0001_baseline` 保留为空基线；新迁移 `0002_users_courses` 创建 users、auth_tokens、courses、uploads，与运行时 ORM 独立冻结，支持回退至空基线。Web 启动为 `uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log`；Worker 为 `celery -A app.tasks:celery_app worker --loglevel=INFO --concurrency=1`。本机直接启动后端需将环境注入进程，并将 DATABASE_URL、Redis URL、STORAGE_ENDPOINT 改为实际可达的宿主/托管地址；本项目默认不提供宿主数据库端口。

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

工作流 `.github/workflows/infra.yml` 运行上述相同命令：Node 检查，Linux 容器中的 Ruff/pytest、TypeScript/Vitest/生产构建，生产镜像构建、空库重复迁移、六服务健康、真实 Celery 结果、S3 读写/字节核对/删除/桶清理，以及依赖与上游故障恢复。现有 `phase0.mjs verify` 兼容入口同时调用 `phase1-acceptance.mjs`，验证真实注册/邮箱令牌并发消费/会话、两用户课程和上传全接口隔离、浏览器 Origin、私有对象和可用签名下载、重启持久化及对象清理。测试容器不接网络，模拟测试不替代真实连接检查。

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
- 日志：后端记录自建请求 ID、方法、路由模板、状态和耗时，不记录正文、请求头、查询串、原始异常或连接串；响应含 X-Request-ID。验证码、密码、会话令牌均不写入日志；尚无 AI 工作流或模型调用日志。

## Phase 1 账户、课程与文件

源码：`backend/app/auth.py`、`models.py`、`security.py`、`mail.py`、`courses.py`、`storage.py`；前端 `components/account.tsx`、`profile.tsx`、`course-space.tsx`，同源代理 `lib/business-proxy.server.ts`。实施约定见 `docs/plans/phase-1-implementation.md`。

- 注册输入 email/password/display_name；密码 12–128 字符，使用 Argon2id。邮件一次性 token 在页面“验证邮箱”输入，30 分钟过期；重发使旧 token 作废，验证前不可登录。
- 登录设置 `learning_session` HttpOnly、SameSite=Strict Cookie，最长 12 小时；数据库只存 token 的 SHA-256 摘要。退出撤销当前会话；修改/重置密码撤销全部会话及待用 token。登录按账户及连接来源限流，每 10 分钟最多 10 次；代理后的来源是前端服务连接地址，部署时需按拓扑调整更细粒度限流。
- `.env` 未配置 SMTP_HOST 时，邮件写入后端容器 `/tmp/learning-outbox/*.json`，仅服务用户可读。开发者可用 `docker compose exec backend sh -c 'cat /tmp/learning-outbox/*.json'` 查看本地测试验证码，不要共享原始文件。容器重建会丢弃 outbox，页面可重发邮件。
- 外部邮件显式配置 SMTP_HOST/PORT/USER/PASSWORD 和 MAIL_FROM；强制 STARTTLS。已验证本地 outbox 和 SMTP 调用契约，未向真实邮箱发送或联调外部 SMTP。
- COOKIE_SECURE 默认 false，仅供本机 HTTP；HTTPS 环境设 true。PUBLIC_ORIGIN 是直接访问后端时的可信来源，默认 `http://localhost:3000`。前端代理比较浏览器 Origin 与请求 Host，不信任 X-Forwarded-Host；所有写请求要求 `X-Requested-With: structured-learning`。不开跨域凭据访问。
- 课程新建只接受 title/subject/textbook/learning_goal，更新另允许 active/archived；不能写 user_id、confirmed_revision 或角色。资料更新只允许 display_name。任何角色均只能访问自己的课程；本阶段不提供管理员后台或公开角色提权接口。
- GET `/api/v1/courses?offset=0` 每页最多 100 条；POST 集合路径新建，GET/PATCH/DELETE `/api/v1/courses/{id}` 读取、修改、删除。删除前页面明确确认，并清理所属 S3 文件。
- POST `/api/v1/courses/{id}/uploads` 接收原始 UTF-8 内容，`X-Filename` 为 URL 编码的 `.txt` 文件名，不用 multipart。限制 1 字节至 1 MiB；拒绝路径、二进制、控制字符、活动内容及已知恶意测试标记。这是受限文本检查，不是通用杀毒；PDF、图片和二进制上传未开放。上传失败回滚数据库并尝试删除对象；存储同时不可达时补偿删除可能失败，需运维核对孤立对象。
- GET uploads 返回文件列表；GET `/courses/{course_id}/uploads/{upload_id}/download` 校验归属后返回 `{url, expires_in:60}`；DELETE 同一文件路径删除文件。STORAGE_PUBLIC_ENDPOINT 必须是浏览器可访问的 S3 根地址，默认 `http://127.0.0.1:9000`；修改 STORAGE_PORT 时同步调整。签名链接在有效期内可由持有者访问，参见 [S3 官方说明](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)。隔离验收自动发现随机端口，整栈重启后重新配置签名地址。

日常启动仍为 `node scripts/phase0.mjs up`；不需要重建 `.env`，新增配置有开发默认值。旧 Phase 0 卷执行新迁移即可；不得覆盖 `.env` 中原有凭据。

当前配置用于本地开发；生产 TLS、最小权限存储身份、备份恢复、部署和回滚属于 Phase 9，尚未验收。Ruff/pytest/Vitest/生产构建、真实依赖与浏览器验收分别记录，不能相互替代。
