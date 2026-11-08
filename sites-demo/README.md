# GPT Sites 公开体验版

已发布：[学习工作台](https://learning-workbench-public.jacky2007a.chatgpt.site)。访问权限为 public，任何拥有链接的人都能查看。

这是用户明确选择的独立体验版。课程、昵称、会话和 UTF-8 文本资料存于访客浏览器的 `learning-workbench-public:v1`，不连接本机 FastAPI、数据库、邮件、真实账户或 AI。顶部可重置体验；清除网站数据会丢失改动。固定示例不是用户资料。密码操作禁用，修改邮箱和统计保留待接入状态。

`adapter.ts` 实现已有前端 API 契约并负责持久化、校验、配额错误及下载 URL 释放。组件仍使用原有 API 调用；正式应用不引用体验适配器。`export.mjs` 只复制明确列出的前端源码，移除客户端构建不需要的 Next 指令，替换登录页、密码按钮和下载动作；产品源码变动不符合约定时中止导出。Next Link 替换为普通锚点，连接状态展示本地体验状态。正式 Next.js 仍使用动态服务。

本机保留精简的公开 Site 源码仓库：`D:/Code/codex/codex-work/Webapp-public-site`，Git 状态干净，源码已同步到 Sites 专用仓库。依赖、构建输出和上传包已清理。更新时复用 `.openai/hosting.json` 的项目 ID，不重复 create_site；访问凭据仅经 Sites 返回后通过 stdin 传给 source helper，禁止落盘。

构建配方位于本目录；Site 自身的源码、锁文件和 SOURCE.json 已保存在 Sites 专用源码仓库。`publication.json` 保存项目、版本、部署与来源的确切标识。

```powershell
rtk proxy node --experimental-strip-types --test sites-demo/adapter.test.mjs
rtk proxy node sites-demo/export.mjs D:/Code/codex/codex-work/Webapp-public-site
```

随后在 Site checkout 使用当前 Sites 插件的 `install-dependencies.mjs`，运行 `npm run check` 与 `build-site.mjs`。按照 Sites 技能使用 source helper 推送和打包，将其完整提交号与包交给 save_site_version，再部署保存版本；沿用 public 访问权限。不要上传主项目 `.env` 或后端运行数据。

本轮 6 项适配测试、TypeScript 与生产构建通过。浏览器实际验证登录、课程创建/刷新持久化、昵称编辑、账户与本地状态页；深色普通、大屏及窄屏布局无整页溢出。尺寸覆盖实际 CSS 视口 1329×733、3556×2222、433×938；Chrome 原有 90% 缩放影响 viewport override，未声称严格 3200×2000/100% 验收。浅色未重新视觉复核。正式发布后测试登录进入示例课程；无 Cookie 的独立 HTTP 请求返回 200。
