# AI Structured Learning

模型无关的结构化 AI 学习平台。产品规格见 [mainbook.md](mainbook.md)。当前实现到 Phase 1：账户注册与邮箱验证、安全会话、资料和密码管理、用户隔离的课程 CRUD、受限文本上传与签名下载，以及 Phase 0 基础设施。Phase 2 AI Gateway 尚未开始。

需要 Node.js 24.18.0、运行中的 Docker Engine / Docker Desktop（Linux 容器与 Compose）。从仓库根执行：

```sh
node scripts/infra.mjs init
node scripts/phase0.mjs up
```

打开 [学习工作台](http://localhost:3000)，[连接状态](http://localhost:3000/system) 单独保留。`up` 构建生产镜像、启动依赖、显式执行迁移，再启动前端、API 和 Worker。`.env` 由 init 生成随机凭据，拒绝覆盖已有文件；默认端口 3000、8000、9000 仅监听本机，数据库和 Redis 不发布宿主端口。开发邮箱默认写入容器私有 outbox，验证方式见 [运行手册](RUNBOOK.md#phase-1-账户课程与文件)。上传目前仅支持 1 MiB 内 UTF-8 `.txt`。

停止（保留开发数据）：

```sh
node scripts/phase0.mjs down
```

执行与 CI 相同的检查：

```sh
node --test scripts/infra.test.mjs
node scripts/phase0.mjs verify
```

`verify` 使用随机项目名、随机端口和独立卷，运行前后端检查/测试/生产构建、重复迁移、真实 Worker 任务、S3 读写清理、依赖故障与整栈恢复验收，最后删除本次测试资源。首次构建需要下载固定摘要的官方基础镜像。

入口、配置、单独开发、故障排查及验收边界见 [RUNBOOK.md](RUNBOOK.md)，当前交付与后续工作见 [HANDOFF.md](HANDOFF.md)。GitHub Actions 配置已提供，远端执行仍需授权推送；本地检查不代表远端已运行。
