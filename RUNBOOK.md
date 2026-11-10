# 运行手册

## 知识点编辑与 AI 核对界面 · 2026-11-09

后续操作调整：核对按钮改“批准”，待核对事项始终完整显示，知识点默认折叠；工具栏不再提供重新加载或关闭编辑。底部“保存草稿”成功后原位显示禁用“草稿已保存”，修改后恢复；“确认无误”有待核对项时点击只提示toast，绿色可确认状态仍须先保存草稿。移除底部变更/模型依据展示；归档保护保留在确认区。105项前端回归及实际验收结果见HANDOFF最新节。

入口仍为 `/` → 课程详情 → 知识点 → 已确认小节。实现为 `frontend/components/knowledge.tsx`，局部样式 `frontend/styles/knowledge.css`；`course-space.tsx` 仅在知识点页增加 `knowledge-workspace` 作用域。该区域统一滚动，卡片折叠保持编辑值，定义/目标/标准文本框随内容和宽度增长。审核数量直接取草稿待核对项，展开显示完整原文；逐项核对后仍须保存，差异复核和显式确认规则保持。未新增服务、依赖或 API，原 check/test/build 命令继续适用；本次 104 项前端测试及运行验证限制集中见 HANDOFF 最新节。

## 教材目录上传入口 · 2026-11-09

课程详情→教材目录的空状态只显示“上传”。选择单张PNG/JPEG（最大5 MiB）后，自动选第一个已启用且明确支持图片的模型，上传后直接识别成待核对草稿；确认流程保持。模型下拉、图片选择列表、OCR/文字备用和手动新建入口已移除，旧图片/后端接口不删除。实现仍为 `frontend/components/curriculum.tsx`，按钮样式限 `.curriculum > .curriculum-upload`。原前端check/test/build命令继续适用，本轮90项测试及实际验收边界见HANDOFF最新节。

## 新建课程局部视觉 · 2026-11-09

`/` → 新建课程使用 `frontend/styles/course-create.css`，由 `app/layout.tsx` 在共享UI样式后导入。`course-space.tsx` 仅在新建状态提供 `course-create-page` 类，外壳通过 `:has()` 限定局部Token；编辑及其他页面沿用共享设计系统。新建内容上限1040px，普通桌面控件50px，短屏48px，手机纵排；详情和编辑入口未变。验证继续使用原check/test/build命令；本轮清单、截图与限制见 `docs/verification/course-create-visual-20261109/README.md`。

## 课程 UI 设计系统 · 2026-11-09

追加：课程页不再提供独立返回按钮；顶部面包屑的“我的课程”返回列表，编辑时可点课程名回详情，保留未保存确认及保存期间禁用。当前前端测试 86 项。导航快照与受保护回调由 CourseSpace 提供，Workspace 负责顶部呈现。

当前入口仍为 `/` → 新建课程；新建/编辑共用 800px 标准表单，桌面双列、手机单列，取消/保存按内容宽度右对齐。Token 来源为 `frontend/styles/tokens.css`，原共享类名与新公共组件统一由 `frontend/styles/ui.css`、`frontend/components/ui.tsx` 维护。容器 640/800/1120/full，使用方式见 DESIGN.md 最新 Overview。后续页面复用这些组件，不另建主题/控件体系。检查继续使用 frontend 中 `npm run check`、`npm test`、`npm run build`；当前 86 项测试。截图、文件清单和实际验收限制见 `docs/verification/course-design-system-20261109/README.md`。

## 当前导航外壳 · 2026-11-09

Workspace 与 /system 共用 frontend/components/app-sidebar.tsx；样式在 components/sidebar.css，经 globals.css 引入；URL/历史同步在 lib/workspace-navigation.ts。入口为 /（课程）、/?view=ai（模型）、/?view=profile（账户）、/system（原连接检查），刷新保持对应选中。侧栏 248/64px，折叠偏好仅保存浏览器 learning-workspace.sidebar-collapsed 布尔值；无偏好时 741–1100px 默认收起，<=740px 默认隐藏、由顶部菜单打开原生模态抽屉。账户区菜单提供现有账户设置和退出，无新增账户切换。未保存保护仍生效。

原 ConnectionStatus 的 health/ready 与重试逻辑不变，不在侧栏伪造在线状态。验证仍在 frontend 执行 npm run check / npm test / npm run build（当前 81 项）；前后截图、文件清单和实际验收限制见 docs/verification/sidebar-20261109/README.md。早期布局章节中的 220/260px 和手机顶部平铺导航为历史状态，以本节为当前规范。


## 腾讯云正式应用

正式入口为 [学习工作台](https://learn.nuxusaurora.cn)，前端、后端、Worker 和数据服务均运行于腾讯云。用户选择新建云端数据库并保留本地数据，SMTP 暂待配置，注册/找回暂不可用。实际目录、配置来源、验收、邮件/证书/升级/备份及限制集中见 [deploy/README.md](deploy/README.md) 和 [部署回执](deploy/production.json)。既有公开 Sites 仍为独立体验站。

## GPT Sites 公开体验入口

[公开体验版](https://learning-workbench-public.jacky2007a.chatgpt.site) 为 public，点击“测试登录”即可试用，使用独立示例和浏览器存储。正式版 localhost:3000 仍连接原后端。公开版的更新、测试、来源和限制集中见 sites-demo/README.md；托管身份和发布回执见该目录 .openai/hosting.json 与 publication.json。复用现有 Site ID，不重复创建站点。

## 账户页、主题与开发测试账户

账户页入口仍为工作台“账户设置”：五项统计暂未接入，修改邮箱按用户确认禁用；昵称和密码通过短表单及原有 API 修改。主题通过 prefers-color-scheme 自动跟随系统；成功提示为黄绿色淡入淡出气泡，减少动态下保留提示时间。

测试登录默认关闭。在仅供本地开发的 .env 中设置 `TEST_LOGIN_ENABLED=true`，重新构建前端并更新 backend/frontend 后，登录页显示“测试登录”，点击进入固定普通测试账户。后端还要求 PUBLIC_ORIGIN 的主机为 localhost/127.0.0.1/::1；关闭或非本地配置返回 404。入口不包含密码，复用正常 12 小时会话和隔离规则，不覆盖同名邮箱。此账户和其学习内容保留供用户开发测试；无需读取验证码。关闭开关后同样重建前端以隐藏入口。单独运行前端时还需构建变量 `NEXT_PUBLIC_TEST_LOGIN_ENABLED=true`。

本机 localhost:3000 已启用 TEST_LOGIN_ENABLED=true；登录页点击“测试登录”直接进入独立测试账户。普通环境仍默认关闭。

账户页回归覆盖默认关闭、非本地拒绝、邮箱冲突、限流和测试账户隔离。当前测试总数及视觉验收范围见 HANDOFF.md 的最新阶段。

## 前端工作台与学习目标

课程首页仅展示学习中课程，搜索/新建/列表/分页共用一个容器；点击绿色“进入”显示全宽详情，“返回”回到列表。归档通过编辑课程状态保存，恢复入口在“账户设置 → 归档资料 → 恢复学习”。归档组件为 frontend/components/archived-courses.tsx，复用现有 courses 分页读取与 PATCH status，不改后端；分页与搜索继续作用于原 API 的每页 100 条记录，归档页可能显示“本页暂无归档资料”，可继续翻页。回归在 frontend/tests/course-workspace.test.tsx。

保存成功通知由 frontend/components/toast.tsx 统一提供局部 hook 和展示组件：课程与个人资料保存成功显示 3 秒黄绿色气泡，淡入淡出，手动关闭经过 180ms 淡出；减少动态时关闭动画，错误保持原位。测试覆盖重复通知和定时器退出清理。

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
- 日志：后端记录自建请求 ID、方法、路由模板、状态和耗时，不记录正文、请求头、查询串、原始异常或连接串；响应含 X-Request-ID。验证码、密码、会话令牌均不写入日志；尚无教学工作流，模型审计见 Phase 2。

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

## Phase 3 教材目录

标题列表默认折叠：点击大标题展开，小标题宽度为大标题一半，序号随位置重排；名称单行省略，鼠标悬停显示全文。拖动左侧手柄排序，章节连同小节移动，小节可移到其他章节（落到章节行末尾或指定小节前后）。正式目录拖动进入草稿，不自动应用；保存并确认后持久化。右键标题行或点击行尾操作菜单：重命名在行内完成，大标题额外提供“添加小标题”；页码、上移/下移、移除在菜单中，所属章节在“编辑页码”内。编号只由当前位置生成，不进入名称输入框，导入的“第2章 / §2.1”等旧前缀在显示和保存时剥离；名称处理见 frontend/lib/curriculum-title.ts。支持 Shift+F10、菜单方向键、Enter 完成和 Escape 取消重命名；菜单随外部点击/滚动/禁用关闭。新增 UI 为 frontend/components/curriculum-outline.tsx，纯排序在 frontend/lib/curriculum-order.ts；后端 service 确认时保留小节 ID、页码并更新 chapter_id，旧版本快照不变。无需迁移；回归见 curriculum-outline.test.tsx、curriculum.test.tsx 与 backend/tests/test_curriculum.py。

当前课程详情提供“课程概览 / 教材目录 / 知识点”。学习资料页签及前端读取已移除；既有文本文件及上传后端接口保留，目录图片上传不受影响。

入口：课程详情 → 教材目录。上传 PNG/JPEG，每张 1 字节至 5 MiB、最多 1600 万像素；图片经解码、纠正 EXIF 方向和重新编码为 PNG 后进入私有存储。每批按勾选顺序识别最多 5 张图片；单张 OCR 35 秒、整批 120 秒上限。Tesseract chi_sim+eng 随后端 Docker 镜像安装，通过管道处理，无本地临时图片。原有学习资料 .txt 的 1 MiB 限制不变。

推荐流程：在模型设置中确认模型支持图片识别，上传/勾选目录图片并点击“模型识别目录”。所选图片以高细节内嵌图片连同目录 Prompt 和 JSON Schema 发送给所选模型，按图片直接提取，不经过本地 OCR。图片模式每个对象的全部字段均为必需项，未知页码显式 null；服务支持原生 JSON Schema 时启用 strict，另有 Gateway/目录校验和最多两次修复。JSON 格式有效不代表事实必然准确，草稿仍须核对。默认接口的 gpt-6.1-sol 已以用户实拍验证图片能力并启用，其他模型不按名称推定。

“从文字整理（备用）”保留本地 OCR、文字核对/粘贴和文字生成；该模式不发送图片。也可直接手动编辑。章节/小节支持标题、排序和起止页码，未知页码留空；页码为 1–100000，结束页不早于起始页。模型不确定项须逐项核对、保存，再确认。保存草稿不会改变正式目录。确认应用时核对新增/修改/归档项；有归档必须显式勾选确认。再次编辑正式目录会建立新草稿，使用现有 UUID 保留节点；重新识别使用临时 ID，不按相同标题自动匹配。

编辑器只保留一份当前草稿：进入或重新加载自动恢复最新草稿，关闭后“手动编辑目录”继续该草稿；去掉历史版本选择和模型/草稿修订信息。新建或模型重新生成成功后，已有草稿转为 SUPERSEDED，旧草稿不可再编辑或首次确认；失败保留原草稿，历史快照及审计仍在数据库，无需迁移。

API 前缀 `/api/v1/courses/{id}/curriculum`：GET 返回正式结构、confirmed_revision 与 versions 数组（仅最新 DRAFT，最多一份，确认后为空；兼容旧库多草稿时只读取最新）；GET/POST images 为独立目录图片；POST ocr 接收 image_ids；POST parse 接收 input_mode（images 或 text，默认 text）、ocr_text、image_ids、provider_id、model_id，图片模式要求 1–5 个归属当前课程的图片 ID 和视觉能力，文字模式要求非空 ocr_text。POST drafts 接收 payload 与 base_course_revision；PATCH 接收 version_id、revision、base_course_revision、payload；POST confirm 接收前三个版本字段与 accept_archives。图片下载/删除复用所有者校验的 uploads/{id} 入口；学习资料列表不混入图片。

迁移 `0004_curriculum` 接在 `0003_ai_gateway` 后，建立 chapters、sections、structure_versions、workflow_runs、structure_events，并扩展 uploads。版本和正式修订分别校验，课程行锁串行化草稿替代与确认；重复确认返回首次结果。旧确认版本转 SUPERSEDED，替代草稿同时记录 REPLACED 事件；移除节点归档。来源、原始输出、模型/Prompt、校验与工作流失败状态留在私有数据库，不写应用日志；用户修改不覆盖原始来源。`0005_knowledge` 扩展小节知识版本和知识点归档，目录接口只消费 CURRICULUM 类型。

源码：`backend/app/curriculum/`、`backend/prompts/curriculum/parse-v1.md`、`backend/prompts/curriculum/vision-v1.md`、`frontend/components/curriculum.tsx`、`frontend/lib/curriculum.ts`。通用图片契约在 backend/app/ai/contracts.py，wire 编码在 adapters.py，仅允许有界内嵌 PNG/JPEG；图片不进入公开审计或来源 JSON，仅记录图片 ID。OCR 从 app.state.curriculum_ocr 注入；Gateway 和存储由组合根复用，不反向依赖目录领域。协议参考：[图片输入](https://developers.openai.com/api/docs/guides/images-vision)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)。

验证：`uv run --directory backend pytest -q`、对应 Ruff 检查；在 frontend 运行 npm run check / npm test / npm run build；`node --test scripts/infra.test.mjs scripts/production.test.mjs`。`node scripts/phase0.mjs verify` 自动运行 Phase 3 的真实 PostgreSQL 迁移往返/元数据、私有 S3 图片、中文 OCR、协议 fixture、草稿修订冲突、并发确认、隔离和重启持久化验证。fixture `scripts/fixtures/calculus-toc.png` 是合成高数目录，生成源码 render-curriculum.py（参数为 CJK 字体路径与输出路径）；不是教材实拍。协议 fixture 不代表真实模型质量，实际效果与视觉限制见 HANDOFF。

生产 Nginx 模板已支持 5m 请求和 185 秒代理超时；本轮未修改云端正在运行的配置。部署需单独执行项目部署流程。

## Phase 2 本地 OpenAI 兼容模型

默认接口：新建连接的地址预填 https://api.nuxusaurora.com/v1，密钥由用户填写后通过原 API 加密保存，不在源码分发。在“连接与密钥”选择已保存且启用的连接，点击“设为默认连接”；当前浏览器按账户记住连接 ID，下次进入模型设置自动选中。失效或其他账户 ID 不使用，密钥不进入浏览器偏好。当前本地账户已按用户授权添加独立“默认接口”，真实模型列表读取 200/32 项；具体配置仅保留在加密数据库。

模型发现：选择已保存且启用的连接，进入“模型与测试”即自动读取“服务模型”，可刷新、选择后保存。GET /api/v1/ai/providers/{id}/discovery 对该服务的 /models 只读请求，仅填入服务明确提供的上下文/能力；未知项可手工补充或保存后显式测试。实现位于 backend/app/ai/discovery.py、adapters.py、service.py、routes.py 与 frontend/components/ai-settings.tsx；测试见 backend/tests/test_model_discovery.py 和前端 ai-settings/business-proxy 测试。认证/权限拒绝时检查该连接的密钥与服务权限，不会自动更换凭据。

入口：登录后“模型设置”，依次填写“连接与密钥 → 模型与测试”。密钥可留空；已有密钥在编辑时留空保留，可单独删除。更换地址必须重新输入或先删除密钥，防止把旧密钥发送给新地址。密钥以 Fernet 认证加密保存，读取只返回 has_api_key。保留现有 ENCRYPTION_KEY；轮换应用加密主密钥需要独立重新加密迁移，本阶段不提供自动迁移。

- 默认允许 localhost、127.0.0.1、host.docker.internal 的 1234/11434 端口。Docker 内 localhost 指容器自身，宿主机服务通常填写 `http://host.docker.internal:1234/v1` 或 `:11434/v1`。实际模型需自行运行并允许容器访问，应用不下载或启动模型。其他端口在既有 `.env` 添加 `AI_ALLOWED_ORIGINS`：逗号分隔的精确源（scheme://host:port，不含 /v1），然后重启后端，保留原凭据。仅允许可信本地服务；禁止重定向和环境代理。
- 迁移 `0003_ai_gateway` 接在 0002 后，增加 ai_providers/ai_models/ai_call_logs。`node scripts/phase0.mjs up` 升级现有数据库。降级到 0002 删除 AI 配置/日志，只在明确可丢弃的隔离库执行。
- `GET /api/v1/ai/options`：允许地址；`GET/POST /ai/providers`；`PATCH/DELETE /ai/providers/{id}`；`DELETE /ai/providers/{id}/key`；`POST /ai/providers/{id}/models`；`PUT/DELETE /ai/models/{id}`。沿用会话、同源写请求校验及所有者隔离。
- `POST /ai/models/{id}/test`，正文 `{"kind":"chat"}`、stream 或 structured。仅发送固定测试内容，使用本地算力；探测与用户确认分开。改地址/密钥/模型/能力清除旧结果；网络期间变更的配置不能被旧探测标记通过。视觉/工具能力不按名称猜测；本阶段只接收文本。
- `POST /ai/calls`：provider_id、model_id、messages（role/content）、task_type、task_context、可选 output_schema、prompt_version、timeout（默认 60，最大 120 秒）、retry_policy.max_retries（0–2）、max_output_tokens（16–8192）。响应含 text、structured、usage 和 log_id。task_context 由工作流传入，Adapter 不读课程或学习策略。无原生 Schema 能力时用文本 JSON 校验及最多两次修复。未知 Token 为 null，不估算费用/上下文占用；分词和上下文压缩留到后续阶段。
- `POST /ai/calls/stream` 为 SSE，data 含 text/usage/done/log_id；done 仅在上游完整结束且审计保存后发出，失败为 event:error。取消关闭上游，已发文本后不重试，不把截断流当成功。代理不缓冲流，最长 125 秒。普通 HTTP 受总超时限制，浏览器离开不保证立即停止已开始的非流式计算。
- `GET /ai/calls?offset=0` 每页最多 100 条，保存当次名称快照、版本、状态、耗时、尝试数、Token 和安全错误码，无正文、回复或密钥。进程崩溃后 RUNNING 可能留存，不能视为成功，自动恢复不在本阶段。

源码：`backend/app/ai/`、版本为 gateway-v1 的 `backend/prompts/gateway/*`、`frontend/components/ai-settings.tsx` 和既有同源代理。模型与课程领域互不写入。实施约定见 `docs/plans/phase-2-implementation.md`。

验收仍为 `node --test scripts/infra.test.mjs` 与 `node scripts/phase0.mjs verify`，后者含 `scripts/phase2-acceptance.mjs`。只对 p0c-verify-* 项目做迁移回退，复制 `scripts/fixtures/phase2-check.py` 和 `local-model.py` 到隔离容器 /tmp，经真实 HTTP 验证协议；fixture 不是 AI 推理服务，不进入运行镜像。成功/失败按原 finally 清理，--keep 仅供浏览器检查。真实模型质量未测，视觉限制见 HANDOFF。

## Phase 4 首条闭环：小节知识点

入口：课程详情 → 知识点。先在教材目录确认小节，选择小节后用首个已启用连接中的首个启用模型生成知识草稿；当前浏览器的默认连接偏好不参与自动选择。按用户最新要求直接使用模型自身知识，不配置或调用搜索服务。输入包括学科、教材名、小节/章节标题、相邻小节、页码、课程目标及已有正式知识点；页码/教材名仅用于范围判断，没有读取教材正文。knowledge-extract-v2 明确基础到应用顺序、三档目标深度及不确定内容处理，不生成网页或原文引用。也可手动编辑。名称、定义、学习目标、重要程度和掌握标准可修改，目标/标准每行一项。保存只写草稿，清除并保存待核对项后，通过 核对并确认知识点 → 确认应用知识点写入正式表。

重新生成和从过期草稿重建都要求明确替换；失败保留原草稿。显式匹配已有UUID才能保留身份和学习状态，模型不写学习状态。新增节点初始化NOT_STARTED；内容实质改变显示复核掌握状态提示。移除知识点及目录小节均采用确认后归档，目录差异列出受影响知识点；没有依赖关系处理或教学流程。

API前缀 /api/v1/sections/{section_id}/knowledge-points：GET返回confirmed_revision、正式knowledge_points和draft；POST generate接收provider_id、model_id、base_course_revision；POST drafts接收payload及基线。已有草稿替换须附replace_version_id/replace_revision。PATCH接收version_id、expected_revision、base_course_revision和payload；POST confirm接收前三个版本字段及accept_archives。payload使用knowledge_points数组（最多50项；手动移除可空），每项temp_id、existing_knowledge_point_id（新增为null）、title、description、learning_objectives、importance（HIGH/MEDIUM/LOW）、mastery_criteria，以及uncertain_items。草稿revision与课程confirmed_revision不符返回409；跨小节/账户引用拒绝。只提供小节级读写/确认，单点入口和通用结构版本浏览留后续。

生成版本 source 保留 knowledge_basis=model_knowledge、模型名称、Prompt 版本及生成上下文；正式知识点 GET 仅返回来源类型/依据/模型/Prompt 元信息，界面显示生成依据。旧版本兼容，不据此声称事实已经核验。生成期间课程标题/学科/教材/学习目标变化将拒绝迟到结果，旧草稿保留。无需新增依赖、凭据或数据库迁移。

迁移0005_knowledge接0004，保留现有目录数据，扩大共享版本类型约束及分范围唯一索引、新建knowledge_points。降级时如已有知识版本历史会拒绝执行，以免静默丢数据；勿在用户库回退。源码：backend/app/knowledge、backend/prompts/knowledge/extract-v2.md（v1保留历史）、frontend/components/knowledge.tsx及frontend/lib/knowledge.ts。Knowledge服务只依赖目录模型，目录通过其查询/归档函数协调，不反向调用目录服务。

验证：node scripts/phase0.mjs verify在隔离p0c-verify-*栈运行迁移、测试与scripts/phase4-acceptance.mjs；覆盖真实Gateway协议fixture、PostgreSQL并发、跨范围/租户隔离、幂等、ID与重启持久化。fixture不是AI推理质量验收；本次实际结果与视觉限制集中见HANDOFF最新节。
