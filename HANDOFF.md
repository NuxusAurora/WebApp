# 项目交接

## 已完成

- 共同规格基线使用固定 Git 标签 phase0-spec-v1；通过 git rev-parse phase0-spec-v1^{commit} 读取完整提交号，三人开工时须核对一致。
- mainbook.md 的完整正文及已确认的状态、版本、关联与文档边界修订已纳入共同规格。
- docs/plans/phase-0-task-cards.md 包含 P0-A、P0-B、P0-C 的范围、共享接口、依赖及验收条件；原有未提交规格导致的开工阻塞已解除。
- 保留已有 master 历史和 .gitignore；本次仅保存规格与开发交接，不包含应用实现。
- 文档检查通过：mainbook 原文摘要未变，23 章和 13 段 JSON 示例完整，围栏、表格和三卡基线约定已核对；应用检查留待实现阶段。

## 下一步

1. 三人阅读 mainbook.md、任务卡和 workbook.md，各领取一张卡并登记姓名、分支、worktree 与修改范围。当前均为待领取。
2. 在包含 phase0-spec-v1 的本地仓库创建独立工作区。以下命令从仓库根执行，目标是相邻目录；执行前先核对 git worktree list、分支和目标目录，已有工作区按归属复用，不覆盖。

```powershell
rtk proxy git rev-parse 'phase0-spec-v1^{commit}'
rtk proxy git worktree add -b codex/phase0-a-frontend ../Webapp-phase0-a phase0-spec-v1
rtk proxy git worktree add -b codex/phase0-b-backend ../Webapp-phase0-b phase0-spec-v1
rtk proxy git worktree add -b codex/phase0-c-infra ../Webapp-phase0-c phase0-spec-v1
```

3. B 发布健康接口和后端启动命令；A 发布前端命令；C 先提供 PostgreSQL/Redis，再集成容器和 CI。具体要求以任务卡为准。
4. 三卡开发完成后，由 B 组织同一候选提交的 Phase 0 集成验收，通过后进入 Phase 1。

## 待验证

- 目前没有前后端、Docker Compose 或 CI 实现，应用测试、构建、浏览器验收和部署均待三张任务卡执行。
- RUNBOOK.md、README.md 由 P0-C 编写，运行命令由 A、B 提供；此时不使用尚不存在的命令进行应用验收。

## 其他

- 本次只保存本地提交和标签，未执行远端推送。其他电脑需先获取相同提交与标签；远端同步仍遵循项目的推送授权规则。
- phase0-spec-v1 固定引用当前规格，不随 master 推进而移动。规格调整由协调人更新文档、说明影响并指定新基线。
- 本次未创建三人的开发 worktree 或领取任务，领取者按上面的命令自行创建并登记。
