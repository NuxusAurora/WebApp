# 腾讯云正式应用

正式入口：https://learn.nuxusaurora.cn 。使用正式 Next.js、FastAPI、Worker、PostgreSQL、Redis 和私有 S3 存储；不是 Sites 浏览器体验适配器。用户选择云端新建数据库，保留本地服务和数据。SMTP 尚未配置，注册和找回密码明确显示暂不可用；未迁移本地账户或供应商密钥。

## 实际部署

- 服务器：ubuntu@111.229.103.70，Ubuntu 24.04，2 GiB 内存。使用本机既有 SSH 密钥 nuxusaurora.pem；不复制私钥到服务器或仓库。
- 独立目录：/opt/learning-workbench；当前源码快照位于 current 链接。项目名 learning-cloud，独立 PostgreSQL/Redis/storage 持久卷。
- 运行环境：/opt/learning-workbench/.env.production，仅 root 可读写。机密在服务器独立生成，不使用本机 .env。
- 当前镜像源为 7c70e0a，源码发行基线 abf79c5；部署覆盖文件与运维文档另行同步并按摘要记录。实际镜像 ID、配置来源及域名以 /opt/learning-workbench/release.json 为准，不能根据目录名猜镜像版本。
- Nginx 复用服务器既有实例，仅增加 /etc/nginx/sites-available/learning-workbench.conf；其他站点配置保留。正式前端 13100、存储 13900 仅监听 loopback，数据库/Redis/后端不发布宿主端口。
- DNSPod 的 learn A 记录指向 111.229.103.70，用户已配置。正式入口直连腾讯云，不依赖本轮曾试用的 .com Cloudflare 代理；临时 .com DNS/规则均已撤销。

## 运维命令

服务器无需安装 Node；使用已导入并核对摘要的镜像，禁止升级时隐式替换为网络镜像。先在 SSH 会话定义命令：

~~~sh
workbench_compose() {
  sudo docker compose --env-file /opt/learning-workbench/.env.production \
    -f /opt/learning-workbench/current/compose.yaml \
    -f /opt/learning-workbench/current/deploy/compose.production.yaml \
    -f /opt/learning-workbench/current/deploy/compose.nginx.yaml \
    --profile app "$@"
}
workbench_compose ps
workbench_compose run --rm --no-deps --pull never backend alembic upgrade head
workbench_compose up -d --no-build --pull never --wait --wait-timeout 180
~~~

源码配方：compose.production.yaml 为独立生产覆盖层，compose.nginx.yaml 支持现有 Nginx；Caddy 模式仍可用于独占 80/443 的新机器，本服务器不启动 Caddy。Nginx 配置源为 nginx.conf.template，渲染 APP_DOMAIN、CERT_NAME、STORAGE_BUCKET、WEB_PORT 和 STORAGE_PORT。当前桶为 learning-cloud，私有签名下载经过同域 /learning-cloud/ 路径，保留 Host/路径/查询，并移除账户 Cookie/Authorization、设置 private,no-store；不开放桶写入或公开读取权限。

在有 Node.js 24 与 Docker 的构建机可用 scripts/production.mjs init/check/up/status。初始化拒绝覆盖现有环境；Nginx 模式追加 --ingress nginx，预构建可加 --no-build true。该模式的 STORAGE_DOWNLOAD_ORIGIN 必须等于应用 HTTPS 源。未配置邮件时只有用户明确授权才使用 --allow-missing-mail true，检查结果会标明延期，不伪称投递成功。

## 邮件、模型与证书

使用 sudoedit /opt/learning-workbench/.env.production 填入 SMTP_HOST/PORT/USER/PASSWORD、MAIL_FROM，清空 ACCOUNT_NOTICE，再重新创建 backend/worker/frontend。当前客户端使用 STARTTLS；不要将隐式 TLS 465 当作 STARTTLS。未配置 SMTP 的公开环境返回 MAIL_NOT_CONFIGURED/503，事务回滚；localhost 开发 outbox 保留。不要把密码或完整环境内容发到聊天/日志。

模型服务精确白名单目前为 https://api.nuxusaurora.com；登录后的连接地址包含 /v1。云端模型连接从空库开始，密钥使用云端独立 ENCRYPTION_KEY 加密。本轮只验证配置保存/加密与持久化，没有调用真实供应商。

证书：/etc/letsencrypt/live/learning-workbench-cn，覆盖 learn.nuxusaurora.cn，采用 HTTP webroot 自动续期。证书 UTC 到期 2027-02-07 03:49:49，即洛杉矶时间 2027-02-06 19:49:49。限定此证书的 deploy hook 会校验并 reload Nginx；续期干跑已成功。

~~~sh
sudo certbot renew --cert-name learning-workbench-cn --dry-run --run-deploy-hooks
~~~

## 验收与限制

4 项部署工具、38 项前端、49 项后端测试及格式/类型/生产构建通过。云端真实验证 HTTPS、安全会话/CSRF、SMTP 缺失明确失败并回滚、课程与私有文本上传/签名下载、模型连接配置、Worker 任务，以及六服务重启后会话/课程/文件/连接持久化。临时用户、课程、文件和连接均已移除；最终数据库用户/课程/资料/供应商数量为 0，迁移版本 0003_ai_gateway。浏览器 1280×720 实查正式登录与连接状态，正文 14px/300、标题 400、炭灰背景，无测试登录或体验栏；未新增其他分辨率/浅色验收。

配置边界复查通过：前端仍经既有同源 API，环境仅提供账户状态提示；生产覆盖层控制入口，数据库网络独立；私有 S3 保持签名授权和禁止缓存，公开无 SMTP 时不使用开发假投递。范围限本次及直接调用链，无独立评审。

尚未配置 SMTP/真实模型或定时备份，未做灾难恢复演练；新空库没有可用账户，邮件配置后通过正式注册/验证创建。当前登录 IP 限流仍识别同源前端代理地址，大规模多用户需单独完善可信访客地址传播。当前部署不代表 Phase 3 内容解析已实现。

## 升级、备份与回退

升级前保存已验收镜像 ID，并对 PostgreSQL、storage-data 及生产环境/加密密钥做受限备份。数据库与文件需一致恢复，不能只回退镜像替代不兼容迁移回退。更新使用新的源码/镜像，核对摘要、执行迁移和健康/持久化检查后切换。任何失败都保留持久卷，禁止 down --volumes；本地开发数据始终保留。

发布包、原始验证脚本和无依赖候选目录在交付后清理，保留当前镜像、卷、环境、证书与简短部署回执。源码/测试可用于重建，不长期保存临时证据。

参考：[Docker Compose 合并](https://docs.docker.com/reference/compose-file/merge/)、[Caddy HTTPS](https://caddyserver.com/docs/automatic-https)、[代理 Host/URI](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
