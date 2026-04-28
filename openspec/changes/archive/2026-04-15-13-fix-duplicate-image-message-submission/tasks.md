## 1. 前端提交互斥与图片上传状态

- [x] 1.1 在 `useChatComposerState` 中引入独立的 composer 提交状态机，覆盖图片上传、命令派发和失败恢复，禁止同一份草稿在进行中再次提交
- [x] 1.2 收口 `ChatComposer` 的鼠标、触摸、表单和键盘提交入口，确保一次用户动作只调用一次提交流程
- [x] 1.3 让上传失败保留草稿和附件，且只有用户显式再次发送时才开始新的提交流程
- [x] 1.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-message-submission-idempotency.spec.js -g "submitting an image message twice during a slow upload still creates one user message|one touch-originated send with an image is not replayed by the follow-up mouse event|a failed image upload keeps the draft and attachment until the user explicitly retries"` 全部通过

## 2. 请求标识与服务端幂等

- [x] 2.1 为每次聊天提交生成稳定的 `clientRequestId`，并沿 `claude-command` / `codex-command` 请求与 optimistic user message 传递
- [x] 2.2 在服务端聊天命令入口与 transcript 写入链路按 `clientRequestId` 做幂等处理，避免重复执行和重复落盘
- [x] 2.3 调整会话恢复与消息转换逻辑，优先按请求标识合并已受理消息，再保留现有文本去重作为兜底
- [x] 2.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-message-submission-idempotency.spec.js` 全部通过

## 3. 验收产物对齐

- [x] 3.1 保持 proposal、design、spec、`tests/spec/chat-message-submission-idempotency.spec.js`、`tests/spec/README.md` 与变更内 `test_cmd.sh` 一致
- [x] 3.2 确认 `/apply` 阶段只允许修改实现代码，不允许放宽本次新增验收测试
- [x] 3.3 验收：`bash openspec/changes/4-fix-duplicate-image-message-submission/test_cmd.sh` 全部通过
