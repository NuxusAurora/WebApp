# 学习工作台 V2：双窗口、项目化知识点学习系统
> 面向 Codex 的产品、UI/UX、后端、AI 教学引擎与 Ubuntu Server 24.04 部署规格  
> 文档版本：1.0  
> 状态：开发基线 / 实施前须先审计现有仓库

---

## 0. 给 Codex 的最高优先级指令

**不要直接开始大规模重构。先审计现有项目，再提交实施计划。**

本项目已经有正在使用的学习平台，当前界面包含课程列表、课程概览、目录与小节、知识点内容管理、模型设置、账户设置等功能。开发前必须检查现有仓库、分支、技术栈、数据库、认证方式、模型接入、部署方式和现有数据。

### 0.1 必须遵守

1. 优先在现有架构上增量开发，不得无理由重写前后端。
2. 保留现有课程、章节、小节、知识点和用户数据。
3. 保留现有账户系统、模型供应商配置和模型适配能力。
4. 保留现有学习模块选项及其原始名称、内容和行为，不得擅自改文案或删功能。
5. 现有目录顺序是权威顺序；AI 不得重排知识点。
6. 任何数据库变更必须有迁移脚本、回滚策略和备份说明。
7. 不得把 API Key、密码、令牌或 `.env` 提交到 Git。
8. 用户数据不能只存于容器可写层或浏览器本地存储。
9. 不得以“AI 已经回答”作为“用户已经理解”的依据。
10. 主窗口教学状态只能由后端状态机推进，前端按钮不能绕过服务端规则。

### 0.2 第一项交付：仓库审计报告

在改代码前，先输出 `docs/IMPLEMENTATION_AUDIT.md`，至少回答：

- 前端框架、路由、状态管理、UI 组件体系是什么？
- 后端语言、框架、入口、模块边界是什么？
- 数据库类型、ORM、迁移工具是什么？
- 当前课程/章节/知识点的数据模型是什么？
- 当前登录认证、用户权限如何实现？
- 模型配置和调用链路在哪里？支持哪些协议？
- 当前文件上传、存储和访问方式是什么？
- 当前部署方式、域名、反向代理、容器情况是什么？
- 当前测试、构建、CI 和日志方案是什么？
- 新需求可以复用哪些现有模块？
- 哪些地方需要迁移？风险是什么？
- 推荐的最小改造路径是什么？

审计完成后，提交分阶段实施计划和预计修改文件清单，等待项目负责人确认后再进行破坏性变更。

---

# 1. 产品目标与核心原则

构建一个专业的 AI 学习工作台。它不是普通聊天页面，而是由平台控制学习流程、由 AI 完成理解和讲解的交互式学习系统。

## 1.1 核心产品原则

- **AI 负责：** 理解问题、生成题目、讲解步骤、回答疑问、提取学习反馈。
- **平台负责：** 课程结构、当前知识点、教学步骤、学习状态、权限、记忆边界、验收和归档。
- **模型可替换：** 教学流程不得绑定某一家模型的专有 API。
- **题目驱动：** 不从大段概念介绍开始，而是从一道有具体数字、难度合适的题目开始。
- **一步一推进：** 主窗口每次只呈现一个教学步骤，等待用户反馈后才进入下一步。
- **双窗口：** 主窗口负责正式教学；右上角副窗口负责不打断进度的即时问答。
- **共享记忆、隔离历史：** 同一小节内共享经过整理的学习记忆；不同知识点的原始聊天记录互相隔离。
- **可重新学习：** 归档一次学习尝试后，可以为同一知识点创建全新的空白对话。
- **目录稳定：** 知识点顺序固定，不能被 AI 或拖拽操作改变。

## 1.2 用户心智模型

层级关系固定为：

```text
课程（Course）
└── 小节（Section / Workspace / 项目）
    ├── 共享工作文件夹
    ├── 共享学习记忆
    ├── 知识点 1（Knowledge Point）
    │   ├── 当前对话实例（Conversation）
    │   └── 历史归档对话（Archived Attempts）
    ├── 知识点 2
    │   ├── 当前对话实例
    │   └── 历史归档对话
    └── 知识点 3 ...
```

**一个小节 = 一个项目 / Workspace。一个知识点 = 一个对话主题。每次重新学习 = 同一知识点下的新 Conversation Attempt。**

项目内的知识点共享 Workspace Memory，但每个 Conversation 的消息历史、教学步骤和进度独立。

---

# 2. 信息架构与交互规则

## 2.1 进入学习模式

用户在现有课程目录中选择某个小节后，进入该小节的学习工作台。

进入时：

1. 加载课程和小节基本信息。
2. 加载该小节固定顺序的知识点目录。
3. 加载 Workspace 的共享记忆摘要和资料索引。
4. 检查当前知识点是否存在 active conversation。
5. 若存在，恢复该对话和教学状态。
6. 若不存在，创建一个 `placeholder` 状态的空白对话。
7. **创建 placeholder 不得调用模型，不得生成欢迎语、题目或任何教学内容。**

“自动创建对话”指创建数据库中的空白对话实例，不是自动向 AI 发消息。

## 2.2 知识点顺序

- 使用现有目录中的 `sequence` / `sort_order` / 等价字段。
- 如果现有模型没有顺序字段，新增迁移字段；先确认现有排序来源。
- API 返回顺序必须由服务端保证。
- 前端按服务端顺序展示。
- 禁止知识点拖拽排序。
- 不允许 AI 新增、删除、改名或重排正式知识点。
- 如未来支持临时补充知识，必须放在“补充内容”区域，不能改变原目录。

## 2.3 当前对话与归档对话

每个用户、每个知识点最多一个当前有效对话（placeholder 或 active）。同一知识点可以有多个 archived attempts。

归档操作：

1. 如果 AI 正在生成，先提示用户选择等待完成或取消生成。
2. 服务端检查生成任务状态。
3. 保存完整消息、步骤、进度和本次学习总结。
4. 将对话状态设为 `archived`，记录归档时间。
5. 释放该知识点的 active conversation 唯一槽位。
6. 归档内容只读，不允许继续追加消息。
7. 共享记忆可保留已经提取并确认的内容，但不把完整聊天历史直接合并进共享记忆。

重新进入该知识点：

1. 若有当前有效对话，默认恢复当前对话。
2. 若用户明确选择“重新学习”，先确认是否归档当前尝试。
3. 创建新的 `conversation_id`，`attempt_number + 1`。
4. 新对话状态为 `placeholder`。
5. 教学进度从空白开始。
6. 不自动继承旧对话的步骤、消息或完成状态。
7. 可以提供“查看历史记录”和可选的“参考上次总结”；参考总结必须由用户主动选择。

## 2.4 导航状态视觉区分

建议知识点状态：

- 未开始：中性图标。
- 当前学习：强调色标记。
- 已完成：完成图标，但仍保留原目录位置。
- 有薄弱项：轻量提示标记。
- 已归档：在历史记录内展示，不替代目录节点。

不要仅靠颜色传达状态，需同时使用图标、文字或 tooltip，保证可访问性。

---

# 3. UI / UX 规格

## 3.1 总体布局：三栏工作台 + 浮动问答

桌面端建议：

```text
┌────────────────────────────────────────────────────────────────────┐
│ 顶栏：Logo / 课程路径 / 当前小节 / 学习状态 / 设置                  │
├────────────┬──────────────────────────────────────┬────────────────┤
│ 全局导航   │ 主教学窗口                           │ 项目/知识点树  │
│            │                                      │                │
│ 我的课程   │ 当前知识点标题                       │ 当前小节项目   │
│ 模型设置   │                                      │  1.1 知识点    │
│ 账户设置   │ 题目卡片                             │  1.2 知识点    │
│            │                                      │  1.3 知识点    │
│            │ 当前步骤卡片                         │                │
│            │                                      │ 历史归档       │
│            │ 理解反馈控件                         │                │
│            │                                      │                │
│            │ [我理解了，下一步]                   │                │
└────────────┴──────────────────────────────────────┴────────────────┘
                                           右上角浮动问答按钮
```

建议初始宽度（可响应式调整）：

- 全局导航：220–260px，可折叠。
- 中央主窗口：弹性占用，桌面最小建议 560px。
- 右侧项目导航：260–320px，可折叠。
- 副窗口：约 360–420px 宽、480–600px 高；小屏改为抽屉或全屏面板。

不要把三栏都做成固定宽度导致中间内容过窄。小屏设备应优先保证主教学内容可读。

## 3.2 顶栏

展示：

- 返回课程/目录。
- 课程名称、小节名称面包屑。
- 当前知识点名称。
- 学习状态。
- 可选的工作空间资料入口。

不要在顶栏堆放低频操作。

## 3.3 左侧全局导航

沿用现有平台全局导航，不要重新设计账户、模型设置等无关页面。进入学习模式时可以收窄或折叠，但不能破坏原有导航路径。

## 3.4 右侧项目导航

右侧展示当前小节中的全部知识点，按固定目录顺序排列。

每个知识点节点：

- 序号。
- 知识点名称。
- 状态图标。
- 当前项强调。
- `...` 操作菜单。

菜单至少包括：

- 归档当前对话（仅有当前对话时显示）。
- 历史学习记录。
- 重新学习。
- 查看学习总结（有总结时显示）。

项目树支持折叠，但不支持改变知识点顺序。

“历史归档”建议作为知识点子项或独立折叠区，不要把旧尝试混在当前知识点列表中，避免导航过长。

## 3.5 中央主教学窗口

主窗口不是普通聊天气泡流，而是结构化教学流。

建议结构：

1. 当前知识点标题与简要上下文。
2. 题目卡片。
3. 当前唯一教学步骤卡片。
4. 用户反馈区域。
5. 底部固定操作区。
6. 轻量进度指示（例如“步骤 2 / 当前题目”）。

教学卡片支持：

- Markdown。
- 数学公式 LaTeX。
- 代码/表格（按学科需要）。
- 图片或教材引用。
- 分步推导。
- 简单交互题。

必须保证公式在桌面和移动端都可读，长公式可横向滚动或分行。

## 3.6 主窗口交互按钮

每一步根据当前状态展示适当操作：

- “我理解了，下一步”：用户自我确认。
- “还没理解”：请求针对当前步骤重新讲解，不推进。
- “换一种方式”：要求 AI 更换解释方式，仍停留在当前步骤。
- “给我提示”：只给当前步骤的提示，不泄露后续步骤。
- “验证一下”：生成一个短小、针对当前步骤的理解检测。

不要同时显示过多按钮。主操作必须最突出，辅助操作收纳为次级按钮或菜单。

用户自我确认后可以进入下一步；系统可提示进行验证，但不应把所有教学变成强制考试。若用户答错，留在当前步骤并针对错误解释。

## 3.7 右上角独立问答窗口

默认显示浮动入口，例如“随时提问”。

点击后弹出独立浮动窗口：

- 有独立消息历史。
- 有独立输入框和发送状态。
- 不覆盖主窗口。
- 可拖动或调整尺寸（若现有 UI 框架支持）。
- 关闭后保留问答历史。
- 移动端改为抽屉或全屏子页面。

副窗口可回答：

- 当前公式如何使用？
- 某个概念是什么意思？
- 为什么某一步这样变形？
- 能否换一道简单题解释？
- 某个符号代表什么？

副窗口应默认知道当前小节、当前知识点和主窗口当前步骤（只读上下文），但不要自动读取所有主窗口历史。

### 3.7.1 副窗口不打断主窗口

副窗口的任何行为都不得：

- 修改主窗口当前步骤。
- 自动推进主窗口。
- 修改主窗口教学状态。
- 把副窗口聊天消息插入主窗口消息流。
- 取消主窗口生成任务（除非用户明确操作）。

### 3.7.2 副窗口学习反馈

副窗口问答结束后，可提取结构化反馈：

```json
{
  "topic": "特征值",
  "question": "为什么行列式等于零",
  "understanding": "不理解齐次方程组存在非零解的条件",
  "preferred_explanation": "希望结合具体数字解释",
  "importance": "high",
  "source": "qa_conversation"
}
```

提取结果先作为待审核/待确认记忆事件，经过规则校验后写入小节共享记忆。不能让模型无约束地覆盖已有记忆。

---

# 4. 教学流程与状态机

## 4.1 教学从具体题目开始

禁止默认以“今天我们来学习……以下是概念介绍”作为开场。

每个知识点开始时：

1. 根据知识点、课程资料和前置知识，选择一道简单、具体、有数字的题目。
2. 题目应能引出该知识点的核心概念。
3. 题目难度从低到高，不应在第一题引入过多前置知识。
4. 展示题目后，只解释第一步。
5. 等待用户反馈。

例如线性代数“矩阵的特征值和特征向量”：

```text
A = [ [2, 0],
      [0, 3] ]

求矩阵 A 的特征值。
```

第一步可以先说明目标：寻找非零向量 x 和数 λ，使得 Ax = λx。不要在开场一次性输出完整求解过程。

## 4.2 一步式教学

一次模型调用只生成一个当前步骤，不生成整题的全部讲解。

推荐步骤对象：

```json
{
  "type": "teaching_step",
  "problem_id": "problem_001",
  "step_index": 1,
  "title": "明确计算目标",
  "content": "我们要寻找非零向量 x 和数 λ，使 Ax = λx。",
  "explanation": "λ 是待求的特征值，x 是对应的特征向量。",
  "check_question": "这里要求 x 必须满足什么条件？",
  "expected_understanding": "理解 x 不能是零向量",
  "allowed_actions": [
    "confirm_understood",
    "ask_for_reexplanation",
    "request_hint",
    "request_check"
  ],
  "next_action": "wait_for_user"
}
```

后端必须校验：

- conversation 是否属于当前用户。
- 当前状态是否允许生成步骤。
- step_index 是否符合预期。
- 是否已有相同步骤。
- 该步骤是否属于当前 problem。
- 输出字段是否合法。
- AI 是否提前泄露后续完整步骤（可通过结构约束、提示词和输出长度控制降低风险，但不能声称能绝对识别所有泄露）。

若校验失败，不得推进进度；保留错误日志，允许安全重试。

## 4.3 状态机

建议状态：

- `placeholder`：空白占位，尚未开始。
- `presenting_problem`：正在生成/展示题目。
- `teaching_step`：正在讲解当前步骤。
- `understanding_check`：正在进行理解检测。
- `waiting_for_user`：等待用户选择。
- `step_completed`：当前步骤完成。
- `lesson_completed`：当前题目/教学单元完成。
- `archived`：已归档。

状态流转：

```text
placeholder
    |
    | 用户点击开始
    v
presenting_problem
    |
    v
teaching_step
    |
    v
waiting_for_user
    |             |                 |
    | 理解了      | 还没理解        | 要求验证
    v             v                 v
step_completed  teaching_step   understanding_check
    |                               |
    | 下一步                        | 通过
    v                               v
teaching_step <---------------- step_completed
    |
    | 全部步骤完成
    v
lesson_completed
    |
    | 下一题/巩固
    v
presenting_problem
```

允许用户自我确认进入下一步；理解检测是辅助机制，不是所有步骤的硬性门槛。

## 4.4 防止重复推进

- “下一步”接口必须幂等。
- 每次推进带 `request_id` 或幂等键。
- 后端使用事务和乐观锁/版本号。
- 相同请求重复提交时返回同一结果，不创建重复步骤。
- 客户端禁用重复点击只是体验优化，不是安全机制。
- 网络断开后恢复时，以服务端最新状态为准。

## 4.5 数学与其他学科的验收

数学题优先使用确定性计算校验：

- 简单算术：服务端计算。
- 代数表达式：使用安全数学解析器或受限计算工具。
- 数值答案：允许合理精度/容差。
- 证明题：由 AI 辅助评价，但明确反馈依据和不确定性。

禁止直接执行模型返回的任意 Python、Shell、SQL 或 JavaScript。

---

# 5. 双窗口上下文与共享记忆

## 5.1 上下文边界

同一小节内：

- 主窗口可以读取小节共享记忆。
- 副窗口可以读取小节共享记忆。
- 主窗口可以读取当前对话自己的历史。
- 副窗口可以读取自己的历史。
- 副窗口可读取当前主窗口步骤的只读摘要。
- 其他知识点的完整聊天历史不可直接读取。

不同小节之间默认完全隔离，不得共享 Workspace Memory。

## 5.2 主窗口上下文构建

每次生成步骤时，按需组合：

1. 系统教学规则。
2. 当前课程和小节信息。
3. 当前知识点标题、目标和前置知识。
4. 当前对话自己的必要历史。
5. 当前题目和已完成步骤。
6. 小节共享记忆摘要。
7. 与当前知识点相关的教材资料片段。
8. 用户当前消息。

不要每次把整个 Workspace 文件夹和所有聊天记录都塞给模型。使用检索、摘要和 token 预算控制上下文。

## 5.3 副窗口上下文构建

包含：

1. 副窗口专用系统规则。
2. 当前课程、小节、知识点。
3. 主窗口当前步骤摘要（只读）。
4. 小节共享记忆摘要。
5. 副窗口自己的历史。
6. 用户当前问题。
7. 必要的教材资料片段。

副窗口回答应明确聚焦用户的问题，不擅自推进主教学。

## 5.4 共享记忆结构

建议记忆类型：

- `mastered`：已掌握。
- `weak_point`：薄弱知识。
- `misconception`：错误理解。
- `unresolved_question`：尚未解决的问题。
- `preference`：解释偏好。
- `prerequisite_gap`：前置知识缺口。
- `cross_topic_link`：知识点联系。

每条记忆至少记录：

- id
- user_id
- section_id
- memory_type
- content
- confidence
- source_conversation_id
- source_message_id（如适用）
- status（pending / accepted / rejected / superseded）
- created_at
- updated_at

记忆更新规则：

1. AI 只能提出记忆候选，不能直接无条件覆盖。
2. 可通过规则自动接受低风险事实，例如用户明确说“我不懂这个公式”。
3. 对“已经掌握”等判断应有证据，不能仅因用户点了按钮就永久认定。
4. 允许用户查看、修正和删除小节记忆。
5. 记忆必须可追溯到来源。
6. 归档不删除已接受的共享记忆。
7. 新对话默认读取共享记忆摘要，但不继承旧对话进度。

---

# 6. Workspace 文件系统

## 6.1 逻辑目录

```text
course/
└── section/
    ├── workspace/
    │   ├── syllabus.md
    │   ├── knowledge.md
    │   ├── learner_profile.md
    │   ├── memory.md
    │   ├── progress.json
    │   └── materials/
    ├── conversations/
    │   └── knowledge_point_id/
    └── archive/
        └── knowledge_point_id/
```

这是逻辑组织结构。实际实现可以采用数据库元数据 + 文件对象存储，不强制每个对话必须在磁盘上创建一个真实目录。

## 6.2 文件用途

- `syllabus.md`：当前小节范围、目录、学习目标。
- `knowledge.md`：知识结构、概念关联。
- `learner_profile.md`：本小节相关的学习偏好摘要。
- `memory.md`：可读的共享记忆快照；数据库记录为权威来源。
- `progress.json`：可导出的进度快照；数据库记录为权威来源。
- `materials/`：教材、PDF、图片、用户上传资料。

数据库是进度和记忆的权威数据源。Markdown/JSON 文件是可读快照或导出形式，不允许出现数据库与文件互相覆盖的双主数据源问题。

## 6.3 文件安全

- 文件 ID 使用随机不可预测标识。
- 下载前校验用户、课程、小节权限。
- 不接受客户端任意文件路径。
- 文件名清理，防止路径穿越。
- 限制文件大小、类型和数量。
- 对上传文件进行 MIME/内容检测。
- 不将上传文件内容当作系统指令执行。
- 文件存储路径不能暴露为可猜测的公开 URL。

---

# 7. 数据库建议

先复用现有表和字段；以下是逻辑模型，不要求机械照搬命名。

## 7.1 核心实体

### courses
- id
- owner_id / tenant_id
- title
- metadata
- created_at
- updated_at

### sections
- id
- course_id
- title
- sequence
- workspace_id
- created_at
- updated_at

### knowledge_points
- id
- section_id
- title
- sequence
- learning_objective
- prerequisite_ids（可用关联表实现）
- is_active
- created_at
- updated_at

### workspaces
- id
- section_id
- owner_id
- settings
- created_at
- updated_at

### conversations
- id
- knowledge_point_id
- user_id
- attempt_number
- status
- version
- started_at
- archived_at
- created_at
- updated_at

状态建议：`placeholder`、`active`、`archived`。

同一 user + knowledge_point 最多一个未归档 conversation。可使用数据库部分唯一索引（具体语法按数据库类型调整）或事务锁实现。

### messages
- id
- conversation_id
- channel（main / qa）
- role
- content
- content_format
- metadata
- request_id
- created_at

若主窗口和副窗口有独立消息历史，建议使用独立的 QA conversation 实体，而不是只靠 channel 混在同一条历史里。

### qa_conversations
- id
- parent_conversation_id
- knowledge_point_id
- user_id
- status
- created_at
- updated_at

### qa_messages
- id
- qa_conversation_id
- role
- content
- metadata
- request_id
- created_at

### learning_problems
- id
- conversation_id
- problem_index
- statement
- difficulty
- source_metadata
- status
- created_at

### learning_steps
- id
- conversation_id
- problem_id
- step_index
- title
- content
- explanation
- expected_understanding
- status
- version
- created_at
- completed_at

### learning_progress
- id
- conversation_id
- current_problem_id
- current_step_id
- state
- version
- updated_at

### project_memories
- id
- workspace_id
- user_id
- memory_type
- content
- confidence
- status
- source_conversation_id
- source_message_id
- created_at
- updated_at

### memory_events
- id
- workspace_id
- memory_id
- event_type
- payload
- source
- created_at

### workspace_files
- id
- workspace_id
- owner_id
- storage_key
- original_filename
- mime_type
- size_bytes
- checksum
- status
- created_at

### archives（可选）
如果 conversation 自身已经完整保留 archived 状态和数据，可不额外建重复归档表。需要归档快照时再建立。

## 7.2 关键约束

- 所有用户数据表必须有明确用户/租户权限关系。
- 所有外键必须正确。
- 对 `section_id + sequence` 建索引。
- 对 `knowledge_point_id + user_id + status` 建索引。
- 对消息的 `conversation_id + created_at` 建索引。
- 对记忆的 `workspace_id + status + memory_type` 建索引。
- 归档操作使用事务。
- 删除课程/小节必须有明确级联策略和二次确认；默认软删除或阻止删除仍有关联数据的对象。
- 对话归档不得级联删除消息。

---

# 8. API 设计建议

统一前缀 `/api/v1`。具体路由应结合现有 API 风格调整，避免重复造轮子。

## 8.1 工作台与目录

- `GET /courses/{courseId}/sections`
- `GET /sections/{sectionId}/workspace`
- `GET /sections/{sectionId}/knowledge-points`
- `GET /knowledge-points/{knowledgePointId}`

## 8.2 打开知识点

- `POST /knowledge-points/{knowledgePointId}/open`

行为：
- 如果存在当前有效 conversation，返回它。
- 如果不存在，创建 placeholder。
- 不调用 AI。
- 支持幂等。
- 返回 conversation_id、状态、attempt_number 和当前进度。

## 8.3 主窗口

- `GET /conversations/{conversationId}`
- `POST /conversations/{conversationId}/start`
- `POST /conversations/{conversationId}/messages`
- `POST /conversations/{conversationId}/problems`
- `POST /conversations/{conversationId}/steps/next`
- `POST /conversations/{conversationId}/steps/{stepId}/confirm`
- `POST /conversations/{conversationId}/steps/{stepId}/feedback`
- `GET /conversations/{conversationId}/progress`

## 8.4 副窗口

- `GET /conversations/{conversationId}/qa`
- `POST /conversations/{conversationId}/qa/messages`
- `GET /qa-conversations/{qaConversationId}/messages`

副窗口 QA conversation 必须与主窗口 conversation 关联，但有独立消息历史。

## 8.5 归档与历史

- `POST /conversations/{conversationId}/archive`
- `GET /knowledge-points/{knowledgePointId}/archives`
- `GET /conversations/{conversationId}/archive-summary`
- `POST /knowledge-points/{knowledgePointId}/restart`

restart 必须创建新实例，不得复用或清空旧实例。

## 8.6 Workspace

- `GET /sections/{sectionId}/memories`
- `POST /sections/{sectionId}/memory-candidates`
- `PATCH /memories/{memoryId}`
- `DELETE /memories/{memoryId}`
- `GET /sections/{sectionId}/files`
- `POST /sections/{sectionId}/files`
- `GET /workspace-files/{fileId}/download`

## 8.7 API 通用要求

- 认证和授权。
- 输入 schema 校验。
- 统一错误格式。
- 分页。
- 幂等键。
- 请求追踪 ID。
- 速率限制。
- SSE 断线恢复策略。
- 服务端状态校验。
- 对用户可见错误不泄露密钥、内部路径或堆栈。

---

# 9. AI Provider 与提示词架构

## 9.1 模型适配

沿用现有供应商接入层，统一内部接口：

- `generateProblem(context)`
- `generateTeachingStep(context)`
- `reexplainCurrentStep(context)`
- `generateHint(context)`
- `generateUnderstandingCheck(context)`
- `evaluateAnswer(context)`
- `answerSideQuestion(context)`
- `extractMemoryCandidate(context)`

Provider Adapter 负责将统一请求转换为 OpenAI 兼容、Gemini、Claude 或本地模型的实际协议。

教学状态机不得依赖某个供应商特有字段。

## 9.2 主教学系统提示词要点

- 你是循序渐进的辅导老师。
- 从具体数字题目开始。
- 当前只生成一个步骤。
- 不得提前输出后续步骤。
- 解释当前步骤所需的概念，不做无关百科式扩展。
- 用户表示不理解时，换一种方式解释当前步骤。
- 用户要求提示时，只提供当前步骤的提示。
- 不得自行宣称用户已经掌握。
- 输出必须符合后端指定 JSON schema。
- 不确定时说明不确定，不编造教材内容。
- 优先参考已授权的课程资料和共享记忆。

## 9.3 副窗口系统提示词要点

- 只回答用户当前提出的问题。
- 可以解释主窗口当前公式、符号、步骤和前置知识。
- 可以用额外例子解释，但不要代替主窗口推进课程。
- 不得修改主窗口进度。
- 结束后可提出学习反馈候选。
- 不把猜测写成确定的用户能力结论。
- 共享记忆只在当前 Workspace 范围内读取和写入。

## 9.4 结构化输出

优先使用模型供应商支持的 JSON Schema / structured output。若供应商不支持，使用受控解析和校验。

模型输出必须先通过服务端校验再入库。不要直接把未校验的模型文本当作教学状态。

---

# 10. Ubuntu Server 24.04 LTS 部署规格

## 10.1 总体建议

优先采用**模块化单体 + Docker Compose**，不在首版拆微服务。

建议组件：

- frontend
- backend
- PostgreSQL
- Redis（按实际需求启用）
- Caddy 或 Nginx
- 可选对象存储（若现有文件规模或多实例需求需要）

如果当前项目已经有成熟部署方式，先评估是否保留；不要为了符合本文结构而破坏现有生产环境。

## 10.2 建议目录

```text
/opt/learning-studio/
├── app/
│   ├── frontend/
│   ├── backend/
│   └── shared/
├── deploy/
│   ├── docker-compose.yml
│   ├── .env
│   ├── proxy/
│   └── scripts/
├── data/
│   ├── postgres/
│   ├── redis/
│   ├── workspaces/
│   └── uploads/
├── backups/
└── logs/
```

这只是建议结构。若当前服务器已有项目目录、用户权限、备份路径或 Cloudflare Tunnel 配置，应先盘点后决定迁移方式。

## 10.3 容器与持久化

- PostgreSQL 数据目录必须挂载持久化 volume。
- 用户上传文件必须挂载持久化 volume 或对象存储。
- Workspace 资料必须持久化。
- 容器重建不能丢失数据。
- 不允许将数据库文件放入镜像层。
- 不允许依赖容器内临时目录保存唯一副本。
- 容器以非 root 用户运行（适用时）。
- 设置健康检查、资源限制和重启策略。
- 数据库端口不应直接暴露公网。

## 10.4 HTTPS 与网络

- 使用现有域名和 DNS 配置。
- 通过 Caddy/Nginx 或现有 Tunnel 方案提供 HTTPS。
- 若现有 Cloudflare Tunnel 已经稳定运行，优先复用，不要无故改动隧道。
- SSE 代理需要关闭不适当的缓冲，并配置合理的超时。
- 限制上传大小和请求体大小。
- 数据库、Redis 只允许内部网络访问。
- 防火墙只开放必要端口。

## 10.5 环境变量

示例变量名，实际按现有配置体系整合：

```env
APP_ENV=production
APP_SECRET=
DATABASE_URL=
REDIS_URL=
STORAGE_ROOT=/app/data
PUBLIC_BASE_URL=
AI_PROVIDER=
AI_API_BASE_URL=
AI_API_KEY=
```

- `.env` 加入 `.gitignore`。
- 生产密钥不能写入 Dockerfile、前端构建变量或日志。
- 前端不得获取服务端 AI 密钥。
- 密钥加密存储或使用现有安全配置系统。
- 提供 `.env.example`，只包含变量名和无敏感示例。

## 10.6 备份和恢复

至少备份：

- PostgreSQL。
- 用户上传文件。
- Workspace 文件。
- 必要的部署配置（排除密钥或使用安全密钥备份方案）。

要求：

- 定期自动备份。
- 保留多份历史版本。
- 备份文件不能只放在同一块磁盘。
- 定期执行恢复演练。
- 文档写明恢复步骤、预计恢复时间和数据恢复点。
- 归档不是备份的替代品。

## 10.7 监控与日志

至少记录：

- API 请求错误率。
- AI 调用耗时、失败率和 token 用量（若供应商返回）。
- SSE 连接异常。
- 数据库连接池。
- 存储空间。
- 备份成功/失败。
- 教学步骤状态迁移错误。
- 幂等冲突和并发冲突。

日志不得记录 API Key、密码、完整敏感用户资料或不必要的原始附件内容。

---

# 11. 安全、隐私与可靠性

1. 所有课程、对话、记忆、文件都必须按用户和 Workspace 授权。
2. 不能仅凭前端传入的 section_id 就认定用户有权访问。
3. 文件下载必须经过权限校验。
4. 用户上传资料是数据，不是系统指令；防范 Prompt Injection。
5. AI 输出不得直接执行为代码或数据库语句。
6. 对外部 URL 抓取应防范 SSRF；若首版不需要 URL 抓取，不要实现。
7. API Key 只在服务端使用。
8. 对话归档、记忆更新和步骤推进需记录审计事件。
9. 用户删除数据时明确说明删除范围和不可恢复性。
10. 提供数据导出和必要的数据删除流程。
11. 重要操作需要确认和服务端二次校验。
12. 多标签页、多设备并发时以服务端版本为准。
13. AI 生成失败不得破坏已完成步骤。
14. 共享记忆更新失败不得丢失原始问答。

---

# 12. 测试计划与验收标准

## 12.1 UI 测试

- 三栏布局在常见桌面宽度下正常。
- 左右侧栏可以折叠。
- 主教学内容不会被副窗口遮挡。
- 副窗口可关闭后重新打开。
- 小屏下切换为抽屉/全屏布局。
- 公式、长文本、图片和代码正常展示。
- 当前知识点状态清晰。
- 目录顺序稳定。

## 12.2 对话生命周期测试

1. 打开一个小节。
2. 确认当前知识点创建 placeholder。
3. 确认没有调用 AI。
4. 点击开始。
5. 生成第一道具体数字题。
6. 生成第一步。
7. 刷新浏览器。
8. 确认恢复到同一步。
9. 归档。
10. 再次打开知识点。
11. 确认生成新的 placeholder 和 conversation_id。
12. 查看旧归档，确认消息完整且只读。

## 12.3 双窗口测试

- 主窗口处于步骤 2 时打开副窗口。
- 副窗口询问当前公式。
- 副窗口回答期间主窗口状态不变。
- 关闭副窗口后主窗口仍停留在步骤 2。
- 副窗口产生有效记忆候选。
- 记忆被接受后，切换同一小节另一个知识点。
- 新知识点主窗口可以读取该记忆。
- 新知识点不能读取前一知识点的完整聊天历史。
- 切换到其他小节后不能读取原小节记忆。

## 12.4 状态机测试

- 未开始不能确认步骤。
- 当前步骤完成前不能推进（除非产品明确允许的自我确认动作）。
- 重复点击下一步不产生重复步骤。
- AI 输出 schema 错误时不改变进度。
- AI 超时后可以重试。
- 用户取消生成后不会把未完成步骤标记完成。
- 归档后不能继续发送主窗口消息。
- 并发请求不会产生两个当前步骤。

## 12.5 权限测试

- 用户 A 不能访问用户 B 的 conversation。
- 用户 A 不能访问用户 B 的 Workspace 文件。
- 伪造 section_id 不会绕过权限。
- 文件 ID 不可猜测且下载时再次鉴权。
- 归档和记忆接口检查所属用户。
- AI 配置密钥不会出现在前端响应。

## 12.6 Ubuntu 部署测试

- 全新部署成功。
- 服务重启后自动恢复。
- 容器重建后数据库仍在。
- 容器重建后上传文件仍在。
- HTTPS 正常。
- SSE 长连接正常。
- 备份任务成功。
- 从备份恢复成功。
- 数据库端口未暴露公网。
- 日志不包含密钥。

## 12.7 最终验收场景

必须完整演示：

1. 打开“线性代数”课程。
2. 进入“方阵的特征值和特征向量”小节。
3. 自动创建 1.1 的空白对话。
4. 点击开始，AI 给出一道具体数字题。
5. AI 只讲第一步并等待。
6. 用户在副窗口询问某个公式。
7. 副窗口解释，不影响主窗口。
8. 副窗口形成学习反馈。
9. 主窗口下一步能够参考共享记忆。
10. 进入 1.2，能够读取同一小节的相关记忆，但看不到 1.1 完整聊天历史。
11. 归档 1.1。
12. 再次进入 1.1，得到全新空白对话。
13. 查看旧对话，记录完整。
14. 重启服务器，所有数据仍然存在。

---

# 13. Codex 分阶段任务清单

## Phase 0：现状审计（必须最先做）

Codex：
- 检查仓库结构、技术栈和现有数据模型。
- 检查课程目录和排序逻辑。
- 检查登录、权限和模型调用。
- 检查文件存储和部署方式。
- 输出 `docs/IMPLEMENTATION_AUDIT.md`。
- 输出数据库改造草案、API 改造草案和文件修改清单。
- 不做破坏性修改。

项目负责人：
- 审核审计报告。
- 确认是否沿用现有技术栈。
- 确认生产数据备份已完成。

## Phase 1：纯前端工作台

Codex：
- 建立三栏布局。
- 建立项目树和知识点节点。
- 建立主教学窗口的空状态、题目状态、步骤状态。
- 建立副窗口 UI。
- 建立归档历史 UI。
- 使用 mock 数据完成交互。
- 保持现有全局导航和账户设置。

验收：不连接 AI 和后端也能演示主要 UI 状态。

项目负责人：
- 审核视觉层级、信息密度、交互逻辑。
- 确认桌面端和移动端布局。

## Phase 2：对话生命周期与目录

Codex：
- 实现数据库迁移。
- 实现知识点 open。
- 实现 placeholder。
- 实现当前对话唯一约束。
- 实现归档、历史、restart。
- 接入真实目录数据。
- 加入并发和幂等测试。

验收：刷新和重新登录后，对话状态正确。

项目负责人：
- 使用真实课程验证目录顺序和归档规则。
- 确认旧数据未受影响。

## Phase 3：Workspace 与共享记忆

Codex：
- 实现 Workspace 数据模型。
- 实现资料列表、上传、权限校验。
- 实现记忆候选和记忆状态。
- 实现记忆来源追踪。
- 实现主窗口和副窗口读取共享记忆。
- 实现跨小节隔离。

验收：同一小节跨知识点读取有效记忆，不共享原始聊天历史。

项目负责人：
- 检查记忆内容是否准确。
- 确认是否需要人工审核记忆候选。

## Phase 4：主教学引擎

Codex：
- 实现教学状态机。
- 实现题目生成。
- 实现单步骤生成。
- 实现理解确认、重新解释、提示和验证。
- 实现数学简单计算校验。
- 实现 SSE 和失败恢复。
- 实现幂等和并发控制。

验收：一次只展示一步，服务端控制推进。

项目负责人：
- 用真实知识点检查题目难度和讲解质量。
- 测试“还没理解”和“换一种方式”。

## Phase 5：副窗口问答

Codex：
- 实现独立 QA conversation。
- 实现独立消息历史。
- 实现只读主窗口步骤上下文。
- 实现问答记忆候选提取。
- 实现共享记忆更新。
- 确保 QA 不修改主窗口状态。

验收：副窗口问答期间主窗口状态和进度完全不变。

项目负责人：
- 测试真实提问场景。
- 检查共享记忆是否有用且不过度记录。

## Phase 6：Ubuntu Server 24.04 部署

Codex：
- 根据现有环境编写 Docker Compose/部署脚本。
- 配置健康检查、日志、持久化。
- 配置数据库迁移。
- 配置备份和恢复脚本。
- 配置反向代理和 SSE。
- 提供 `.env.example`。
- 编写部署和回滚文档。

项目负责人：
- 确认服务器访问权限。
- 确认域名、DNS、Tunnel/反向代理方案。
- 配置生产环境密钥。
- 执行服务器命令和部署。
- 确认备份位置和恢复演练。

## Phase 7：集成验收

Codex：
- 运行完整测试。
- 修复阻断问题。
- 提交测试报告。
- 更新 README 和部署文档。
- 列出未完成事项和已知限制。

项目负责人：
- 按第 12.7 节执行最终演示。
- 确认是否允许上线。

---

# 14. 项目负责人需要亲自完成的事项

以下操作涉及真实服务器、密钥和生产环境，不应由 Codex 在没有明确授权的情况下擅自执行：

1. 确认目标 Ubuntu Server 24.04 机器及其 SSH 访问方式。
2. 确认当前网站、域名、DNS、Cloudflare Tunnel 或反向代理现状。
3. 确认服务器磁盘空间和备份空间。
4. 确认生产数据库备份。
5. 在服务器或安全配置系统中提供生产环境密钥。
6. 审核数据库迁移和回滚方案。
7. 执行生产部署。
8. 验证 HTTPS、登录、AI 调用和文件上传。
9. 执行一次备份恢复演练。
10. 最终确认是否上线。

Codex 可以准备命令、脚本、配置和检查清单，但执行涉及生产数据的操作前必须获得明确授权。

---

# 15. 非目标与首版范围控制

首版暂不要求：

- 微服务拆分。
- 多 Agent 自主协作。
- AI 自动重排课程。
- AI 自动创建或删除正式知识点。
- 自动把所有聊天转成永久记忆。
- 跨课程共享个人学习记忆。
- 复杂社交、排行榜或社区。
- 自动执行用户上传的代码。
- 强制每一步都进行考试式验证。

先把核心闭环做好：

**进入小节 → 空白知识点对话 → 具体题目 → 一步教学 → 副窗口提问 → 共享记忆 → 下一步 → 归档 → 重新学习。**

---

# 16. 最终开发原则

1. 先审计，再设计迁移，再开发。
2. 先完成 UI 骨架，再接入真实数据和 AI。
3. 先做模块化单体，不提前微服务化。
4. 数据库是学习进度和记忆的权威来源。
5. AI 是教学内容生成器，不是流程控制器。
6. 主窗口和副窗口独立，但共享受控的 Workspace Memory。
7. 归档是保存历史，不是删除或重置原数据。
8. 重新学习必须创建新对话实例。
9. 知识点顺序始终由课程目录控制。
10. 每个阶段必须有可验证的验收结果。

**最终产品定义：**

一个以具体题目为入口、以一步式教学为核心、以知识点为独立对话单位、以小节为共享记忆空间、以双窗口协作为特色的专业 AI 学习工作台。
