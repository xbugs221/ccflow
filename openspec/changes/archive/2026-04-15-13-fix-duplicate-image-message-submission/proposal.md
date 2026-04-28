## Why

聊天输入框在普通文本场景下已经偶发重复发送，而带图片的消息更容易复现：图片上传会把“提交已开始但界面仍可再次触发”的窗口拉长，导致一次用户动作可能被前端重复触发、被网络重放，或被服务端重复落盘。这个问题已经直接污染 transcript，必须尽快把提交链路收敛成一次动作只产生一次用户消息。

## What Changes

- 为聊天提交链路补齐显式的“提交中”互斥，覆盖按钮点击、触摸、键盘 Enter 和图片上传中的重复触发。
- 为每次聊天提交引入稳定的客户端请求标识，并要求服务端/会话层按该标识做幂等处理，避免同一请求被重复写入 transcript。
- 明确图片消息在上传中、上传失败、发送成功三种状态下的行为，保证失败后只能由用户显式重试，而不是隐式重复发送。
- 新增验收测试，覆盖图片上传慢、触摸点击、连接抖动/重复派发等高风险场景。

## Capabilities

### New Capabilities
- `chat-message-submission-idempotency`: 约束聊天消息提交、图片上传和 transcript 落盘在一次用户动作下只能形成一次有效请求。

### Modified Capabilities
- None.

## Impact

- 前端影响：`src/components/chat/hooks/useChatComposerState.ts` 与 `src/components/chat/view/subcomponents/ChatComposer.tsx` 需要补齐提交互斥、状态机和请求标识传递。
- 后端影响：聊天命令入口、provider 调用和 session 持久化链路需要识别重复请求，避免重复创建用户消息或重复写入 JSONL。
- 验收影响：需要新增 `tests/spec/` 下的图片消息重复发送验收测试、更新 `tests/spec/README.md`，并提供变更内 `test_cmd.sh`。
