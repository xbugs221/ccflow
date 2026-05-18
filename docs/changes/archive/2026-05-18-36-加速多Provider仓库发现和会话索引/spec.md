# 规格

### 需求：项目发现必须使用 Provider 的轻量权威索引

`/api/projects` 必须通过轻量数据源发现 Codex、Pi、OpenCode 项目和会话概览，不得为仓库列表全量解析 Provider 历史。

#### 场景：Codex 通过 JSONL 首行发现项目

- **给定** `~/.codex/sessions/**/*.jsonl` 中某文件第一条非空记录是 `type=session_meta`
- **且** `payload.cwd = "/repo/codex-project"`
- **当** cbw 构建项目列表
- **则** 返回的项目包含 `/repo/codex-project`
- **并且** 对应 session provider 是 `codex`
- **且** 不需要读取该 JSONL 后续全部消息行

#### 场景：Codex 旧格式 fallback 深读

- **给定** 某 Codex JSONL 第一条非空记录不是 `session_meta`
- **但** 文件中后续记录仍能被现有完整解析逻辑识别出 cwd
- **当** cbw 构建 Codex 索引
- **则** 该文件仍能被识别
- **并且** fallback 只影响该文件，不阻塞其他正常头部文件

#### 场景：Pi 通过 JSONL 首行发现项目

- **给定** `~/.pi/agent/sessions/**/*.jsonl` 中某文件第一条非空记录是 `type=session`
- **且** `cwd = "/repo/pi-project"`
- **当** cbw 构建项目列表
- **则** 返回的项目包含 `/repo/pi-project`
- **并且** 对应 session provider 是 `pi`
- **且** 不需要读取该 Pi transcript 的后续记录

#### 场景：OpenCode 通过 SQLite session 表发现项目

- **给定** OpenCode 数据库 `opencode.db` 中 `session.directory = "/repo/opencode-project"`
- **当** cbw 构建项目列表
- **则** 返回的项目包含 `/repo/opencode-project`
- **并且** 对应 session provider 是 `opencode`
- **且** 不需要执行 `opencode session list --format json`
- **并且** 不扫描 snapshot、tool-output 或 session_diff 目录

### 需求：多 Provider 会话概览必须保持身份稳定

项目概览可以使用轻量 session 元数据，但不得改变现有路由和 UI state 契约。

#### 场景：同一项目存在三类 Provider 会话

- **给定** 同一项目路径下存在 Codex、Pi 和 OpenCode session
- **当** 请求 `/api/projects`
- **则** 同一个项目下分别返回 `codexSessions`、`piSessions`、`opencodeSessions`
- **并且** 每个 session 的 provider 标记保持正确
- **且** 不能把 Pi 或 OpenCode 会话归入 Codex

#### 场景：项目自定义标题和 session UI state 生效

- **给定** cbw project config 中保存了项目 displayName
- **且** 某 Provider session 有 favorite、pending 或 hidden 状态
- **当** 项目列表使用轻量 Provider 索引返回
- **则** displayName 和 session UI state 仍按配置叠加
- **并且** hidden session 默认不出现在可见列表中

#### 场景：workflow child session 不进入普通手动会话列表

- **给定** 某 Provider session 被 workflow ownership metadata 标记为 child session
- **当** 项目列表使用轻量 Provider 索引返回
- **则** 该 session 不应出现在普通手动会话分组
- **并且** workflow 页面仍能按 workflow read model 访问它

### 需求：项目列表不得被历史体积线性拖慢

项目列表性能应与“文件数量和索引记录数量”相关，而不应与所有 transcript 内容总大小线性相关。

#### 场景：Codex 后续大内容不影响项目发现

- **给定** Codex JSONL 首行包含完整 `session_meta`
- **且** 后续写入大量消息行或大型工具输出
- **当** 构建 Codex 项目索引
- **则** 项目归属仍来自首行
- **并且** 测试能证明后续内容不会被项目发现逻辑依赖

#### 场景：Provider 索引同轮请求只构建一次

- **给定** 多个并发 `/api/projects` 或同一轮 `getProjects()` 内多次需要 Provider 索引
- **当** Provider 索引正在构建
- **则** 后续调用复用同一个 promise
- **并且** 不重复扫描 Codex/Pi 文件或重复查询 OpenCode DB

#### 场景：OpenCode DB 不可用时快速 fallback

- **给定** `opencode.db` 不存在、schema 不兼容或只读打开失败
- **当** cbw 构建 OpenCode 索引
- **则** 可以 fallback 到现有 CLI 读取
- **并且** CLI 失败时返回空 OpenCode 索引
- **且** 不能让整个项目列表请求失败

### 需求：会话详情仍按需读取真实历史

概览轻量化不能破坏进入会话后的聊天详情。

#### 场景：进入 Codex 会话后仍能读取真实消息

- **给定** 项目概览中的 Codex session 来自 JSONL 头部索引
- **当** 用户打开该 session
- **则** 消息详情接口仍按 Codex JSONL 读取真实 transcript
- **并且** 不因概览 messageCount 为轻量值而丢失消息

#### 场景：进入 Pi 会话后仍按 Pi/co read model 加载

- **给定** 项目概览中的 Pi session 来自 Pi JSONL 头部或 cbw 配置
- **当** 用户打开该 session
- **则** 消息详情按 Pi/co read model 加载
- **并且** 不 fallback 到 Codex JSONL

#### 场景：进入 OpenCode 会话后仍按 OpenCode 数据源加载

- **给定** 项目概览中的 OpenCode session 来自 SQLite `session` 表
- **当** 用户打开该 session
- **则** 消息详情按 OpenCode 的消息数据源加载
- **并且** 项目概览不需要预先读取 `message` 或 `part` 全表
