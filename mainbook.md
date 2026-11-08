# AI Structured Learning

## 产品需求规格书与 Codex 开发实施规范

**版本：** V1.0
**产品形态：** 专业学习工作台
**部署方式：** 云端 SaaS
**开发目标：** 构建模型无关的结构化 AI 学习平台
**首个验证学科：** 高等数学

---

# 目录

1. 产品概述
2. 产品设计原则
3. 用户角色与权限
4. 功能需求
5. 页面结构与交互设计
6. 核心业务流程
7. 系统技术架构
8. 数据库设计
9. 后端 API 规范
10. AI 模型接入规范
11. Prompt 工程规范
12. AI 输出校验机制
13. 知识管理与学习状态
14. 项目文件与上下文管理
15. 安全与隐私
16. 异常处理
17. 测试规范
18. 部署与运维
19. MVP 验收标准
20. Codex 开发任务清单
21. workbook.md
22. HANDOFF.md
23. RUNBOOK.md

---

# 1. 产品概述

## 1.1 产品定位

本产品是一款基于 AI 的结构化学习 SaaS 平台。

用户上传教材目录、课程大纲或学习资料，平台将其解析成结构化课程，再将课程拆分为章节、小节和知识点。

AI 负责：

- 理解教材和学习资料。
- 分析知识点。
- 提供学习资料。
- 解释概念。
- 生成例题和练习。
- 分析学习错误。
- 给出学习建议。

平台负责：

- 管理课程结构。
- 管理知识点及其依赖。
- 控制学习流程。
- 管理会话隔离。
- 校验 AI 输出。
- 保存学习状态。
- 管理学习进度。
- 保证不同模型之间的行为一致。

## 1.2 产品目标

用户最终能够完成以下操作：

1. 创建一门课程。
2. 上传教材目录照片。
3. 自动识别章节和小节。
4. 核对并确认目录。
5. 自动拆分知识点。
6. 分析知识点之间的前置依赖。
7. 自动搜索相关学习资料。
8. 进入某个小节开始学习。
9. 为不同学习任务创建独立对话。
10. 通过练习攻关知识点。
11. 查看掌握状态。
12. 根据前置知识关系规划后续学习。

## 1.3 MVP 范围

首版必须实现：

- 用户注册、登录。
- 创建课程。
- 图片上传。
- OCR 和目录识别。
- 课程目录编辑。
- 知识点拆分。
- 前置知识分析。
- 知识图谱。
- 资料搜索与来源记录。
- 多会话学习。
- AI 教学。
- 练习生成。
- 练习评估。
- 知识点掌握状态。
- 学习进度统计。
- 模型配置。
- 项目交接记录。

首版暂不实现：

- 社交学习。
- 学习排行榜。
- 教师班级管理。
- 付费订阅系统。
- 移动端原生应用。
- 自动生成完整教材。
- 多人协同编辑。
- 复杂的个性化推荐算法。

---

# 2. 产品设计原则

## 2.1 AI 与平台职责分离

这是整个系统最重要的架构原则。

| 操作       | 负责方       |
| -------- | --------- |
| 理解图片     | AI/OCR    |
| 识别目录     | AI        |
| 生成知识点    | AI        |
| 提出前置关系   | AI        |
| 验证知识点 ID | 平台        |
| 检查依赖循环   | 平台        |
| 搜索互联网资料  | 平台搜索服务    |
| 总结资料     | AI        |
| 讲解知识     | AI        |
| 生成练习     | AI        |
| 检查答案     | AI + 平台规则 |
| 修改掌握状态   | 平台        |
| 决定下一步流程  | 平台        |
| 管理会话     | 平台        |

AI 不得直接修改数据库。

AI 只能提交结构化建议，由平台验证后决定是否接受。

## 2.2 模型无关原则

任何模型不得成为系统运行的必要条件。

平台必须保证：

- 更换模型不影响课程结构。
- 更换模型不影响知识点 ID。
- 更换模型不影响学习状态。
- 更换模型不影响历史会话。
- 更换模型不影响学习进度。
- 更换模型不影响 Prompt 工作流定义。

## 2.3 状态可追溯原则

每次重要修改必须记录：

- 修改对象。
- 修改前状态。
- 修改后状态。
- 操作者。
- 修改时间。
- 修改来源。
- 是否经过用户确认。

区分用户确认、系统规则判定和 AI 建议。

---

# 3. 用户角色与权限

首版支持两种角色。

## 3.1 普通用户

权限：

- 管理自己的课程。
- 上传学习资料。
- 配置自己的模型。
- 创建学习会话。
- 修改知识点。
- 确认学习状态。
- 查看学习记录。
- 删除自己的课程。

## 3.2 系统管理员

权限：

- 管理用户。
- 查看系统运行状态。
- 管理模型供应商配置。
- 管理系统级 Prompt 模板。
- 查看任务失败记录。
- 管理系统搜索配置。

管理员默认不能读取用户的私人学习内容。

所有 API 必须实施用户级数据隔离。

---

# 4. 功能需求

## 4.1 用户系统

功能：

- 邮箱注册。
- 邮箱验证。
- 登录。
- 退出登录。
- 修改密码。
- 密码重置。
- 用户资料管理。

要求：

- 密码使用 Argon2id 哈希。
- 使用安全 Cookie。
- 实施登录限流。
- 实施邮箱验证。
- 不允许通过修改 URL 访问其他用户的课程。

## 4.2 课程管理

课程创建字段：

| 字段   | 类型        |
| ---- | --------- |
| 课程名称 | String    |
| 教材名称 | String    |
| 学科   | String    |
| 学习目标 | Text      |
| 学习难度 | Enum      |
| 目录来源 | Enum      |
| 创建时间 | Timestamp |

支持：

- 创建课程。
- 编辑课程。
- 删除课程。
- 上传教材。
- 上传目录照片。
- 查看课程进度。

## 4.3 目录识别

输入：

- 一张或多张图片。
- 可选教材名称。
- 可选学习目标。

处理流程：

1. 图片上传。
2. OCR 文字识别。
3. AI 识别章节层级。
4. AI 识别页码。
5. 平台检查目录结构。
6. 展示识别结果。
7. 用户修改。
8. 用户确认。
9. 创建正式课程目录。

目录层级：

Course
└── Chapter
└── Section
└── Knowledge Point

必须支持：

- 章节排序。
- 小节排序。
- 页码。
- 标题修改。
- 新增节点。
- 删除节点。
- 拖拽排序。

未经用户确认的目录不得成为正式课程结构。

## 4.4 知识点管理

每个小节由多个明确的知识点组成。

知识点必须具有：

- 唯一 ID。
- 名称。
- 定义。
- 学习目标。
- 重要程度。
- 建议掌握标准。
- 前置知识。
- 来源。
- 当前学习状态。

知识点学习状态（knowledge_points.status）：

| 状态           | 含义       |
| ------------ | -------- |
| NOT_STARTED  | 尚未学习     |
| LEARNING     | 正在学习     |
| PRACTICING   | 正在练习     |
| NEEDS_REVIEW | 需要复习     |
| MASTERED     | 已掌握      |

状态修改必须遵循平台规则。

用户可以手动确认掌握，但需要保留确认记录。

前置条件独立表示为 prerequisite_status：SATISFIED（已满足）或 UNSATISFIED（未满足），由平台根据已确认的依赖及前置知识掌握状态计算，不写入学习状态字段。没有已确认前置依赖时视为 SATISFIED。

LOCKED 仅是前置条件未满足时的界面提示，不是学习状态。用户可以选择“仍然学习”；平台记录本次会话的继续选择，允许进入学习，但保留未满足提醒，不修改前置知识的掌握状态。其他会话不自动继承该选择。

知识点的内容确认状态由结构版本管理，与学习状态分开；未确认知识点不得用于正式依赖或学习会话。

## 4.5 前置知识管理

AI 提出依赖关系。

平台验证：

1. 依赖节点是否存在。
2. 依赖节点是否属于当前课程。
3. 是否存在循环依赖。
4. 是否存在重复依赖。
5. 是否存在自我依赖。
6. 是否引用尚未确认的知识点。

关系结构：

Prerequisite Knowledge Point → Dependent Knowledge Point（前置知识 → 依赖它的知识）

每条关系包含：

- 依赖理由。
- 置信度。
- 来源。
- 确认状态。

用户可以：

- 添加关系。
- 删除关系。
- 修改关系。
- 确认关系。
- 忽略建议关系。

允许存在跨章节依赖。

正式依赖及依赖分析输出统一使用平台分配的 knowledge_point_id；临时 ID 的映射规则见 11.2–11.3。

## 4.6 学习会话

每个小节可以创建多个会话。

默认会话类型：

| 类型       | 用途   |
| -------- | ---- |
| CONCEPT  | 概念讲解 |
| EXAMPLE  | 例题分析 |
| QUESTION | 疑难问题 |
| PRACTICE | 练习训练 |
| REVIEW   | 复习总结 |

每个会话拥有独立上下文。

会话默认只读取：

- 当前课程基本信息。
- 当前小节。
- 当前知识点。
- 必要的前置知识摘要。
- 当前会话历史。
- 相关学习资料。
- 用户指定的上下文。

禁止默认加载其他会话的完整聊天记录。

会话之间可以通过用户主动引用、平台生成的交接摘要进行信息共享。

## 4.7 学习练习

AI 可以生成：

- 单选题。
- 多选题。
- 填空题。
- 判断题。
- 计算题。
- 证明题。
- 应用题。

每道题必须关联知识点。

练习流程：

1. 平台确定练习知识点。
2. AI 生成题目。
3. 平台校验题目格式。
4. 用户答题。
5. AI 评估答案。
6. 平台保存答案和评估结果。
7. 更新练习统计。
8. 给出掌握建议。

AI 评估不能直接将知识点标记为 MASTERED。

## 4.8 资料检索

平台提供独立的资料搜索服务。

搜索来源：

- 公开网页。
- 教育资源。
- 用户上传文件。
- 用户手动添加的资料。

每份资料保存：

- 标题。
- URL。
- 来源名称。
- 作者（如果有）。
- 发布时间（如果有）。
- 获取时间。
- 内容摘要。
- 关联知识点。
- 内容引用位置。

必须区分：

- 有来源支持的结论。
- AI 推断。
- 尚未验证的信息。

---

# 5. 页面结构与交互设计

## 5.1 整体布局

采用专业三栏式学习工作台。

桌面端设计基准：1440 × 900。

布局：

左侧：课程导航栏。
中间：主要工作区。
右侧：知识上下文面板。

### 页面示意

┌──────────────────────────────────────────────────────┐
│ Logo    当前课程       模型选择      设置     用户    │
├─────────────┬────────────────────────┬───────────────┤
│             │                        │               │
│ 课程目录    │      学习工作区        │  知识上下文  │
│             │                        │               │
│ 第一章      │  当前学习内容          │ 当前知识点   │
│  ├─1.1      │                        │               │
│  ├─1.2      │  对话内容              │ 前置知识     │
│  └─1.3      │                        │               │
│             │  输入框                │ 学习状态     │
│ 第二章      │                        │               │
│             │                        │ 资料来源     │
│             │                        │               │
└─────────────┴────────────────────────┴───────────────┘

## 5.2 顶部导航栏

组件：

- 产品 Logo。
- 当前课程名称。
- 模型切换。
- 模型状态。
- 任务运行状态。
- 设置入口。
- 用户头像。

模型切换不得改变学习状态。

## 5.3 左侧导航栏

功能：

- 课程章节树。
- 小节展开与收起。
- 知识点状态标记。
- 当前学习位置。
- 搜索知识点。
- 章节完成度。

状态颜色：

- 已掌握：绿色。
- 学习中：蓝色。
- 需要复习：橙色。
- 未学习：灰色。
- 前置未满足：锁定图标。

点击章节展开小节。

点击小节进入小节工作区。

点击知识点进入对应知识点详情。

## 5.4 中间工作区

中间区域是主要操作区域。

顶部：

- 当前章节。
- 当前小节。
- 当前知识点。
- 会话切换。

主体：

- 会话消息。
- 数学公式。
- 代码块。
- 图片。
- 题目卡片。
- 资料引用。

底部：

- 输入框。
- 上传附件。
- 模式切换。
- 发送按钮。

支持：

- Markdown。
- LaTeX。
- 流式输出。
- 消息复制。
- 重新生成。
- 停止生成。
- 消息引用。
- 新建会话。

## 5.5 右侧知识面板

标签页：

1. 知识点。
2. 前置知识。
3. 学习进度。
4. 参考资料。

知识点页面显示：

- 定义。
- 学习目标。
- 重要程度。
- 当前状态。
- 相关练习。

前置知识页面显示：

- 依赖关系。
- 掌握情况。
- 进入前置知识的快捷入口。

学习进度页面显示：

- 已掌握数量。
- 学习中数量。
- 待学习数量。
- 练习正确率。

参考资料页面显示：

- 来源列表。
- 摘要。
- 引用位置。
- 原始链接。

## 5.6 其他页面

### 首页 / Dashboard

显示：

- 最近学习课程。
- 学习进度。
- 最近活动。
- 待复习知识点。
- 继续学习入口。
- 创建课程入口。

### 课程创建页面

步骤：

1. 基本信息。
2. 上传目录。
3. 识别目录。
4. 核对目录。
5. 生成知识结构。
6. 进入课程。

### 知识图谱页面

使用 React Flow。

支持：

- 节点拖动。
- 依赖连线。
- 节点状态。
- 关系编辑。
- 缩放。
- 搜索。
- 定位当前知识点。

### 设置页面

分为：

账户设置：

- 个人资料。
- 密码。
- 安全。

AI 设置：

- 供应商。
- API Base URL。
- API Key。
- 模型。
- 能力测试。
- 默认模型。

学习设置：

- 学习目标。
- 默认会话类型。
- 学习提醒。

---

# 6. 核心业务流程

## 6.1 创建课程

用户创建课程
→ 上传目录照片
→ OCR
→ AI 解析目录
→ 平台校验
→ 用户确认
→ 保存目录
→ 生成知识点
→ 用户确认
→ 生成前置依赖
→ 平台检查依赖
→ 用户确认
→ 生成课程知识图谱
→ 进入学习工作台。

## 6.2 进入小节

用户点击小节
→ 平台读取小节知识点
→ 查询前置依赖
→ 获取前置知识掌握状态
→ 判断是否满足学习条件
→ 展示前置知识提醒
→ 用户选择补学或继续
→ 创建或打开会话。

不能因为用户选择继续，就自动将未掌握的前置知识视为已掌握。

## 6.3 学习流程

选择知识点
→ 创建会话
→ 加载必要上下文
→ AI 讲解
→ 用户提问
→ AI 回答
→ 用户开始练习
→ AI 生成题目
→ 用户答题
→ AI 评估
→ 平台保存结果
→ 用户查看掌握建议
→ 用户确认状态。

## 6.4 学习结束

结束会话
→ 总结学习成果
→ 提取已确认结论
→ 提取待解决问题
→ 更新 HANDOFF
→ 更新 workbook
→ 保存会话状态。

## 6.5 结构草稿、确认与重新生成

目录、知识点和依赖分别使用 CURRICULUM、KNOWLEDGE、DEPENDENCIES 类型的结构版本。目录与依赖以课程为范围，知识点以小节为范围。

版本状态：

| 状态 | 含义 |
| --- | --- |
| DRAFT | 可编辑、待确认，不影响正式课程结构 |
| CONFIRMED | 已通过校验和用户确认，已应用到正式结构 |
| SUPERSEDED | 已被明确替换的旧草稿或历史确认版本，仅供追溯 |

规则：

1. 首次生成与重新生成都先创建新草稿；重新生成不能直接覆盖当前正式结构、旧草稿或历史版本。
2. 草稿保存生成内容、用户修改和生成来源；草稿编辑采用 revision 乐观锁，修改后递增 revision。确认后内容不可修改。
3. 用户确认时提交 version_id、草稿 revision 和 base_course_revision。平台校验租户、范围、结构、引用和确认前置条件；必须基于用户实际查看的版本确认。
4. 课程 confirmed_revision 是正式结构的单调递增修订号。平台在事务中核对基线，将草稿应用到正式表、递增课程修订号并记录确认人、时间与差异。校验失败全部回滚；版本过期返回 VERSION_CONFLICT，不静默覆盖其他修改。
5. 同一 version_id 的重复确认返回首次确认结果，不重复创建节点或执行状态变更。历史版本再次应用必须复制为新草稿，重新校验和确认。
6. 确认新版本后，同类型、同范围的旧确认版本变为 SUPERSEDED；旧草稿只有经用户明确替换或放弃才变为 SUPERSEDED。历史内容、原始 AI 输出和确认记录保持可追溯。
7. 正式目录、知识点和依赖的编辑同样走草稿确认；PATCH 不得绕过确认直接改变正式结构。目录需先确认才能生成其知识点；知识点需先确认才能用于正式依赖和学习。
8. 重新生成时展示新增、修改、移除项。已有章节、小节和知识点通过正式 ID 显式匹配；标题相同不视为同一节点。匹配的知识点保留 ID、学习状态及其练习、会话和记录；新节点由平台分配 ID，新知识点的学习状态初始化为 NOT_STARTED。
9. 移除已有知识点采用归档；涉及目录节点移除时必须展开列出受影响的知识点。确认前明确处理相关依赖，归档后不参与当前图谱、学习入口和进度统计，历史会话、作答与学习记录仍可读取。不自动迁移或删除历史数据。恢复或合并另需明确操作，不由重新生成隐式执行。
10. 正式结构变化后重新计算前置条件，不能自动将已掌握知识点降级或将未掌握知识点升级。知识点定义实质改变时提示用户复核掌握状态，状态变更仍遵守第 13 章。

---

# 7. 系统技术架构

## 7.1 技术选型

### 前端

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Flow
- KaTeX
- TanStack Query
- Zustand

### 后端

- Python
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic

### 数据库

- PostgreSQL
- pgvector

### 异步任务

- Redis
- Celery

### 文件存储

- S3 兼容对象存储。

### AI

- LiteLLM 或自建模型适配层。
- OpenAI 兼容接口。
- Gemini Adapter。
- Anthropic Adapter。

### 搜索

- 独立 Search Provider Interface。
- 可替换搜索服务商。

## 7.2 系统模块

backend/
app/
api/
auth/
users/
courses/
curriculum/
knowledge/
learning/
sessions/
exercises/
materials/
ai/
workflows/
search/
storage/
security/
tasks/
database/

每个模块应具有清晰的职责。

## 7.3 架构原则

采用模块化单体架构。

首版不使用微服务。

模块之间通过明确的服务接口通信。

AI Gateway 不得直接控制业务数据库。

Workflow Engine 是业务流程执行者。

所有关键业务操作通过后端服务完成。

---

# 8. 数据库设计

所有核心表必须具备：

- id。
- created_at。
- updated_at。

需要用户隔离的表必须包含 user_id，或者通过其所属父级资源实现可验证的租户隔离。

## 8.1 users

| 字段             | 类型      |
| -------------- | ------- |
| id             | UUID    |
| email          | VARCHAR |
| password_hash  | VARCHAR |
| email_verified | BOOLEAN |
| display_name   | VARCHAR |
| role           | VARCHAR |

## 8.2 ai_providers

| 字段                | 类型      |
| ----------------- | ------- |
| id                | UUID    |
| user_id           | UUID    |
| provider_name     | VARCHAR |
| protocol          | VARCHAR |
| base_url          | TEXT    |
| encrypted_api_key | TEXT    |
| enabled           | BOOLEAN |

API Key 必须加密保存。

不得将密钥返回给前端。

## 8.3 ai_models

| 字段                 | 类型      |
| ------------------ | ------- |
| id                 | UUID    |
| provider_id        | UUID    |
| model_name         | VARCHAR |
| supports_vision    | BOOLEAN |
| supports_streaming | BOOLEAN |
| supports_json      | BOOLEAN |
| context_window     | INTEGER |
| enabled            | BOOLEAN |

模型能力需要经过实际探测或用户确认，不能仅凭模型名称推断。

## 8.4 courses

| 字段            | 类型      |
| ------------- | ------- |
| id            | UUID    |
| user_id       | UUID    |
| title         | VARCHAR |
| subject       | VARCHAR |
| textbook      | VARCHAR |
| learning_goal | TEXT    |
| status        | VARCHAR |

courses 另含 confirmed_revision INTEGER NOT NULL DEFAULT 0，用于正式课程结构的并发确认控制，不随会话消息或练习记录写入而递增。

## 8.5 chapters

| 字段          | 类型           |
| ----------- | ------------ |
| id          | UUID         |
| course_id   | UUID         |
| parent_id   | UUID NULL    |
| title       | VARCHAR      |
| order_index | INTEGER      |
| page_start  | INTEGER NULL |
| page_end    | INTEGER NULL |

## 8.6 sections

| 字段          | 类型           |
| ----------- | ------------ |
| id          | UUID         |
| chapter_id  | UUID         |
| title       | VARCHAR      |
| order_index | INTEGER      |
| page_start  | INTEGER NULL |
| page_end    | INTEGER NULL |

## 8.7 knowledge_points

| 字段                  | 类型      |
| ------------------- | ------- |
| id                  | UUID    |
| section_id          | UUID    |
| title               | VARCHAR |
| description         | TEXT    |
| learning_objectives | JSONB   |
| importance          | VARCHAR |
| mastery_criteria    | JSONB   |
| order_index         | INTEGER |
| status              | VARCHAR |

知识点 ID 创建后原则上保持稳定。

status 只使用第 13 章的学习状态枚举，不包含 LOCKED。另含 archived_at TIMESTAMP NULL；归档不改写历史学习状态。知识点来源保存在确认版本及关联资料中，可通过版本变更记录追溯。

## 8.8 knowledge_dependencies

| 字段              | 类型        |
| --------------- | --------- |
| id              | UUID      |
| prerequisite_id | UUID      |
| dependent_id    | UUID      |
| reason          | TEXT      |
| confidence      | FLOAT     |
| status          | VARCHAR   |
| source_id       | UUID NULL |

建立唯一约束：

(prerequisite_id, dependent_id)

禁止自我依赖。

## 8.9 sessions

| 字段                 | 类型        |
| ------------------ | --------- |
| id                 | UUID      |
| user_id            | UUID      |
| course_id          | UUID      |
| section_id         | UUID      |
| knowledge_point_id | UUID NULL |
| title              | VARCHAR   |
| session_type       | VARCHAR   |
| context_policy     | JSONB     |
| status             | VARCHAR   |

## 8.10 messages

| 字段          | 类型        |
| ----------- | --------- |
| id          | UUID      |
| session_id  | UUID      |
| role        | VARCHAR   |
| content     | JSONB     |
| model_id    | UUID NULL |
| token_usage | JSONB     |
| created_at  | TIMESTAMP |

## 8.11 exercises

| 字段                 | 类型      |
| ------------------ | ------- |
| id                 | UUID    |
| exercise_type      | VARCHAR |
| question           | JSONB   |
| answer_key         | JSONB   |
| explanation        | TEXT    |
| difficulty         | VARCHAR |

使用 exercise_knowledge_points 关联表支持一道题关联多个知识点：id UUID、exercise_id UUID、knowledge_point_id UUID、created_at、updated_at；建立 (exercise_id, knowledge_point_id) 唯一约束及外键。每道题至少关联一个当前课程内已确认且未归档的知识点，由平台在入库事务中校验；所有关联点必须属于同一课程。生成、评估、查询和统计统一使用该关联表，不再保留 exercises.knowledge_point_id 单值字段。

知识点正确率按“关联该知识点的已完成评估作答”统计，同一作答对同一知识点只计一次；课程总作答数按 attempt ID 去重，不累加知识点计数。PENDING、失败及取消的评估不计入正确率。

首版正确率分子为 correctness = CORRECT 的作答数，分母为有效完成评估的作答数；PARTIAL 和 INCORRECT 计入分母但不计入分子。一题关联多个知识点时，各点先使用该题整体评估结果，不据此推断每个知识点都已掌握。练习评估状态与 correctness 存入 exercise_attempts.evaluation，遵循统一输出校验规则。

## 8.12 exercise_attempts

| 字段           | 类型        |
| ------------ | --------- |
| id           | UUID      |
| exercise_id  | UUID      |
| user_id      | UUID      |
| answer       | JSONB     |
| score        | FLOAT     |
| evaluation   | JSONB     |
| submitted_at | TIMESTAMP |

## 8.13 learning_records

| 字段                 | 类型        |
| ------------------ | --------- |
| id                 | UUID      |
| user_id            | UUID      |
| knowledge_point_id | UUID      |
| old_status         | VARCHAR   |
| new_status         | VARCHAR   |
| source_type        | VARCHAR   |
| source_id          | UUID NULL |
| reason             | TEXT      |

## 8.14 materials

| 字段          | 类型      |
| ----------- | ------- |
| id          | UUID    |
| course_id   | UUID    |
| title       | VARCHAR |
| url         | TEXT    |
| source_name | VARCHAR |
| summary     | TEXT    |
| content     | TEXT    |
| metadata    | JSONB   |

## 8.15 workflow_runs

| 字段                | 类型      |
| ----------------- | ------- |
| id                | UUID    |
| user_id           | UUID    |
| course_id         | UUID    |
| workflow_type     | VARCHAR |
| status            | VARCHAR |
| input_data        | JSONB   |
| output_data       | JSONB   |
| validation_result | JSONB   |
| error_message     | TEXT    |

## 8.16 project_handoffs

| 字段        | 类型      |
| --------- | ------- |
| id        | UUID    |
| course_id | UUID    |
| workbook  | JSONB   |
| handoff   | JSONB   |
| version   | INTEGER |

## 8.17 structure_versions

结构版本与草稿的权威存储，遵循 6.5：

| 字段 | 类型 / 约束 |
| --- | --- |
| id | UUID |
| user_id | UUID |
| course_id | UUID |
| section_id | UUID NULL；仅 KNOWLEDGE 类型必填，且必须属于该课程 |
| structure_type | Enum：CURRICULUM / KNOWLEDGE / DEPENDENCIES |
| status | Enum：DRAFT / CONFIRMED / SUPERSEDED |
| revision | INTEGER；草稿内容修订号 |
| base_course_revision | INTEGER；生成或编辑时基于的课程修订号 |
| applied_course_revision | INTEGER NULL；确认时应用后的课程修订号 |
| payload | JSONB；结构草稿或不可变确认快照 |
| id_mapping | JSONB；生成临时 ID 与正式 ID 的映射 |
| generation_run_id | UUID NULL；关联 workflow_runs，人工草稿可为空 |
| confirmed_by | UUID NULL |
| confirmed_at | TIMESTAMP NULL |
| change_summary | JSONB；新增、修改、归档及依赖处理差异 |
| created_at / updated_at | TIMESTAMP |

生成来源通过 workflow_runs 关联模型、Prompt 版本及不可覆盖的原始输出，用户编辑不覆盖原始生成记录。确认和版本替换需要记录审计事件。

chapters、sections、knowledge_points、knowledge_dependencies 仅存放已确认的正式结构；草稿节点不提前写入这些表。确认事务负责创建正式 ID 和保存映射。草稿隔离、同范围当前确认版本唯一性及课程修订号校验由平台与数据库约束共同保证。

## 8.18 数据库设计要求

1. 所有用户数据必须实施租户隔离。
2. 删除课程必须处理所属数据。
3. 关键状态变更必须写入 learning_records。
4. 数据库迁移必须通过 Alembic。
5. 重要关联字段建立索引。
6. 禁止直接使用无约束的字符串作为核心状态。
7. 重要业务操作使用事务。
8. 会话消息支持分页。
9. 学习状态更新必须具有幂等性。
10. 对关键操作记录审计日志。

---

# 9. 后端 API 规范

统一前缀：

/api/v1

统一响应结构：

{
"success": true,
"data": {},
"error": null
}

错误结构：

{
"success": false,
"data": null,
"error": {
"code": "VALIDATION_ERROR",
"message": "Invalid input",
"details": {}
}
}

## 9.1 用户

POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/verify-email
POST /auth/forgot-password
POST /auth/reset-password
GET /users/me

## 9.2 模型管理

GET /ai/providers
POST /ai/providers
PATCH /ai/providers/{id}
DELETE /ai/providers/{id}
GET /ai/models
POST /ai/models/test
POST /ai/models/{id}/capability-test

## 9.3 课程管理

GET /courses
POST /courses
GET /courses/{id}
PATCH /courses/{id}
DELETE /courses/{id}

## 9.4 目录

POST /courses/{id}/uploads
POST /courses/{id}/curriculum/parse
GET /courses/{id}/curriculum
PATCH /courses/{id}/curriculum
POST /courses/{id}/curriculum/confirm

GET /courses/{id}/curriculum 返回当前正式目录；解析返回结构草稿及 version_id。PATCH 编辑指定草稿，确认端点按 9.11 提交版本信息。

## 9.5 知识点

GET /sections/{id}/knowledge-points
POST /sections/{id}/knowledge-points/generate
POST /knowledge-points/{id}/confirm
PATCH /knowledge-points/{id}
GET /knowledge-points/{id}

知识点生成返回小节级知识草稿。PATCH /knowledge-points/{id} 创建或编辑包含该正式节点的小节草稿，不直接更新正式节点。

POST /sections/{id}/knowledge-points/confirm 确认整个小节草稿；POST /knowledge-points/{id}/confirm 是单点内容确认入口，仍需引用所属草稿版本。单点入口仅接受只修改该节点、无其他待确认节点变更的草稿；否则返回 VALIDATION_ERROR，要求使用小节级确认。两者均按 6.5 原子应用版本。

## 9.6 知识依赖

GET /courses/{id}/dependencies
POST /courses/{id}/dependencies/propose
POST /dependencies/{id}/confirm
DELETE /dependencies/{id}

PATCH /dependencies/{id}

新增、修改、移除依赖均先写入课程依赖草稿；DELETE 只提出移除，不立即删除正式关系。POST /courses/{id}/dependencies/confirm 确认整个依赖草稿。单条 confirm 入口仅接受只影响该关系的草稿；否则返回 VALIDATION_ERROR，要求使用课程级确认。两种确认都校验完整的候选图并执行 6.5 的版本规则。

## 9.7 学习会话

GET /sessions
POST /sessions
GET /sessions/{id}
DELETE /sessions/{id}
GET /sessions/{id}/messages
POST /sessions/{id}/messages

流式响应使用 SSE。

## 9.8 练习

POST /knowledge-points/{id}/exercises/generate
POST /exercises/{id}/attempts
GET /exercises/{id}/attempts
GET /knowledge-points/{id}/practice-summary

## 9.9 学习状态

GET /courses/{id}/progress
GET /knowledge-points/{id}/status
POST /knowledge-points/{id}/status/confirm
GET /courses/{id}/learning-records

状态查询同时返回 status、prerequisite_status 及未满足的前置知识点列表；会话继续选择不得覆盖这些字段。状态确认需要 expected_status 与幂等键，重复请求不重复记录；并发状态不符返回 VERSION_CONFLICT。

## 9.10 资料

POST /courses/{id}/materials/search
GET /courses/{id}/materials
GET /materials/{id}

所有接口必须检查用户权限。

## 9.11 结构版本契约

GET /courses/{id}/structure-versions
GET /courses/{id}/structure-versions/{version_id}
PATCH /courses/{id}/structure-versions/{version_id}

版本列表支持 structure_type、section_id 和 status 筛选；读取、编辑和确认均验证所属用户及课程。版本 PATCH 只允许编辑 DRAFT，提交 expected_revision，成功后返回新的 revision。编辑已确认结构时先复制当前快照为新草稿，由对应目录、知识点或依赖编辑入口完成。

所有结构确认请求包含 version_id、expected_revision、base_course_revision，并明确确认差异；返回 version_id、applied_course_revision、id_mapping 和变更摘要。引用旧修订号或类型、范围不匹配时拒绝应用；过期修订号返回 HTTP 409 / VERSION_CONFLICT。

确认版本与学习状态确认是不同操作：内容确认不能将知识点自动设为 MASTERED。状态确认遵循第 13 章。

---

# 10. AI 模型接入规范

## 10.1 供应商架构

定义统一接口：

LLMProvider

必须提供：

- chat()
- stream()
- generate_structured()
- test_connection()
- get_capabilities()

不同供应商实现不同 Adapter。

## 10.2 首发支持

第一批：

- OpenAI 兼容接口。
- Google Gemini。
- Anthropic Claude。

本地模型通过 OpenAI 兼容接口接入。

## 10.3 模型能力

统一能力字段：

{
"vision": true,
"streaming": true,
"structured_output": true,
"tool_calling": true,
"max_context_tokens": 128000
}

能力必须通过模型配置或实际探测获得。

## 10.4 能力降级

没有视觉能力：

图片 → OCR → 文本 → 模型。

不支持结构化输出：

普通生成 → JSON 提取 → Schema 验证 → 修复重试。

不支持工具调用：

由平台执行搜索 → 将搜索结果提供给模型。

上下文不足：

压缩当前会话 → 提取必要摘要 → 重新构造上下文。

## 10.5 统一模型调用结构

{
"task_type": "knowledge_extraction",
"provider_id": "uuid",
"model_id": "uuid",
"input": {},
"output_schema": {},
"timeout": 60,
"retry_policy": {
"max_retries": 2
}
}

任何模型调用都必须记录：

- 供应商。
- 模型。
- 任务类型。
- 执行时间。
- Token 使用量（如果可获取）。
- 执行状态。
- 错误信息。

不得记录 API Key。

---

# 11. Prompt 工程规范

Prompt 不允许散落在代码中。

统一放置：

backend/prompts/

curriculum/
parse_directory.md

knowledge/
extract_points.md
analyze_dependencies.md

research/
summarize_materials.md

teaching/
explain_concept.md
solve_example.md
answer_question.md

exercises/
generate_exercise.md
evaluate_answer.md

learning/
summarize_session.md
generate_handoff.md

每个 Prompt 必须有版本号。

每次执行记录 Prompt 版本。

## 11.1 目录识别 Prompt

任务：
从教材目录中提取层级结构。

输入：

- OCR 文本。
- 图片描述。
- 教材名称。

输出：

{
"chapters": [
{
"title": "第一章 函数与极限",
"page_start": 1,
"page_end": 35,
"sections": [
{
"title": "1.1 函数",
"page_start": 1,
"page_end": 10
}
]
}
],
"uncertain_items": []
}

限制：

- 不得凭空添加章节。
- 无法识别的页码使用 null。
- 不确定标题必须进入 uncertain_items。
- 不得自行修改原始目录含义。

## 11.2 知识点拆分 Prompt

任务：
将小节拆分为可独立学习和评估的知识点。

输出：

{
"knowledge_points": [
{
"temp_id": "kp_001",
"existing_knowledge_point_id": null,
"title": "函数的定义",
"description": "理解函数的基本定义",
"learning_objectives": [
"能够解释函数的定义",
"能够判断函数关系"
],
"importance": "HIGH",
"mastery_criteria": [
"能够正确解释定义",
"能够完成基础判断题"
]
}
],
"uncertain_items": []
}

要求：

- 一个知识点应当有明确学习目标。
- 不得把整节内容作为一个知识点。
- 不得无限拆分细节。
- 相似知识点应避免重复。
- 不确定内容必须明确标记。

temp_id 仅用于生成草稿，必须在该草稿内唯一；正式 ID 由平台在确认事务中分配，映射保存到 structure_versions.id_mapping 并返回前端。临时 ID 不得作为正式表外键。

重新生成输出匹配已有知识点时，显式提供 existing_knowledge_point_id；新节点该字段为空。平台验证该 ID 属于当前小节且未归档，拒绝重复或越界映射；用户在差异确认时核对匹配。确认保留已有 ID；模型不得自行分配正式 ID。

## 11.3 前置知识分析 Prompt

输入：

- 当前知识点。
- 当前课程全部已确认知识点。
- 已有知识关系。

输出：

{
"dependencies": [
{
"prerequisite_id": "<已确认前置知识点的 UUID>",
"dependent_id": "<已确认后继知识点的 UUID>",
"reason": "理解该知识需要先掌握函数定义",
"confidence": 0.95
}
],
"uncertain_items": []
}

要求：

- 只能引用输入中的知识点。
- 不得自行创造节点。
- 不得建立自我依赖。
- 不确定关系应标记待确认。
- 不得将相关性直接视为必要依赖。

平台负责检查循环依赖。

依赖分析在知识点确认、临时 ID 映射完成后执行；输入只包含正式 ID，输出直接引用相同 ID。跨小节、跨章节关系也使用正式 ID，不将不同草稿内的 temp_id 相互引用。候选依赖只写入草稿，确认时再次校验完整候选图及当前节点有效性。

## 11.4 资料整理 Prompt

输入：

- 当前知识点。
- 搜索结果。
- 来源内容。

输出：

{
"summary": "资料总结",
"claims": [
{
"claim": "核心结论",
"source_ids": ["source_001"],
"confidence": 0.9
}
],
"unsupported_claims": [],
"conflicts": []
}

要求：

- 不得伪造来源。
- 不得将搜索摘要当作完整原文。
- 不确定内容必须标记。
- 相互冲突的资料必须保留冲突信息。

## 11.5 教学 Prompt

输入：

- 当前知识点。
- 学习目标。
- 已有前置知识。
- 当前会话历史。
- 相关资料。

任务：
以教师身份帮助用户理解知识。

教学原则：

1. 先解释概念。
2. 再解释为什么。
3. 使用例子。
4. 给出必要公式。
5. 解释常见错误。
6. 检查用户是否理解。
7. 根据用户反馈调整难度。

禁止：

- 无依据编造教材内容。
- 把推测当作事实。
- 未经用户要求直接跳过推导。
- 无必要重复整节教材。

## 11.6 例题 Prompt

任务：
生成或讲解与当前知识点匹配的例题。

输出：

- 题目。
- 考查知识点。
- 解题思路。
- 详细步骤。
- 最终答案。
- 常见错误。

数学内容必须使用正确的 LaTeX 格式。

## 11.7 练习生成 Prompt

输出：

{
"exercises": [
{
"type": "SINGLE_CHOICE",
"knowledge_point_ids": ["<已确认知识点的 UUID>"],
"difficulty": "EASY",
"question": "题目内容",
"options": [
"A",
"B",
"C",
"D"
],
"answer": "A",
"explanation": "答案解释"
}
]
}

要求：

- 每道题必须对应明确知识点。
- 题目和答案必须一致。
- 不得出现多解但只有单一答案的选择题。
- 生成后必须经过平台结构校验。
- 正式入库前检查答案完整性。

knowledge_point_ids 必须非空、无重复，且均为同一课程内已确认、未归档的正式 UUID。平台将全部关联写入 exercise_knowledge_points，不能只保存数组的第一项。

## 11.8 答案评估 Prompt

输入：

- 题目。
- 标准答案。
- 用户答案。
- 评分规则。

输出：

{
"correctness": "PARTIAL",
"score": 70,
"reasoning": "评估理由",
"mistakes": [
{
"description": "错误说明",
"knowledge_point_id": "<该练习关联知识点的 UUID>"
}
],
"suggestion": "建议复习相关概念"
}

禁止：

- 随意改变标准答案。
- 仅凭答案表面相似判断数学证明正确。
- 将错误归因于无关知识点。
- 直接修改掌握状态。

mistakes 中的 knowledge_point_id 必须属于该练习已保存的关联集合；否则评估不通过业务校验，不更新统计或学习状态。

## 11.9 会话总结 Prompt

输出：

{
"completed": [],
"confirmed_conclusions": [],
"unresolved_questions": [],
"misconceptions": [],
"next_steps": []
}

必须区分：

- 用户已经理解并确认的内容。
- AI 给出的建议。
- 尚未解决的问题。

## 11.10 交接 Prompt

输出：

{
"session_id": "uuid",
"current_task": "当前任务",
"achievements": [],
"unresolved_issues": [],
"next_steps": [],
"related_knowledge_points": []
}

交接摘要不得替代原始会话记录。

---

# 12. AI 输出校验机制

所有 AI 结构化输出经过统一验证管线。

流程：

AI Output
→ JSON Parsing
→ Schema Validation
→ Business Validation
→ Referential Integrity
→ User Confirmation
→ Database Transaction

## 12.1 格式校验

使用 Pydantic。

不符合 Schema：

- 允许最多两次修复重试。
- 仍失败则返回人工处理状态。

## 12.2 业务校验

例如知识依赖：

- 节点存在。
- 节点属于同一课程。
- 不允许自我依赖。
- 不允许循环依赖。

例如练习：

- 题目完整。
- 题目类型合法。
- 关联知识点存在。
- 答案完整。

## 12.3 版本控制

每次 AI 生成结果保存：

- Prompt 版本。
- 模型版本。
- 原始输出。
- 校验结果。
- 用户确认结果。

AI 修复时不得覆盖原始输出。

---

# 13. 知识管理与学习状态

## 13.1 状态机

学习状态与前置条件是两个独立维度。学习状态只有 NOT_STARTED、LEARNING、PRACTICING、NEEDS_REVIEW、MASTERED；LOCKED 不属于持久化学习状态。

| 原状态 | 目标状态 | 允许触发条件 |
| --- | --- | --- |
| NOT_STARTED | LEARNING | 用户开始学习；前置条件未满足时需明确选择“仍然学习” |
| LEARNING | PRACTICING | 用户开始该知识点的练习 |
| PRACTICING | NEEDS_REVIEW | 有效完成的练习评估为错误或部分正确，由平台规则记录 |
| PRACTICING | LEARNING | 用户选择返回学习 |
| NEEDS_REVIEW | LEARNING | 用户开始复习或继续学习 |
| 任一非 MASTERED 状态 | MASTERED | 用户明确确认掌握；允许手动确认，不以练习达标为强制前提 |
| MASTERED | NEEDS_REVIEW | 用户主动撤销掌握或明确接受复习建议 |

除表中列出的转换外均拒绝；同状态重复请求为幂等操作，不产生重复学习记录。所有实际转换由平台执行，写入操作者、来源、理由、时间及前后状态。练习答错与“评估服务失败”必须区分：后者不触发转换；练习全对仅产生掌握建议，仍需用户确认。评估提交状态变更时须核对预期状态，不能覆盖用户之后的手动确认。

prerequisite_status 根据当前已确认依赖计算：所有前置知识点均为 MASTERED 才是 SATISFIED，否则为 UNSATISFIED。依赖和前置掌握变化只重算该字段，不将学习状态自动重置为 NOT_STARTED，也不自动降级 MASTERED。

前置未满足时界面显示锁定提示及补学、仍然学习入口。创建会话或首次进入该会话学习时提交显式继续选择；服务端保存当时的未满足知识点及选择时间。继续选择只放行该会话，未掌握提醒持续显示，前置状态按最新数据重算。手动确认掌握当前知识点不会顺带确认其前置知识点。

## 13.2 掌握判定

首版采用规则与人工确认结合。

系统可以给出掌握建议，但不自动替用户确认。

建议评估参考：

- 概念理解。
- 基础题正确率。
- 综合题正确率。
- 错误类型。
- 用户自我确认。

## 13.3 学习状态记录

每次状态变化必须记录：

{
"knowledge_point_id": "uuid",
"old_status": "PRACTICING",
"new_status": "MASTERED",
"source_type": "USER_CONFIRMATION",
"reason": "用户确认掌握"
}

---

# 14. 项目文件与上下文管理

每门课程维护独立学习项目状态，与开发本平台的软件项目文档分开管理。

| 范围 | 内容 | 权威存储 / 可读视图 |
| --- | --- | --- |
| 课程学习项目 | 学习进度、会话任务、已确认结论、待解决问题 | project_handoffs 中按 course_id 隔离的结构化 workbook、handoff；可导出课程级 Markdown |
| 软件开发项目 | 开发任务与协作登记、开发交接、运行和部署方法 | 仓库根目录 workbook.md、HANDOFF.md、RUNBOOK.md |

课程级 Markdown 导出时使用 courses/{course_id}/workbook.md 和 courses/{course_id}/HANDOFF.md 这样的隔离路径，或等价的对象存储键；不得写入或覆盖软件仓库根目录同名文件。课程不生成 RUNBOOK.md。

## 14.1 课程级 workbook

记录：

- 当前课程进度。
- 当前各个会话。
- 每个会话正在处理什么。
- 涉及哪些知识点。
- 可能影响哪些共享数据。
- 最近一次更新时间。

## 14.2 课程级 HANDOFF

记录：

- 当前任务。
- 已完成成果。
- 尚未解决的问题。
- 已确认结论。
- 待验证内容。
- 下一步任务。
- 关联会话。

## 14.3 软件开发项目 RUNBOOK.md

记录：

- 项目运行方法。
- 数据库启动。
- 后端启动。
- 前端启动。
- 测试方法。
- 构建方法。
- 部署方法。

课程级 workbook、HANDOFF 以数据库中的结构化记录为权威来源，Markdown 仅为带课程 ID 和版本号的可读交接视图；重新导出不反向覆盖数据库。仓库根目录的三个文档服务软件开发和运维，不属于用户学习上下文，默认不发送给教学模型。

第 21–23 章为软件开发项目文档模板；课程学习记录使用本章的课程级字段与隔离规则。第 6.4 章以及 Phase 8 的 workbook、HANDOFF 生成均指课程学习记录，阶段结束更新开发文档的要求则指仓库根目录文件。

---

# 15. 安全与隐私

## 15.1 API Key

- 使用服务端加密。
- 密钥不得传回前端。
- 不得进入日志。
- 不得写入 Prompt。
- 支持删除和轮换。

## 15.2 用户数据

- 每个用户拥有独立课程空间。
- 所有查询进行用户权限检查。
- 文件下载使用短期签名 URL。
- 限制上传文件类型和大小。
- 文件进行恶意内容检测。

## 15.3 第三方 AI

在首次使用外部模型前明确告知：

- 哪些内容会发送给供应商。
- 供应商名称。
- 可能包含的课程资料和对话。
- 数据由第三方如何处理，以其实际政策为准。

## 15.4 Prompt Injection

上传文件和搜索网页都属于不可信内容。

模型必须明确区分：

- 系统指令。
- 平台任务指令。
- 用户输入。
- 外部资料。

外部资料不得覆盖系统规则。

---

# 16. 异常处理

| 异常         | 处理        |
| ---------- | --------- |
| OCR 失败     | 提供手动输入    |
| 图片不清晰      | 提示重新上传    |
| 模型不可用      | 允许切换模型    |
| API Key 错误 | 显示配置错误    |
| JSON 格式错误  | 自动修复并重试   |
| 知识点重复      | 提示合并      |
| 依赖循环       | 拒绝提交      |
| 搜索失败       | 允许无资料模式学习 |
| 会话中断       | 保存已接收消息   |
| 网络断开       | 支持重连      |
| Token 超限   | 压缩上下文     |
| 数据库失败      | 事务回滚      |
| 练习评估失败     | 不修改学习状态   |

所有异步任务都必须有状态：

PENDING
RUNNING
SUCCEEDED
FAILED
CANCELLED

重要任务需要支持重试。

---

# 17. 测试规范

## 17.1 单元测试

必须覆盖：

- 用户权限。
- 课程创建。
- 目录解析。
- 知识点 ID。
- 依赖关系。
- 循环检测。
- 状态机。
- Prompt 加载。
- JSON 校验。
- 模型 Adapter。

## 17.2 集成测试

测试：

- 注册到创建课程。
- 上传图片到目录确认。
- 目录确认到知识点生成。
- 知识点到依赖关系。
- 进入小节到前置诊断。
- 创建会话到流式回复。
- 生成练习到评估。
- 学习状态到进度统计。

## 17.3 模型兼容测试

至少准备两个不同协议的供应商。

同一组测试任务分别运行。

检查：

- 是否能够正确调用。
- 是否能返回结构化数据。
- 是否能流式输出。
- 是否支持降级方案。
- 是否保留一致的业务行为。

不要求不同模型产生完全相同的答案，但要求输出满足统一协议。

## 17.4 核心验收测试

测试教材：

高等数学第一章。

完整测试：

1. 上传目录照片。
2. 识别目录。
3. 手动修改章节。
4. 确认目录。
5. 生成知识点。
6. 修改知识点。
7. 分析前置依赖。
8. 验证循环依赖检测。
9. 打开一个小节。
10. 创建两个不同类型的会话。
11. 验证上下文隔离。
12. 完成概念学习。
13. 生成练习。
14. 提交答案。
15. 获取评估。
16. 查看学习状态。
17. 用户确认掌握。
18. 重新打开课程。
19. 验证状态持久化。
20. 更换 AI 模型。
21. 继续原会话。
22. 验证课程和学习状态不变。

## 17.5 状态、版本与关联一致性验收

- 前置未满足时显示锁定提示；用户仍然学习后当前知识点可进入 LEARNING，前置知识状态不变，其他会话仍需独立选择。前置条件后续变化不重置学习状态。
- 覆盖 13.1 的合法与非法转换、重复请求、并发确认、错误或部分正确评估、评估服务失败，以及全对后仍需用户确认掌握；延迟评估不能覆盖已完成的手动确认。
- 目录、知识点和依赖的草稿在确认前均不进入正式查询与学习流程；编辑已确认内容也必须生成草稿。确认失败回滚全部变更，过期确认返回 VERSION_CONFLICT，重复确认不重复建点。
- 重新生成保留旧结构直至确认；匹配节点保留正式 ID、状态和历史关联。移除节点需确认归档及相关依赖处理；历史记录可读，当前图谱和进度不再包含归档点。
- 临时 ID 在草稿内唯一；正式确认产生映射，依赖分析只接收正式 UUID。拒绝跨课程、跨小节错误匹配、重复映射及未确认或归档节点引用。
- 一道练习关联至少两个知识点时，全部关联可查询、评估错误只能引用关联集合，统计不会重复累计课程作答数；空集合、重复 ID 及跨课程 ID 被拒绝。
- 两门课程的 workbook、HANDOFF 分别存储和导出，带有对应课程与版本标识；导出不修改数据库或软件仓库根目录文档，不生成课程 RUNBOOK。

---

# 18. 部署与运维

## 18.1 部署架构

前端：
Next.js

后端：
FastAPI

数据库：
PostgreSQL

缓存：
Redis

文件：
S3 Compatible Storage

后台任务：
Celery Worker

## 18.2 Docker Compose

开发环境至少包含：

- frontend
- backend
- postgres
- redis
- worker

生产环境可采用托管 PostgreSQL、对象存储和独立应用容器。

## 18.3 环境变量

必须提供 .env.example。

包括：

- DATABASE_URL
- REDIS_URL
- SECRET_KEY
- ENCRYPTION_KEY
- STORAGE_ENDPOINT
- STORAGE_ACCESS_KEY
- STORAGE_SECRET_KEY

真实密钥不得提交 Git。

## 18.4 日志

记录：

- 请求 ID。
- 用户 ID。
- 任务 ID。
- 工作流。
- 模型。
- 执行时间。
- 错误代码。

不记录 API Key 和未经脱敏的敏感内容。

---

# 19. MVP 验收标准

首版交付必须满足以下条件。

### 用户系统

- [ ] 用户能够注册和登录。
- [ ] 用户之间的数据完全隔离。

### 课程系统

- [ ] 能够创建课程。
- [ ] 能够上传多张目录照片。
- [ ] 能够识别目录。
- [ ] 能够手动修改目录。
- [ ] 能够确认目录。

### 知识系统

- [ ] 能够生成知识点。
- [ ] 能够编辑知识点。
- [ ] 能够生成依赖关系。
- [ ] 能够检测循环依赖。
- [ ] 能够显示知识图谱。
- [ ] 草稿、确认和重新生成符合版本规则；知识点 ID 稳定，历史记录可追溯，并发确认不会覆盖他人修改。

### 学习系统

- [ ] 能够创建多个独立会话。
- [ ] 能够隔离会话上下文。
- [ ] 能够正常流式对话。
- [ ] 能够生成练习。
- [ ] 能够评估答案。
- [ ] 能够确认掌握状态。
- [ ] 能够保存学习进度。
- [ ] 前置条件与学习状态独立，合法转换和手动掌握确认均符合状态机。
- [ ] 一道题可关联多个知识点，生成、评估、查询及统计使用一致的关联集合。

### AI 系统

- [ ] 至少支持 OpenAI 兼容协议。
- [ ] 至少支持一种独立协议。
- [ ] 能够切换模型。
- [ ] 能够处理模型调用失败。
- [ ] 能够校验结构化输出。

### 交付系统

- [ ] 有完整 README。
- [ ] 有 workbook.md。
- [ ] 有 HANDOFF.md。
- [ ] 有 RUNBOOK.md。
- [ ] 有数据库迁移。
- [ ] 有自动化测试。
- [ ] 能通过 Docker 启动。
- [ ] 课程级学习记录与开发文档隔离，课程导出不会覆盖仓库文件。

---

# 20. Codex 开发任务清单

采用分阶段开发，不允许一次性生成整个项目后再调试。

每个阶段必须经过测试和验收。

## Phase 0：项目初始化

任务：

- 初始化 Git。
- 创建前后端项目。
- 配置 TypeScript。
- 配置 FastAPI。
- 配置 PostgreSQL。
- 配置 Redis。
- 配置 Docker Compose。
- 配置环境变量。
- 配置 CI。
- 创建基础文档。

验收：

- 项目可以启动。
- 数据库连接正常。
- 测试命令正常。
- 前后端通信正常。

## Phase 1：用户与课程

任务：

- 用户注册。
- 邮箱验证。
- 登录。
- 用户权限。
- 课程 CRUD。
- 文件上传。
- 用户数据隔离。

验收：

- 两个不同用户不能读取对方课程。
- 课程数据可以持久化。
- 文件可以安全上传和读取。

## Phase 2：AI Gateway

任务：

- 定义统一 Provider Interface。
- 实现 OpenAI 兼容 Adapter。
- 实现 Gemini Adapter。
- 实现 Claude Adapter。
- 实现模型配置。
- 实现 API Key 加密。
- 实现能力测试。
- 实现调用日志。
- 实现错误处理。

验收：

- 至少两个协议能够正常运行。
- 更换模型不改变业务数据。
- 密钥不会暴露给前端。

## Phase 3：目录识别

任务：

- 图片上传。
- OCR。
- 目录解析 Prompt。
- 目录 JSON Schema。
- 目录校验。
- 目录编辑器。
- 目录确认。
- 章节数据库持久化。

验收：

- 能够完成高数目录照片识别。
- 用户可以修正错误。
- 未确认数据不会成为正式目录。

## Phase 4：知识结构

任务：

- 知识点生成。
- 知识点编辑。
- 知识点 ID 管理。
- 前置依赖分析。
- 依赖循环检测。
- 依赖确认。
- 知识图谱页面。

验收：

- 生成结果可以修改。
- 依赖关系经过校验。
- 图谱与数据库保持一致。

## Phase 5：学习工作台

任务：

- 三栏式界面。
- 左侧课程树。
- 中间对话区。
- 右侧知识面板。
- 会话管理。
- 多会话隔离。
- SSE 流式输出。
- Markdown 渲染。
- KaTeX 渲染。

验收：

- 能够同时创建多个学习会话。
- 不同会话不自动混入对方聊天记录。
- 刷新页面后能够恢复会话。

## Phase 6：学习与练习

任务：

- 教学 Prompt。
- 例题 Prompt。
- 练习生成。
- 练习提交。
- 答案评估。
- 错误归因。
- 学习状态机。
- 学习记录。
- 学习进度统计。

验收：

- 能完成一次完整的知识点攻关。
- 状态更新可追溯。
- AI 不能绕过平台规则修改掌握状态。

## Phase 7：资料检索

任务：

- 搜索接口。
- 搜索结果标准化。
- 来源管理。
- 资料总结。
- 引用关联。
- 搜索失败降级。

验收：

- 资料具有来源。
- 总结能够关联具体来源。
- 无来源的内容不能伪装成有来源的结论。

## Phase 8：上下文管理

任务：

- workbook 生成。
- HANDOFF 生成。
- 会话摘要。
- 上下文选择。
- 共享结论管理。
- 上下文压缩。

验收：

- 新会话只读取必要上下文。
- 不会自动加载全部课程聊天记录。
- 已确认结论和 AI 推测分开保存。

## Phase 9：质量与部署

任务：

- 单元测试。
- 集成测试。
- 模型兼容测试。
- 用户权限测试。
- 安全测试。
- 性能测试。
- Docker 部署。
- 生产环境配置。
- README。
- RUNBOOK。

验收：

- MVP 全部验收用例通过。
- 能够从全新环境完成部署。
- 能够恢复数据库备份。
- 生产环境密钥不暴露。

---

# 21. workbook.md

软件开发项目协作工作簿模板；课程学习 workbook 的字段与存储边界见第 14 章。

```markdown
# WORKBOOK

## 项目状态
当前版本：
当前阶段：
最近更新时间：

## 当前任务

| 会话 | 当前工作 | 影响范围 | 状态 |
|---|---|---|---|
| Session A | 知识点拆分 | Knowledge | In Progress |
| Session B | AI Adapter | AI Gateway | In Progress |

## 共享资源

- 数据库 Schema
- API Contract
- Prompt Registry
- Knowledge Graph

## 修改影响

记录每次修改可能影响的模块。

## 当前阻塞

记录尚未解决的技术问题。

## 任务队列

- [ ] 待处理任务
- [ ] 待验证任务
```

---

# 22. HANDOFF.md

软件开发任务交接模板；课程学习 HANDOFF 的字段与存储边界见第 14 章。

```markdown
# HANDOFF

## 当前任务

## 已完成成果

## 已确认结论

## 尚未解决的问题

## 待验证内容

## 影响范围

## 下一步

1.
2.
3.

## 相关文件

## 相关会话

## 最后更新时间
```

必须将确定事实、AI 推测和待确认事项分开记录。

---

# 23. RUNBOOK.md

项目运行手册模板。

```markdown
# RUNBOOK

## 环境要求

- Node.js
- Python
- Docker
- PostgreSQL
- Redis

## 首次启动

1. 克隆项目。
2. 配置环境变量。
3. 启动 Docker Compose。
4. 执行数据库迁移。
5. 启动前端。
6. 启动后端。

## 常用命令

### 启动

docker compose up -d

### 停止

docker compose down

### 数据库迁移

alembic upgrade head

### 测试

pytest

### 前端构建

npm run build

## 故障排查

记录常见错误及处理方法。

## 数据备份

记录数据库和文件存储的备份方式。

## 生产部署

记录部署步骤、环境变量和回滚方法。
```

---

# 最终开发约束

Codex 必须遵守以下要求：

1. 不得擅自改变产品核心架构。
2. 不得将 AI 直接作为业务状态管理器。
3. 不得将学习进度保存在浏览器本地作为唯一数据源。
4. 不得把所有 Prompt 合并成一个巨型 Prompt。
5. 不得把不同会话的历史记录自动混合。
6. 不得跳过 AI 输出验证。
7. 不得绕过用户确认机制。
8. 不得在没有测试的情况下声称功能完成。
9. 不得擅自删除已有功能或修改数据库结构而不提供迁移。
10. 每个阶段结束必须更新 workbook.md 和 HANDOFF.md。
11. 每个功能必须有对应的验收测试。
12. 发现产品规格存在矛盾时，先记录问题，不得擅自作出不可逆的产品决策。

## 项目完成定义

本项目不是以页面数量或代码量作为完成标准。

真正的完成标准是：

用户上传一本高等数学教材的目录，平台能够正确建立课程结构、知识点和前置关系；用户能够在专业学习工作台中创建多个隔离的学习会话，完成知识讲解、练习、评估和掌握确认；更换 AI 供应商后，原有课程、知识图谱和学习进度依然完整。

**平台管理学习，AI 辅助学习，用户决定自己是否真正掌握。**

这就是本产品的核心价值。
