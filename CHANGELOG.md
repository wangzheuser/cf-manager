# Changelog

## [1.1.0] - 2026-07-03

### 🚀 新特性

- **Prompt Caching 感知的神经元计费**：#37 缓存模型（GLM-5.2 / Kimi K2.5 / K2.6 / K2.7-code）现在根据 CF 返回的 `prompt_tokens_details.cached_tokens` 字段区分缓存命中与未命中的输入 token，缓存命中部分按 ~1/5 价格计费，大幅提升本地估算的准确性。
- **缓存模型智能路由**：`selectBestAccount` 对支持 Prompt Caching 的模型启用软粘性路由，优先复用最近使用的账户以提升缓存命中率；仅当粘性账户用量超出最优账户 10,000 神经元时才切换。其他模型保持原有 least-used 策略不变。
- **流式响应强制 usage 返回**：流式请求自动注入 `stream_options.include_usage: true`，确保 CF 返回 `usage` 信息，避免流式场景下漏记神经元用量。
- **Worker KV 支持**：Worker 端新增可选 KV 绑定（`KV` namespace），用于乐观预估并发控制和缓存粘性路由的跨请求持久化。部署工作流自动创建并绑定 KV 命名空间。
- **完全覆盖部署**：`deploy-cf.yml` 新增 `full_wipe` 参数，勾选后自动删除并重建 D1 数据库 + 清空 KV 命名空间，实现纯净部署。

### 🐛 修复

- **Node.js Readable 流跨 chunk buffer**：修复 Docker 部署下 SSE 行被 TCP 分包截断导致 `usage` 解析丢失的问题，与 Web Streams 路径的 buffer 逻辑对齐。
- **D1 乐观预估兜底**：Worker 端在无 KV 绑定时，乐观预估和缓存粘性路由自动降级为 D1 存储（`quota_usage.optimistic` 列 + `app_settings` 表），确保核心功能不缺失。

### 🔧 优化

- **模型定价同步**：`shared/model-pricing.json` 新增 GLM-5.2 / Kimi K2.5 / K2.6 / K2.7-code 的 `cachedInput` 定价字段，通过 `sync-pricing.js` 同步到 Backend 和 Worker。
- **审计日志增强**：AI 请求日志新增 `cached=` 字段，明确展示缓存命中 token 数。
- **Worker 代码质量**：移除未使用的变量和函数引用。

---

## [1.0.0] - 2026-06

### 初始发布

#### 多账户管理
- 支持 API Token 和 Global API Key 两种认证方式
- 多账户统一管理，凭证自动加密存储
- 账户功能开关（AI / Workers / Browser Render / DNS / Storage）
- 批量测试连接、批量导入导出

#### 仪表盘
- 实时展示各账户今日配额使用量
- 可视化进度条 + 最近操作审计日志

#### Workers / Pages 管理
- Workers 脚本和 Pages 项目的查看、部署、删除
- 跨账户批量部署
- 脚本绑定、环境变量、路由、自定义域名管理
- Pages 支持创建空项目、上传 ZIP 部署
- R2 可用性检查与优雅降级

#### DNS 管理
- 多账户 DNS Zone 汇总查看
- DNS 记录 CRUD，横向滚动兼容窄屏

#### 存储管理
- R2 Bucket 浏览、文件上传/下载/删除
- KV Namespace 键值对管理

#### AI 推理代理
- OpenAI 兼容 `/v1/chat/completions` + `/v1/models`
- 流式 (SSE) 和非流式响应
- 多账户自动轮询，配额耗尽自动切换
- 请求级重试与错误处理
- 支持 `X-Account-ID` 指定账户

#### 浏览器渲染
- `/v1/browser/render` API（screenshot/content/markdown/pdf/links）
- 内置速率限制器
- 浏览器渲染代理，支持并发控制

#### 部署
- Docker Compose 一键部署（Backend + Frontend）
- Cloudflare Pages + D1 无服务器部署
- GitHub Actions 自动化部署工作流
- 代理服务器支持（HTTP_PROXY）
