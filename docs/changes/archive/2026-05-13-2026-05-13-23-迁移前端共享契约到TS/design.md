## 设计原则

迁移顺序按“契约价值高、构建成本低”排序：

```text
优先迁移
  shared runtime contracts
  API client response shape
  WebSocket message reducers
  chat message dedup logic
  session activity helpers

暂不迁移
  server/*.js
  tests/*.js
  大型 JSX 页面
  配置文件
```

## 分层方案

```text
src/types/app.ts
  |
  +-- app/session/workflow read-model types
  +-- socket message envelope types
  +-- provider and API payload types

shared/*.ts
  |
  +-- pure runtime helpers
  +-- exported TypeScript types
  +-- no React dependency

src/utils/api.ts
  |
  +-- authenticated fetch wrapper
  +-- typed response helpers where stable
  +-- no server build dependency
```

## 后端消费 shared 的处理

当前 Node 后端直接 import `shared/*.js`。如果把 shared 文件直接改成 `.ts`，Node 不能在生产运行时直接 import。执行阶段必须选择低风险路径：

1. 对前端独占或测试独占的 JS 文件直接改名为 TS。
2. 对 server 仍直接 import 的 shared runtime，先拆分：
   - `shared/*.js` 保留极薄运行时出口，供 Node 使用。
   - `shared/*.ts` 提供类型和前端使用的强类型实现。
   - 或者把 server 依赖迁出 shared，改由 server 本地 JS helper 承担。
3. 禁止为了这次迁移引入 server TS runtime。

优先检查的 server 依赖：

```text
server/projects.js -> shared/codex-message-normalizer.js
server/codex-models.js -> shared/modelConstants.js
src/hooks/useProjectsState.ts -> shared/socket-message-utils.js
src/contexts/TaskMasterContext.jsx -> shared/socket-message-utils.js
```

## import 后缀策略

- 前端 TS 源码内可以使用无扩展名 import，交给 Vite/TS bundler resolution。
- Node 运行时 JS 保持显式 `.js` import。
- 测试若直接由 `node --test` 执行，不直接 import `.ts` 源码，除非测试 runner 已支持。

## 执行决策（2026-05-13）

### 直接迁移到 TS 的文件（前端/浏览器独占，无 Node 测试依赖）

| 原文件 | 新文件 | 原因 |
|--------|--------|------|
| `src/utils/api.js` | `src/utils/api.ts` | 仅前端 TS/JSX 和 Playwright 浏览器测试使用 |
| `src/i18n/config.js` | `src/i18n/config.ts` | 仅 App.tsx 和 main.jsx 导入 |
| `src/i18n/languages.js` | `src/i18n/languages.ts` | 仅前端导入 + 归档测试（改为静态文件检查） |

### 保留 .js + 补 .d.ts 的文件（server 或 Node 测试依赖）

| 文件 | 依赖方 |
|------|--------|
| `shared/socket-message-utils.js` | 前端 TS + Node 测试 (`tests/server/socket-message-utils.test.js`) |
| `shared/modelConstants.js` | 前端 TS + server (`server/codex-models.js`) + Node 测试 |
| `shared/codex-message-normalizer.js` | server (`server/projects.js`) 独占，无前端使用方 |
| `src/.../messageDedup.js` | 前端 TS + Node 测试 (`tests/server/chat-message-dedup.test.js`) |
| `src/.../sessionMessageDedup.js` | 前端 TS + Node 测试 (`tests/server/chat-session-message-dedup.test.js`) |
| `src/.../sessionActivityState.js` | 前端 TSX + Node 测试 (`tests/spec/test_home_session_card_activity_ui.js`) |

### 其他决策

- `src/i18n/languages.js` 被归档根测试 `tests/2026-05-10-6-...test.js` 直接导入；该测试不在 CI 中，改为静态文件内容检查。
- `shared/codex-message-normalizer.js` 仅 server 使用，无前端导入方，只补 `.d.ts` 满足类型覆盖目标。

## 风险

- shared 文件被 server 和 frontend 同时使用，直接重命名会破坏 `node server/index.js`。
- 静态测试可能读取旧 `.js` 路径，需要同步调整。
- `allowJs` 当前开启、`checkJs` 未开启；迁移后要确保 `pnpm run typecheck` 真正覆盖新 TS 文件。
