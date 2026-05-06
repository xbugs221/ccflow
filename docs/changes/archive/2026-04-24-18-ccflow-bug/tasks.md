## 1. 工作流子会话切换隔离

- [x] 1.1 梳理 `useProjectsState`、workflow draft child session 创建链路和 `ChatInterface/useChatSessionState` 的状态交接，定位为什么从 `w1/c1` 创建 `w2` 后仍沿用旧会话视图。
- [x] 1.2 修正从已有工作流子会话创建新工作流后的选择态同步，确保 `selectedSession`、`currentSessionId` 与新的 workflow draft child session 一致。
- [x] 1.3 修正聊天消息加载与缓存重置逻辑，保证进入新的 `wN/cN` 时不会复用前一个工作流子会话的消息内容。

## 2. 验收与回归

- [x] 2.1 新增或更新 `tests/spec/project-workflow-child-session-isolation.spec.js`，覆盖“先进入 `w1/c1` 聊天，再创建 `w2` 并进入 `w2/c1`”的真实业务链路。
- [x] 2.2 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-child-session-isolation.spec.js` 全部通过。
