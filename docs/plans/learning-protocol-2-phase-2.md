# Learning Protocol 2.0 · Phase 2 文件级计划

基于通过 Gate 0 的 `ad99123`。Phase 2 按冻结计划推进，复用已完成的计划表、计划 Schema、教学会话和主窗修订。教学业务拥有写事务，模型只提供候选；目录、登录、知识点与旧问答仍走现有边界。

| 顺序 | 文件 | 实施内容 |
| --- | --- | --- |
| 1 | `backend/app/learning/models.py`、`backend/migrations/versions/0013_lesson_protocol.py` | 在已有追加式主窗修订挂接可空计划外键。旧快照不回填。每题以独立 task UUID 挂接原 question/plan UUID，已发布步骤、完成确认和操作结果写进原子修订。以非空计划外键区分新旧。降级在存在新记录时拒绝。 |
| 2 | `backend/app/learning/lesson_protocol.py` | 请求契约及状态服务。读取和重放先确认所有权。校验预期任务、计划、步骤、修订和知识点版本。生成时释放事务，保存前取得课程锁并重查。开始/下一题原子写计划与首步，推进一次只写一步，最后一步由冻结计划确定，完成单独保存确认时间，不调用生成器。 |
| 3 | `backend/app/learning/lesson_snapshots.py`、`backend/app/learning/lessons.py`、`frontend/lib/business-proxy.server.ts` | 现有 GET 兼容旧快照，新增同会话的协议查询和命令边界。公开字段白名单，冲突返回当前状态；旧数据只读展示或显式开新题。旧 UI 继续使用原契约，新任务禁止从旧写入口推进。代理放行精确路径。 |
| 4 | `backend/app/learning/lesson_generation.py` | 使用现有 Gateway 和 Phase 1 Schema 接收规划与步骤候选，保留按计划调用的替换入口。以归一化规则拒绝复述和仅改数字的下一题，对语义提供后续有限复核入口。Phase 3 扩展教学角色、分级辅助内容和理解检测。 |
| 5 | `backend/tests/test_learning_protocol.py`、`scripts/phase0.mjs` | 用可控生成器及 PostgreSQL 验证状态转换、重放、不同请求并发、过期写入、原子失败、知识点改版、旧主窗/辅窗和公开字段；更新旧整栈脚本的表/约束验收。 |

服务依赖方向为路由 → 状态服务 → 计划与修订存储、候选生成器。序列化只读已发布内容，内部参考答案和未来步骤不进入公开响应。读快照用于超时恢复。课程锁只保护最终命令复核与提交。功能验收与解耦检查分别记录，数据库验证区分隔离测试库和目标开发库。
