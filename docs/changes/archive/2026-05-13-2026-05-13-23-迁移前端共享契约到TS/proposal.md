## 问题

仓库当前是前端逐步 TS 化、后端直接运行 Node ESM JS 的混合状态。这个状态本身不是问题，但最容易出错的契约层仍有不少 JS：

- `shared/socket-message-utils.js`
- `shared/codex-message-normalizer.js`
- `shared/modelConstants.js`
- `src/utils/api.js`
- `src/components/chat/utils/messageDedup.js`
- `src/components/chat/utils/sessionMessageDedup.js`
- `src/components/main-content/view/subcomponents/sessionActivityState.js`
- `src/i18n/config.js` / `src/i18n/languages.js`

这些文件承载前后端共享消息、WebSocket 更新、API response、provider/session 状态和 i18n 初始化。继续保持弱类型会让后续 Go/Gin 后端影子实现缺少清晰 API/WS 契约。

## 目标

本次变更只迁移高价值前端/共享契约到 TypeScript：

- 将跨模块数据契约集中到 TS 类型。
- 让前端 `typecheck` 能覆盖共享消息和 API 客户端。
- 保持 Node 服务端仍可消费需要共享的运行时代码。
- 不引入服务端 TS 编译链。
- 不把大型 JSX 页面一次性迁移。

## 范围

- `shared/` 中被前端和后端共同消费的契约工具。
- 前端 API 客户端和聊天消息去重工具。
- 会话活动状态工具。
- i18n 配置和语言列表。
- 相关 import 后缀和测试断言。

## 非目标

- 不迁移 `server/` 到 TS。
- 不迁移大型 TaskMaster JSX 页面。
- 不改变 API shape、WebSocket 事件类型或 UI 行为。
- 不引入 ts-node、tsx、Babel server build 或额外运行时。
- 不做 Go/Gin 后端实现。

## 测试意图

执行阶段需要新增或更新真实测试：

- TypeScript 类型检查覆盖新迁移的共享契约。
- Node server 测试继续能导入共享运行时代码。
- 前端业务测试覆盖 WebSocket projects update、聊天去重、API error handling。
- 静态测试确认高价值契约文件已从 `.js/.jsx` 迁移为 `.ts/.tsx`，且没有新增服务端 TS 运行器。
