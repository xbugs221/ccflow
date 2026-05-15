## 设计原则

本次变更只把 Pi 纳入现有手动 provider 体系，不重写 provider 架构。

```text
现有稳定路径:
  ccflow -> co-request-v1 -> co -> Codex/OpenCode

新增路径:
  ccflow -> co-request-v1 -> co -> Pi
```

Pi 的执行生命周期仍由 `co` 拥有。ccflow 只负责：

- 判断 provider 是否可用。
- 写入 request。
- 读取 conversation/turn state。
- 转发 co events。
- 把会话 read model 和 UI 路由串起来。

## Provider 契约

共享类型从：

```text
SessionProvider = codex | opencode
```

扩展为：

```text
SessionProvider = codex | opencode | pi
```

后端的 `normalizeManualProvider`、`buildCoRequest`、`isCoProviderAvailable` 和前端的 provider inference 必须使用同一组 provider。不要在各处写互相不一致的字符串判断。

本次可以先采用轻量 helper，例如：

```text
manual providers
  +-- codex      sessions key: codexSessions
  +-- opencode   sessions key: opencodeSessions
  +-- pi         sessions key: piSessions
```

暂不引入 provider registry，避免把小变更扩大成架构重构。

## co 文件协议

`co doctor --json` 必须能返回 Pi 可用性，ccflow 才允许 Pi 发送：

```json
{
  "ok": true,
  "contract": "co-request-v1",
  "providers": {
    "codex": true,
    "opencode": true,
    "pi": true
  }
}
```

ccflow 必须继续接受 boolean 和 object 两种 provider schema：

```json
{ "pi": true }
{ "pi": { "available": true } }
```

Pi 请求沿用 `co-request-v1`：

```json
{
  "contract": "co-request-v1",
  "op": "message",
  "conversation_id": "c28",
  "project_path": "/repo",
  "provider": "pi",
  "text": "..."
}
```

事件类型需要补齐：

```text
session-created
pi-response
pi-complete
pi-error
session-aborted
message-rejected
steer-rejected
```

如果 co 暂时没有 `pi-*` 事件，执行阶段必须先升级 co 或在提案执行中明确阻塞，不能在 ccflow 内部伪造 Pi 执行。

## 会话 read model

项目 read model 增加 `piSessions`，并在以下位置并入会话列表：

- 项目概览手动会话区。
- 侧边栏会话区。
- route session provider 推断。
- rename/delete/favorite/pending/hidden 等 session UI 状态更新。
- REST history 和 WebSocket realtime 的 provider 过滤。

```text
Project
  +-- codexSessions[]
  +-- opencodeSessions[]
  +-- piSessions[]
```

Pi 会话仍使用稳定 `cN` route 作为 ccflow conversation id。浏览器不得把 Pi provider session id 当作可信 route id。

## 前端交互

新增 Pi 不需要改变页面结构，只在现有 provider 选择入口加入第三项：

```text
新建会话
  +-- Codex
  +-- OpenCode
  +-- Pi
```

空会话 provider picker 也显示三项。Codex 专属模型和 reasoning 控件只在 `provider === "codex"` 时显示；Pi 第一阶段不显示模型选择，避免暴露不稳定或不可验证的模型契约。

Logo 可先使用简单的 Pi 文本徽标或现有 fallback，后续再替换为正式图标。不要为了图标引入新图片依赖。

## Pi 状态和设置页

当前 `pi --help` 可用，但 `pi doctor --json` 返回 unknown option。设置页不能把 Pi 状态设计成完整认证检查。

建议新增基础状态：

```json
{
  "available": true,
  "authenticated": null,
  "commandPath": "/path/to/pi",
  "version": "optional",
  "error": null
}
```

语义：

- `available=true` 只表示服务进程能找到并执行 `pi`。
- `authenticated` 可为 `null`，表示 ccflow 无稳定方式判断。
- 不返回 API key、token、provider credentials 或模型账号详情。
- 聊天发送 gate 仍以 `co doctor --json providers.pi` 为准，而不是 Pi 设置页状态。

## 工作流 read model

当前 workflow read model 已能解析 `pi:*`，但 `isKnownProvider` 只认 Codex/OpenCode，导致 Pi 保持 unlinked。

执行阶段需要把 Pi 纳入 known provider，并只在能匹配项目中的 Pi 会话时生成可跳转 sessionRef。找不到匹配时，继续保持 unlinked，避免生成坏链接。

## 风险

- co 还没有 Pi provider gate 或 `pi-*` events 时，ccflow 侧实现会缺少执行端。该风险必须由执行前置检查和测试暴露。
- Pi CLI 账号/模型状态没有稳定 JSON 契约，设置页必须避免过度承诺。
- 现有代码里有多个硬编码二分支 `codex/opencode`，执行阶段需要系统性审计，否则容易出现可创建但无法续聊或无法打开的半支持状态。
- 增加 `piSessions` 会触及项目 read model 和 UI session 合并逻辑，测试必须覆盖真实业务流，而不是只检查组件存在。

## 测试策略

需要新增或更新这些真实测试：

- `tests/server/co-client.test.js`：Pi provider normalization、availability 和 request build。
- WebSocket/server 测试：Pi message request 写入 pending JSON，provider unavailable 时不写。
- 项目 read model 测试：Pi 会话进入 `piSessions` 并参与 provider 推断。
- 前端 spec：从项目概览创建 Pi 会话，进入会话后发送消息，断言 request provider 为 `pi`。
- workflow read model 测试：`pi:*` 匹配 Pi 会话时可跳转，无匹配时仍 unlinked。
- 设置页/诊断测试：fake `pi` 可执行和不可执行两种路径。
