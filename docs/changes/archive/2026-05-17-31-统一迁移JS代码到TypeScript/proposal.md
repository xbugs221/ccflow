## 问题

cbw 当前已经部分使用 TypeScript，但仓库里仍有大量 tracked JavaScript：

- 前端入口和若干组件仍是 `.jsx`，与 `.tsx` 组件混用。
- 后端 `server/`、`shared/`、脚本和配置仍以 `.js`、`.mjs` 为主，核心业务契约缺少编译期类型保护。
- `shared/` 和部分前端工具存在 `.js` + `.d.ts` 手写类型配对，容易出现实现和声明不同步。
- 测试代码以 `.js` 为主，真实业务契约无法复用生产类型。

继续混用 JS/TS 会让后续精简和重构更容易遗漏隐式字段、路径参数和 provider/session 状态结构，也会让 IDE 与 typecheck 只能覆盖一部分业务逻辑。

## 目标

将 tracked JS 代码统一迁移到 TypeScript：

- 前端 `.jsx` 组件迁移为 `.tsx`，入口 `src/main.jsx` 迁移为 `src/main.tsx`。
- `server/`、`shared/`、`scripts/`、配置文件和测试逐步迁移为 `.ts` 或 `.tsx`。
- 删除 `.js` + `.d.ts` 的重复维护模式，用 TS 源码直接导出类型。
- 调整 Node 运行、构建、测试脚本，确保服务端 TypeScript 可以被稳定执行或编译后执行。
- 迁移后 `pnpm run typecheck` 必须覆盖前端、后端、shared、脚本和测试核心类型边界。
- 与 `30-进一步精简仓库源码和脚本资源` 衔接，优先迁移精简后仍保留的文件，避免给即将删除的历史代码补类型。

## 范围

```text
前端
├─ src/main.jsx -> src/main.tsx
├─ src/components/**/*.jsx -> .tsx
├─ src/contexts/**/*.jsx -> .tsx
├─ src/hooks/**/*.jsx -> .ts 或 .tsx
├─ src/lib/utils.js -> .ts
└─ 删除 messageDedup/sessionActivityState 等 .js + .d.ts 配对

后端和共享代码
├─ server/**/*.js -> .ts
├─ shared/**/*.js -> .ts
├─ shared/**/*.d.ts 删除或改为由 TS 源码导出
├─ scripts/*.js/*.mjs -> .ts
└─ 保留 shebang/bin/postinstall 的可执行入口语义

配置和测试
├─ vite/playwright/tailwind/postcss 配置迁移到 TS 可加载形式
├─ tests/**/*.js -> .ts
├─ package.json scripts 改为 TS runner 或编译产物入口
└─ tsconfig 拆分前端、后端、测试配置，避免 allowJs 继续兜底
```

## 非目标

- 不改变现有业务行为、API 响应字段、路由路径或 WebSocket 消息格式。
- 不把 TypeScript 迁移和大型业务重构混在一起；迁移只做必要类型补全和小范围导入路径修正。
- 不为了迁移保留上一份提案应删除的 TaskMaster、lucide 或无入口资源。
- 不把 `dist/` 等编译产物提交到仓库。
- 不依赖 pnpm lock 里的传递依赖执行 TS；如果需要 TS runner，必须作为直接依赖或 devDependency 声明。

## 测试意图

执行阶段需要新增或更新真实测试：

- JS 清零契约测试：扫描 `git ls-files`，断言 tracked 源码、脚本、配置和测试不再包含 `.js`、`.jsx`、`.mjs`、`.cjs`，允许的例外必须有明确清单和理由。
- TypeScript 覆盖契约测试：断言 `tsconfig` 不再使用 `allowJs` 作为迁移兜底，且 typecheck 覆盖 `src/`、`server/`、`shared/`、`scripts/` 和关键测试目录。
- 运行入口回归测试：验证 `pnpm run server`、`cbw` bin、postinstall 脚本、Playwright 配置和 Node test 入口都能在 TS 迁移后启动。
- 业务回归测试：复用现有 server/spec/e2e 测试，证明项目发现、会话、聊天、文件、Git、Shell、settings、workflow 和 diagnostics 行为不变。
- 类型迁移测试：新增针对 shared message normalizer、socket message utils、model constants、session route helper 的类型级或运行级测试，避免 `.d.ts` 删除后丢失导出契约。
