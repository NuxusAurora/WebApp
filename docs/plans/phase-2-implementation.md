# Phase 2 · AI Gateway

范围：统一 LLMProvider（chat/stream/generate_structured/test_connection/get_capabilities），仅本地 OpenAI Chat Completions 兼容协议（用户明确收敛范围，原双协议验收不执行）；用户隔离的供应商/模型配置、加密凭据、能力探测、调用审计、有限重试及设置入口。本地真实模型联调待用户配置；本轮用户选择先完成入口和协议验收；协议兼容测试不能称为真实模型效果验收。不实施教学、学习策略或课程结构。

## 解耦约定

- ai/contracts.py 为稳定跨边界契约，消息、结构化 task_context、Schema、超时和重试显式传入；不读取课程、Prompt 文件或学习状态。
- adapters.py 只处理协议及 HTTP；gateway.py 只负责超时、重试、Schema 校验、流结束和脱敏审计；service.py 负责用户隔离的配置快照与凭据解密，routes.py 是 HTTP 组合层。业务工作流调用 Gateway，不由 Gateway 调用业务模块。
- ai/models.py 只保存配置和审计；不修改已有课程/账户模型。密钥使用既有 ENCRYPTION_KEY 的认证加密，响应只返回 has_api_key，支持轮换及删除。不记录输入、输出、原始错误或密钥。
- HTTP client 与审计 sink 可注入；组合根负责关闭 client。单次总 deadline 覆盖重试及流，取消关闭上游，已产出流不重放；失败只写安全状态，不写业务数据。HTTP 禁止重定向和环境代理，目标由服务端 origin 白名单限定。
- 能力区分用户确认、实测通过和未知；测试成功不得推断视觉/工具能力。不支持原生 Schema 时经文本 JSON 提取、验证和最多两次修复，不把失败输出当成功。
- 前端继承既有深蓝设置布局、连续曲率、深浅色和短文案。配置以服务端快照为准，key 仅短暂驻留密码输入，保存后清空。离开保护、失败保留输入、取消请求/过期响应保护；不使用浏览器持久化存密钥。

## 实施与验收

1. 固定契约及新迁移，锁定 HTTP/加密/JSON Schema 依赖。
2. 本地兼容协议普通/流式/结构化调用；认证、限流、超时、错误与取消处理。
3. 配置 CRUD、轮换/删除、能力测试与用户调用日志；同源代理和设置 UI。
4. 有意义的回归：两用户隔离、加密与错误脱敏、两个模型切换及协议请求及分片流、EOF/取消/重试、Schema 修复、业务不变与失败回滚。
5. Ruff/pytest、TypeScript/Vitest/生产构建，独立真实 PostgreSQL 迁移往返和协议 HTTP 验收；浏览器检查桌面/窄屏、深浅色。最后按上述边界复查 diff 及直接调用链，功能与解耦分别记录。
6. 更新 RUNBOOK/HANDOFF，按 master 队列本地提交合入，不推送；保留 Phase 3 及主线外部修改，清理本任务产物。

协议依据：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)，2026-11-08 核对。
