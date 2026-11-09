# 腾讯云完整应用部署

目标：在用户指定的腾讯云服务器运行正式 Next.js、FastAPI、Worker、PostgreSQL、Redis 和 S3 文件存储，公开页面与本地共用产品源码；现有 Sites 体验站保留。

当前基线：e1f19d1；用户最终采用 learn.nuxusaurora.cn，目标 ubuntu@111.229.103.70、nuxusaurora.pem。云端新建数据库，本地保留，邮件配置延期。部署与验收已完成，最终事实见 deploy/README.md 和部署回执；下方为执行约定。

## 实施顺序

1. 准备生产 Compose 覆盖层、HTTPS 反向代理、独立环境初始化与配置验证，保留本地 compose.yaml 行为。
2. 取得准确 SSH 目标后只读检查操作系统、CPU/内存/磁盘、Docker/Compose、现有工作负载和端口；使用独立部署目录、项目名和数据卷。核实最终采用的 .cn 域名，复用现有 Nginx。
3. 在服务器生成独立机密，配置 HTTPS、安全 Cookie、模型地址白名单和邮件待补提示。关闭测试登录；不得上传开发 .env。按用户选择新建云端数据库，不迁移或清空本地数据。
4. 构建/上传确定的源码版本或镜像，启动依赖，执行迁移，再启动应用和代理。不替换服务器原有应用或占用其端口。
5. 验证 HTTPS、就绪检查、注册/验证/登录、课程写入和刷新、文本资料上传/签名下载、Worker 任务、模型配置及浏览器布局。真实模型调用和邮件投递以实际配置为准，明确未测项。
6. 保存域名、目录、版本、启动/升级/备份/回滚命令及限制；本地提交按队列合入，不推送 GitHub。完成后清理任务包和 worktree，保留运行依赖及持久卷。

## 职责与边界

- 生产覆盖层只负责入口、端口、运行开关和持久卷；应用 API、数据模型、前端状态归属保持不变。
- HTTPS 代理保留浏览器 Host，应用仍走原同源 API 代理。Nginx 模式采用同源私有桶下载路径，保留签名所需 Host/路径/查询，移除账户 Cookie/Authorization 并禁止缓存；存储桶继续私有，不能以公开桶替代签名下载。
- 数据库/Redis 不映射宿主端口，后端/前端/S3 原本地端口在生产覆盖层中移除；对外仅部署入口，SSH 保留既有规则。
- 机密属于服务器独立环境文件，脚本不打印 Compose 完整环境、密码、令牌或私钥。正式前端不加载 Sites 浏览器适配器。
- 状态和资源继续由现有服务拥有；部署失败保留卷，先诊断再恢复，禁止自动 `down --volumes` 或覆盖已有数据。

## 验收门禁

自动检查生产解析后的端口、网络、测试入口关闭、HTTPS Cookie 和域名配置；测试环境生成/验证/拒绝覆盖。核对覆盖层合并后本地默认不变。使用实际运行检查证明迁移、数据、签名下载和 Worker；浏览器检查证明页面，而非用构建代替视觉验收。最终单独复查部署配置与代理边界。

参考：[Compose 合并规则](https://docs.docker.com/reference/compose-file/merge/)、[Caddy HTTPS](https://caddyserver.com/docs/automatic-https)、[Caddy 代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
