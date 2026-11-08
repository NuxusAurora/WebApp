# AI Structured Learning

模型无关的结构化 AI 学习平台。产品规格见 [mainbook.md](mainbook.md)，分工和验收见 [Phase 0 任务卡](docs/plans/phase-0-task-cards.md)。

当前为 Phase 0。P0-C 已提供 PostgreSQL、Redis、S3 兼容开发存储、隔离验证脚本和基础设施 CI；前后端尚未接入，不能据此认定应用或 Phase 0 已验收。

需要 Node.js 24.18.0 和运行中的 Docker Engine / Docker Desktop（Linux 容器、Compose）。从仓库根目录执行：

```sh
node scripts/infra.mjs init
node scripts/infra.mjs check
node scripts/infra.mjs up
node scripts/infra.mjs smoke
node scripts/infra.mjs down
```

`init` 生成本机随机凭据，拒绝覆盖已有 `.env`。数据库和 Redis 不发布宿主端口。S3 API 默认仅监听本机 `127.0.0.1:9000`；停止时保留开发数据。

执行与基础设施 CI 相同的检查：

```sh
node --test scripts/infra.test.mjs
node scripts/infra.mjs verify
```

`verify` 创建带随机名称的独立 Compose 项目、随机本机端口和测试桶，验证停止后恢复，最后删除本次测试的容器、网络和卷。不会启动尚不存在的应用。

配置、宿主开发方式、迁移顺序、故障排查、数据保留和当前未测项统一见 [RUNBOOK.md](RUNBOOK.md)。应用工程分别由 P0-A 维护 `frontend/`、P0-B 维护 `backend/`；C 的 `app` profile 在取得两方 Dockerfile、锁文件及实际入口后继续联调。
