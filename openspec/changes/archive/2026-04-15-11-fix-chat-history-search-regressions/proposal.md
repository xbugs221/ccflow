## Why

聊天全文搜索已经上线，但当前实现存在三个直接破坏主流程的问题：Claude 搜索只覆盖每个项目最近 5 个会话，部分 Codex 命中结果可以搜出却无法打开，同时查询过程、空结果和错误都没有可见反馈。这个改动需要尽快把“能搜全、能点开、看得懂状态”补齐，否则搜索入口会持续制造误导。

## What Changes

- 修正聊天全文搜索的覆盖范围，确保 Claude 历史搜索不受 sidebar 首屏分页限制。
- 修正搜索结果跳转协议，保证所有返回结果都能解析到正确项目、provider 和目标消息。
- 为搜索交互补齐显式的查询中、无结果和失败反馈，避免“点击查询后没有任何反应”。
- 新增验收测试，覆盖旧 Claude 会话漏检、游离 Codex 结果不可打开，以及查询状态不可见等真实业务场景。

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `chat-history-full-text-search`: 修正搜索范围、结果跳转能力和搜索状态反馈，使搜索结果真正可发现、可打开、可理解。

## Impact

- 后端影响：`server/projects.js` 的搜索入口不能再依赖项目列表里的首屏 Claude 会话分页，同时需要返回足够的跳转上下文。
- 前端影响：聊天搜索结果点击时需要带上项目和 provider 定位信息，并增加 loading、empty、error 三种状态展示。
- 验收影响：需要新增 `tests/spec/` 下的搜索回归验收测试、更新 `tests/spec/README.md`，并提供变更内 `test_cmd.sh`。
