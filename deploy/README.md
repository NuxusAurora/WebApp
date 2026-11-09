# 腾讯云完整部署

运行正式产品源码及全部后端服务。现有 GPT Sites 是独立体验站，不作为此部署的后端。当前目标为 `ubuntu@111.229.103.70`，应用 `learn.nuxusaurora.com`，下载 `files.learn.nuxusaurora.com`；实际交付状态见 HANDOFF。

## 首次部署

先通过已配置的 SSH 密钥连接用户指定的服务器，只读核对系统、资源、Docker、原有服务和端口。使用独立目录和 Compose 项目；不得覆盖现有项目或其机密。部署工具使用 Node.js 24；服务器也可直接使用 Docker Compose 命令运行已验收镜像，无需安装 Node。要求 Linux Docker Engine 与 Docker Compose 2.24.4 或更高版本。

应用与签名下载使用两个不同的 HTTPS 主机名，例如 `learn.example.com` 与 `files.example.com`。将它们解析到该服务器，HTTPS 入口需要可访问 80/TCP、443/TCP；443/UDP 为 HTTP/3。数据库、Redis、后端、前端和存储管理端口不公开。若已有反向代理占用入口，先针对现有架构适配，不停用原服务。

在服务器的源码目录执行（参数替换为实际值）：

```sh
node scripts/production.mjs init --domain learn.example.com --storage-domain files.example.com --email ops@example.com
```

该命令以仅属主权限新建 `.env.production`，已有文件会拒绝覆盖，机密独立生成；不使用本地开发 `.env`。在服务器直接编辑 SMTP_HOST/PORT/USER/PASSWORD 和 MAIL_FROM；当前邮件客户端使用 STARTTLS，不能将隐式 TLS 465 端口当作 STARTTLS 使用。模型服务精确来源白名单初始为已授权的 `https://api.nuxusaurora.com`，页面实际连接地址仍需包含 `/v1`，模型密钥通过应用登录后配置。

```sh
node scripts/production.mjs check
node scripts/production.mjs up
node scripts/production.mjs status
```

`up` 先构建，再启动数据依赖、执行 Alembic 升级，最后启动应用和 HTTPS 代理。不会清空卷；应用启动健康不等于公网 DNS、证书和真实邮件已验收。不要打印完整 `docker compose config` 或把环境文件放入源码/聊天。

这台服务器已有 Nginx，生产命令须再加 `-f deploy/compose.nginx.yaml`；只映射 `127.0.0.1:13100` 的正式前端和 `127.0.0.1:13900` 的私有存储，Caddy 不启动。Nginx 配置源为 `deploy/nginx.conf.template`，保留 Host/路径/查询；文件入口仅允许下载方法。现有站点与数据库服务保持独立。Node 工具等效参数为 `--ingress nginx`，已验收预构建镜像可加 `--no-build true`。

预构建模式需在服务器环境中设置 FRONTEND_IMAGE / BACKEND_IMAGE 为已验收版本标签，POSTGRES_IMAGE / REDIS_IMAGE / STORAGE_IMAGE 为实际导入并核对的 `sha256:` 镜像 ID。Docker 导入摘要引用可能不保留原仓库名，不能假定原标签可用或自动从网络换取其他镜像。启动时使用 `--pull never`，镜像清单与 ID 保存于服务器 release.json。

用户明确选择邮件配置待补，部署可显式添加 `--allow-missing-mail true`；设置 ACCOUNT_NOTICE 告知登录页注册/找回暂不可用。公开环境缺少 SMTP 时返回明确的 503，不使用开发 outbox 假称邮件已发送。未来填入服务器 SMTP 配置并清空 ACCOUNT_NOTICE 后，仅重新创建 backend/worker/frontend；不删除卷。

单独的生产 Compose 命令前缀为：

```sh
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.production.yaml --profile app
```

## 验收与数据

检查应用域名的 HTTPS、`/api/v1/health` 与 `/api/v1/ready`，实际注册、收邮件、验证、登录、创建并刷新课程、上传 UTF-8 文本及通过下载域名取得私有签名下载。检查 Worker 真实任务与启用的模型连接。前端由同一份正式组件构建；账户与课程由云端数据库持久化，页面不使用体验站浏览器适配器。测试登录在生产构建和后端均强制关闭。

用户已选择云端新建数据库，保留本地数据；此轮不迁移本地账户、课程、文件或供应商密钥。云端账户通过正式注册/邮件验证创建。实际目标确认后补充执行记录。

持续备份应覆盖 PostgreSQL、storage-data 和生产环境密钥；备份应限制读取权限，并进行恢复验证。升级前保存当前源码/镜像引用与数据库/对象备份。保留旧镜像只能回退应用，不能自动回退不兼容的数据库迁移；失败时保留持久卷，禁止 `down --volumes`。

目前后端登录 IP 限流仍识别同源前端代理地址，未在本轮改造真实访客 IP 传播；大量并发用户需单独细化可信代理边界。真实 SMTP、模型供应商、腾讯云端口/DNS/TLS、远程资源与备份恢复均须在目标明确后验收，不把本地配置检查当作线上部署成功。

## 本地检查

```sh
node --test scripts/production.test.mjs
```

该测试验证域名输入、独立机密、禁止覆盖和生产 Compose 最终端口/网络/开关，不启动或修改当前开发服务。

依据：[Docker Compose 合并覆盖](https://docs.docker.com/reference/compose-file/merge/)、[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[代理 Host/URI 规则](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
