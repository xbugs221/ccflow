# 修正 co 续发会话路由身份任务

- [x] 1. 梳理并集中 co conversation id 解析
  - [x] 1.1 新增后端函数解析 `ccflowSessionId`、`sessionId`、项目配置和 `co` state。
  - [x] 1.2 Codex message request 改用集中解析结果。
  - [x] 1.3 OpenCode message request 改用集中解析结果。
  - [x] 1.4 abort request 改用集中解析结果。

- [x] 2. 拒绝无法确认 route 的续发请求
  - [x] 2.1 当只有 provider session id 且无法反查 `cN` 时，返回明确错误。
  - [x] 2.2 确认失败路径不写 `requests/pending/`。

- [x] 3. 补充真实业务测试
  - [x] 3.1 覆盖 provider session id 反查到 `cN` 后成功续发。
  - [x] 3.2 覆盖无法反查时拒绝且不写 pending request。
  - [x] 3.3 覆盖 abort request 使用 `cN`。
  - [x] 3.4 覆盖 Codex 和 OpenCode 共用路径。

- [x] 4. 验证
  - [x] 4.1 运行相关 Node 测试。
  - [x] 4.2 运行 `oz validate 2026-05-15-26-修正co续发会话路由身份 --json`。
