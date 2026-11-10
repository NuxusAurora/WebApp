# 腾讯云正式应用

正式入口：https://learn.nuxusaurora.cn 。使用正式 Next.js、FastAPI、Worker、PostgreSQL、Redis 和私有 S3 存储；不是 Sites 浏览器体验适配器。用户选择云端新建数据库，保留本地服务和数据。SMTP 尚未配置，注册和找回密码明确显示暂不可用；未迁移本地账户或供应商密钥。

## 2026-11-10 当前：模型调用分阶段诊断

后端/Worker发布a9945983d582c7be7fca743efa498b1107ac64dd，current为releases/a994598；本地同步，前端镜像保持3d924db。非流式Gateway.execute新增ai_call_diagnostics与失败尝试ai_call_attempt，目录请求关联request_id/ai_call_id；区分连接/TLS/发送、响应头/正文等待、响应JSON、目录JSON、Schema、重试退避及审计。字段、脱敏边界和查询命令见RUNBOOK对应节。原90秒上限/重试/API契约保持，未新增依赖或迁移。

156项后端全量、Ruff/格式及运行镜像构建通过。两端运行后端中以独立合成loopback HTTP验证等待响应头（http_status null、0字节）和部分200正文（11字节）超时，确认阶段/网络trace事件/总限来源正确；没有真实供应商重试或用户图片外发。六服务健康、health/ready200，前端/数据服务镜像保持，停写备份/切换/验证后业务表数量和排序行摘要相同，Nginx模板匹配。

云端临时归档/备份/脚本314790925逻辑字节和旧backend标签已清理，保留当前源快照/运行依赖/数据/密钥。本地任务包/旧和任务镜像/普通worktree收尾清理。精确来源/运行摘要见production.json，GitHub/Sites未更新。历史失败没有上游阶段数据；需要下一次实际调用的日志进一步定位，不能把合成验证当作用户原始问题已修复。

## 2026-11-10 上传诊断日志（历史）

后端/Worker发布f514e1cc5ae926ea7f70eaff030269f3de27b755，current为releases/f514e1c；前端镜像保持3d924db，本地同步更新后端/Worker。新增curriculum_image_validation日志，将安全图片元数据、SHA256、解码阶段/原因分类/异常类型关联到请求编号；不记录图片内容、原文件名、异常原文或凭据。字段和查询命令见RUNBOOK对应节。

142项后端全量、Ruff/格式及运行镜像构建通过。正式HTTPS及本地分别验证正常JPEG上传201、截断JPEG400，日志精确包含decode/truncated_image/OSError，且能关联同编号400请求；QA课程/图片/会话清理，未调用模型，原业务行数量/排序摘要保持。六服务健康、health/ready200，前端/数据服务镜像不变；无迁移，停写后做数据库/对象/环境一致备份，Nginx模板匹配。

旧用户失败3eedc496仅有400/39.57ms，无法回填当时解码细节。当前日志便于下一次实际失败定位，不宣称合成样例证明用户图片截断。云端临时包/归档/备份/脚本313980142逻辑字节及旧backend标签已清理，保留当前源快照/运行依赖/数据/密钥。本地任务包/旧及任务镜像/普通worktree收尾清理，GitHub和Sites未更新；精确来源/运行摘要见production.json。

## 2026-11-10 扩展图片格式（历史）

已将3d924dbf42722064b79ab2392dbf82b3d6aed2b4的前端、后端和Worker同步到本地localhost:3000及正式站，current为releases/3d924db。目录上传支持JPG/JPEG、PNG、WebP、BMP、单帧GIF、单页TIFF和静态AVIF，保持50MiB且不限制像素；统一转为纠正方向/白底的RGB PNG进入私有存储，HEIC/HEIF和SVG未接入。

复用相同源码已通过的38项后端、23项前端回归及Ruff/类型检查，运行镜像生产构建通过。本地与正式运行后端七种格式真实转换成功；两端通过前端HTTP/正式HTTPS上传JPG与AVIF均201，私有存储PNG字节/尺寸正确，临时QA课程/图片和会话清理，未调用模型。两端health/ready 200、六服务健康，实际提供的JS包含JPG及新增格式筛选。未新增浏览器视觉或真实模型质量验收。

服务器停写后一致备份数据库/对象存储/环境配置，切换前后及QA清理后原业务表数量与排序行摘要相同；无数据库迁移，账户/课程/模型配置和密钥保留，数据服务镜像保持。Nginx运行配置与当前模板渲染完全匹配，无需修改。验收后清理云端临时归档/回退备份/脚本（统计478,002,347逻辑字节，不代表净磁盘释放）及两份旧应用镜像；保留源快照/当前运行依赖/用户数据。精确镜像摘要及当前回执见production.json。本地部署包/脚本及无依赖旧镜像收尾清理，GitHub和Sites未更新。

## 2026-11-10 500000上下文与精简面包屑（历史）

正式默认Aurora-Zyron的已保存上下文从4096修正为500000，本地已是500000；仅更新唯一默认模型JSON字段，事务回读确认其他模型字段（除updated_at）、能力测试和连接/密钥保持。通用未知模型兜底仍为4096，自定义配置不变；未调用模型或写课程，50万长输入容量未新增实测。

前端d4b46a5a164631388c1e84c713faada979ef3b16已发布，current为releases/d4b46a5；移除面包屑最前“个人空间”及相邻箭头，保留实际页面/课程层级。61项相关回归、类型/生产构建/设计检测通过；1280×720深色正式浏览器核对课程列表/详情、面包屑返回和模型设置层级，390×844模型页无横向溢出；正式模型上下文字段500000、原能力测试状态保持。浅色/真实手机硬件未新增验收。

本地前端同步更新，HTTPS health/ready 200、六服务健康，其他服务源码/镜像保持且未重启。云端上传包/回退配置清理70,291,301逻辑字节，临时脚本及旧前端镜像已清理；来源/摘要集中见production.json。保留当前运行依赖、源快照、用户数据和密钥，GitHub与Sites未更新。

## 2026-11-10 目录与小节统一样式（历史）

前端bd8e61846d5d369d516dfa9b4b874d6f2cd14bf9已发布，current为releases/bd8e618。目录与小节移除旧外层样式，和课程概览、上传教材目录图片共用标题、状态、页签间距、内边距、主题及内容滚动区；内部控件、卡片、字重与颜色沿用共享Token，原操作流程保持。

54项课程/工作区与知识点回归、TypeScript、生产构建和设计检测通过。1280×720/390×844深色只读样例及正式浏览器确认三个页签外层样式一致、无横向溢出；样例额外验证知识草稿卡片展开、长文本完整高度及内容滚动，正式课程为空态。浅色/真实手机硬件未新增验收。纯格式无解耦重构，无用户数据写入或模型调用。

本地前端同步更新，HTTPS health/ready 200、六服务健康；非前端源码/运行镜像保持。云端上传包/回退配置清理70,290,575逻辑字节，临时脚本及旧前端镜像已清理；来源/摘要集中见production.json。保留运行依赖、源快照、用户数据和密钥，GitHub与Sites未更新。

## 2026-11-10 所选学科高亮（历史）

前端f0a1a47984761eeca0b31e2b15e1a38a037cebc7已发布。我的课程当前学科使用aria-current和共享accent-soft持续高亮；选中项与各组展开独立，点击其他学科转移当前项，搜索/分页清理，进入/保存课程同步所属学科。课程/模型/删除流程保持。

40项相关回归、类型/生产构建和设计检测通过，主代理解耦复查通过。1280×720及390×844深色正式浏览器验证焦点移到搜索后高亮保持、切换唯一当前项、两组同时展开且仅当前项高亮、无横向溢出；无数据写入或模型调用。health/ready 200、六服务健康，仅替换前端，其他服务/数据/Nginx保持。浅色/真实手机硬件未新增验收。

current为releases/f0a1a47，来源和摘要见production.json。任务上传包/回退配置/脚本与旧前端镜像验收后清理，本地前端同步更新；保留用户数据/源快照/运行依赖，不推送GitHub或更新Sites。

## 2026-11-10 删除图标发布（历史）

前端004664c9428fffe4d7d7e2ece9f77cfe3aade65f已发布，课程行右侧只显示垃圾桶图标，按钮44×44px；保留删除课程的无障碍名称和原二次确认/取消/失败/忙碌流程，学科18px/课程13px不变。40项相关回归、类型/生产构建和设计检测通过，本次未新增全量测试；此前131项属于f81febe。

1280×720及390×844深色正式浏览器确认无可见文字、SVG图标存在、实际约44×44px、无横向溢出；打开/取消确认正常，未执行真实删除。health/ready 200，六服务健康，仅替换前端；后端/数据/模型/Nginx保持。current为releases/004664c，来源与摘要见production.json。浅色/真实手机硬件未新增验收。

验收后清理上传包、回退配置副本、脚本及旧前端镜像，逻辑字节数见回执；保留运行依赖、源快照和用户数据。本地前端同步更新，GitHub与Sites未更新。

## 2026-11-10 课程列表删除与字号发布（历史）

前端f81febee9281160039a3b481bf5ad5729533a57f已发布。我的课程每行右侧提供删除，详情删除入口移除；保留就近二次确认、不可逆说明、默认取消焦点、Escape/取消返回行按钮、失败重试和忙碌禁用，筛选或收起分组清除待确认目标。列表学科18px、课程名13px，点击高度约44px。

131项前端全量（含40项课程/工作区）、类型与生产构建通过，设计检测无发现。首轮一项旧测试因新删除按钮造成宽泛名称匹配歧义，明确进入按钮定位后全量通过。只读样例和正式站1280×720/390×844深色浏览器验证右侧位置、实际18/13字号、无横向溢出及打开/取消确认；未执行真实删除或写用户数据。health/ready 200、六服务健康；后端/Worker仍为8e8b56b，数据库/存储/Nginx及模型配置保持。浅色、真实手机硬件未新增验收。

current为releases/f81febe，混合服务来源和镜像摘要见production.json。临时上传包、回退环境/元数据、验证脚本和旧前端镜像标签已在验收后清理；保留运行依赖、源快照和用户数据。本地前端同步更新，GitHub与Sites未更新。

## 2026-11-10 课程详情文案发布（历史）

已发布前端2c7d62c22bd2207487cccd50adcbdd332a5037ed：课程详情页签“上传教材目录图片 / 目录与小节”，顶部active状态显示“创建课程中”。仅替换显示字符串；active/archived值、归档文案和原课程/模型/目录功能保持。

37项相关回归、TypeScript、生产构建和设计检测通过；1280×720深色正式浏览器打开已有课程，三处文案可见且布局正常，未写用户数据或调用模型。health/ready 200，六服务健康。仅重建前端容器，后端/Worker仍为8e8b56b，数据库/存储/Nginx及模型修复状态保持；current指向releases/2c7d62c，精确镜像和混合来源见production.json。原128项前端全量属于前一版本，本次不作新全量声明。手机/浅色未新增视觉验收。

回退环境/元数据副本、上传包、验证脚本和旧前端镜像标签已在验收后清理，云端清理逻辑字节数见回执；保留源快照、运行依赖和用户数据。本地前端同步更新，未推送GitHub或更新Sites。

## 2026-11-10 默认连接旧模型配置修复

截图中的“默认连接仅支持Aurora-Zyron”来自云端保留的旧模型名gpt-6.1-sol。图片已上传201，解析在调用前被当前策略400拒绝；不是上传大小或像素限制。已先用原密钥读取模型目录确认Aurora-Zyron可用，再通过原模型API修改同一模型记录，清空旧测试结果并运行内置图片样例：识别测试200、结果正确。连接/模型ID、密钥、原4096上下文及课程图片保留；未读取或重新发送用户教材图片，新增一条正常能力测试调用记录。

应用源码、镜像和默认模型策略均未改变，发布来源仍为8e8b56b。后续升级保留配置时，须核对默认连接的已存模型名符合当前required_model_name；在模型设置保存正确名称后重新测试，不把旧名称的能力测试当作新模型证据。实际配置修复和验证记入production.json及服务器release.json。

## 2026-11-10 50MiB图片发布（历史）

已发布已验收8e8b56bb9512c4617a2275976a3df886b778d5b2的前端、后端和Worker，current为releases/8e8b56b；Nginx与渲染模板完全匹配，上传上限50m，原185秒代理超时保持。前端校验、业务代理、后端请求体/存储读取和视觉契约同步50MiB，移除宽高/总像素阈值，不自动缩放或裁切。PNG/JPEG真实格式、单帧及规范化文件大小检查保持。

117项后端、128项前端、10项工具、格式/类型/生产构建通过；本地与线上整50MiB请求到达认证401 JSON，线上50MiB+1仍拒绝413。运行后端实测4001×4000图片规范化后尺寸不变，Pillow像素阈值已禁用，HTTPS health/ready 200。无数据库迁移；先一致备份云端数据库/存储/配置，切换及验收前后业务行数量/摘要相同。未写用户课程/图片或调用真实模型，供应商自身图片能力和新视觉验收未新增测试。

临时上传包、数据/环境备份、验证脚本及无依赖旧应用镜像标签验收后已清理，逻辑大小见production.json；保留当前源快照/运行依赖/云端数据/密钥/Nginx/证书。本地运行同步更新，GitHub未推送，Sites未更新。后续部署仍须校验实际Nginx与当前模板渲染结果一致。

## 2026-11-10 上传限制修复

上次应用发布保留了旧Nginx运行配置（2MiB请求体、150秒超时），与当前源码模板5MiB/185秒不一致；两次5,184,272字节目录图片被代理413拦截，前端显示“服务暂不可用”。已按当前模板渲染正式站配置，nginx -t通过后平滑reload；未改其他站点、应用镜像、数据库或用户数据。

线上匿名边界验证：3MiB与整5MiB图片请求到达应用认证并返回401 JSON，5MiB+1仍返回413；health/ready 200。未调用真实模型、写入课程或图片。运行配置与模板渲染结果完全一致，摘要写入production.json及服务器release.json。后续发布应同时核对已渲染Nginx配置与模板的差异，不能只验证Compose和服务健康；原始验证脚本和临时配置备份已清理。

## 2026-11-10 默认测试登录发布（历史）

已将已验收源码 b265cff966c5e3c642fe5c19a0cf3c89e1ccf16c 的前端、后端和 Worker 发布到正式入口，current 指向 /opt/learning-workbench/releases/b265cff。测试登录始终可用，生产环境旧测试开关已移除，无需额外部署授权参数。HTTPS、安全Cookie、同源校验、限流、固定普通账户和正常账户隔离继续保留。镜像与配置摘要集中见 production.json 和服务器 release.json。

发布前完成数据库、存储与独立环境的一致备份，迁移 0004_curriculum → 0007_connection_slots；原业务表数量及规范化行摘要前后一致，现有账户、模型配置和云端密钥保留。没有上传本地数据或凭据，本地运行及 Sites 不变。

六服务健康，HTTPS health/ready 200；两次API测试登录复用普通账户，Secure/HttpOnly/SameSite=strict、课程读取、跨站403及退出401通过。1280×720深色浏览器实点测试登录及刷新保持会话通过。复用相同源码/精确镜像的115项后端、127项前端、10项工具及格式/类型/构建验证；未新增手机/浅色、真实供应商生成或新私有下载内容验收。SMTP仍待配置，注册和找回暂不可用。

验收后删除上传包、临时备份/脚本及两个旧应用镜像标签，云端清理225,481,323逻辑字节，不代表磁盘净释放量；保留当前源快照、运行镜像、持久数据、密钥与原证书/Nginx。下方均为历史回执。

## 2026-11-09 线上测试登录（历史发布）

当前来源/前后端与 Worker 为 637d32247a072c69b57dd79bafb258e468de6c2a，current 指向 /opt/learning-workbench/releases/637d322。用户明确要求正式站也开启测试登录，覆盖下方历史发布的关闭状态。仍默认关闭其他新环境；本次仅在云端 .env.production 设置 TEST_LOGIN_ENABLED=true、TEST_LOGIN_PUBLIC_ORIGIN=https://learn.nuxusaurora.cn，并构建 NEXT_PUBLIC_TEST_LOGIN_ENABLED=true 的前端。后端要求精确匹配 PUBLIC_ORIGIN、HTTPS、安全 Cookie 和启用开关；原限流、固定独立普通账户、会话/退出及冲突保护保持，不接收调用方指定账户/角色。

线上“测试登录”使用访客共用的专用测试账户，与其他正常账户和本地数据隔离；页面明确显示共用账户说明。83 项后端、Ruff/格式、5 项部署检查及前端生产构建/类型通过，未改前端源码，沿用此前 82 项前端测试。实际 HTTPS 验证 200、普通 user、Secure/HttpOnly/SameSite=strict Cookie、课程读取、退出后 401、重复登录复用账户；浏览器实点按钮进入并刷新保留会话。保留用户要求的测试账户与当前浏览器会话，没有创建课程/文件。SMTP 仍未配置，正常注册/找回保持待配置。

此历史版本生产工具 check/up/status 使用 --allow-public-test-login true；当前源码已移除此参数及环境开关，见上节。缺 SMTP 时仍使用 --allow-missing-mail true。

此次复用云端已有镜像层、以已校验增量重建完整 OCI 镜像并比对加载摘要；无数据库迁移，无数据/密钥导入。本地运行保持。验收后删除云端层归档/增量包/临时环境备份共 464,007,971 逻辑字节与两个旧应用镜像标签，保留当前镜像、卷、密钥和源快照。当前来源、镜像索引和验证详情以 production.json 与服务器 release.json 为准。

## 2026-11-09 当前发布（此前版本）

正式应用已升级：源码快照/前端为 a9f0b5ba873253f6d8eec07f0c10586737659c60，后端与 Worker 镜像基线为 dbeb13fb87a2ece8c93d8d701bcf0884bc9ab64f（两份快照的后端源码相同）。包含当前 Sidebar、视觉目录识别、目录编辑及单草稿行为。current 指向 /opt/learning-workbench/releases/a9f0b5b；实际 OCI 镜像索引与服务摘要见 production.json 和服务器 /opt/learning-workbench/release.json。

82 项前端测试、TypeScript、生产构建及 4 项部署工具检查通过；后端同源码复用此前 77 项验证。先停写并备份 PostgreSQL、对象卷和独立环境，再执行 0003_ai_gateway → 0004_curriculum；用户/课程/上传数量在迁移前后均为 0/0/0。六项服务健康，公开 HTTPS health/ready 200，生产测试登录 POST 404，未登录目录 401。浏览器实查新版公共状态页、折叠登录入口和登录页，无测试登录按钮；本轮没有生产账户、真实模型调用或认证后的下载/持久化新验收。

云端原密钥、独立数据库/对象卷、Nginx、证书、同域私有下载及 SMTP 缺失设置保持。本地运行未重建，未导入本机账户/课程/供应商密钥，也未更新 Sites 体验站。匿名折叠入口缺少可读名称已在最终前端补齐，并增加回归；只改变显示标签，不改认证或数据契约。发布验证通过后删除临时包/分块及受限备份，共 402,469,880 逻辑字节，并回收五个无依赖旧应用镜像标签；原始源快照与当前运行依赖保留。下方较早镜像/计数为首次部署历史，当前以本节及 production.json 为准。

## 实际部署

- 服务器：ubuntu@111.229.103.70，Ubuntu 24.04，2 GiB 内存。使用本机既有 SSH 密钥 nuxusaurora.pem；不复制私钥到服务器或仓库。
- 独立目录：/opt/learning-workbench；当前源码快照位于 current 链接。项目名 learning-cloud，独立 PostgreSQL/Redis/storage 持久卷。
- 运行环境：/opt/learning-workbench/.env.production，仅 root 可读写。机密在服务器独立生成，不使用本机 .env。
- 当前发布来源和镜像摘要见上节；实际镜像 ID、配置来源及域名以 /opt/learning-workbench/release.json 为准，不能根据目录名猜镜像版本。
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

## 首次部署验收与持续限制（历史）

4 项部署工具、38 项前端、49 项后端测试及格式/类型/生产构建通过。云端真实验证 HTTPS、安全会话/CSRF、SMTP 缺失明确失败并回滚、课程与私有文本上传/签名下载、模型连接配置、Worker 任务，以及六服务重启后会话/课程/文件/连接持久化。临时用户、课程、文件和连接均已移除；最终数据库用户/课程/资料/供应商数量为 0，迁移版本 0003_ai_gateway。浏览器 1280×720 实查正式登录与连接状态，正文 14px/300、标题 400、炭灰背景，无测试登录或体验栏；未新增其他分辨率/浅色验收。

配置边界复查通过：前端仍经既有同源 API，环境仅提供账户状态提示；生产覆盖层控制入口，数据库网络独立；私有 S3 保持签名授权和禁止缓存，公开无 SMTP 时不使用开发假投递。范围限本次及直接调用链，无独立评审。

尚未配置 SMTP/真实模型或定时备份，未做灾难恢复演练；新空库没有可用账户，邮件配置后通过正式注册/验证创建。当前登录 IP 限流仍识别同源前端代理地址，大规模多用户需单独完善可信访客地址传播。Phase 3 的当前发布状态见顶部更新，不把首次部署的旧状态当作新版本验收。

## 升级、备份与回退

升级前保存已验收镜像 ID，并对 PostgreSQL、storage-data 及生产环境/加密密钥做受限备份。数据库与文件需一致恢复，不能只回退镜像替代不兼容迁移回退。更新使用新的源码/镜像，核对摘要、执行迁移和健康/持久化检查后切换。任何失败都保留持久卷，禁止 down --volumes；本地开发数据始终保留。

发布包、原始验证脚本和无依赖候选目录在交付后清理，保留当前镜像、卷、环境、证书与简短部署回执。源码/测试可用于重建，不长期保存临时证据。

参考：[Docker Compose 合并](https://docs.docker.com/reference/compose-file/merge/)、[Caddy HTTPS](https://caddyserver.com/docs/automatic-https)、[代理 Host/URI](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
