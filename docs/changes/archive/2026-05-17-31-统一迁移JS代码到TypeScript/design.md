## 背景

cbw 现在是 ESM 项目，前端由 Vite/React 构建，后端由 Node 直接运行 `server/index.js`。这意味着迁移不是简单批量改扩展名：浏览器端可由 Vite 处理 `.ts/.tsx`，但后端、bin、postinstall、Node test 和配置文件需要明确的 TS 执行策略。

本提案的原则是先建立可运行的 TypeScript 工具链，再逐层迁移源码。执行阶段不得依赖传递依赖，也不能在迁移中继续保留 `allowJs` 兜底。

## 技术决策

### 决策 1：先迁移保留代码，跳过即将删除的历史代码

执行顺序应在 `29-移除TaskMaster和lucide图标依赖` 之后，并尽量在 `30-进一步精简仓库源码和脚本资源` 的删除清单稳定后进行。

推荐顺序：

```text
29 删除 TaskMaster/lucide/assets
30 删除无入口脚本和薄层残余
31 统一迁移 JS 到 TypeScript
```

如果 31 需要先执行，则必须先标记 29/30 中会删除的文件，不为这些文件投入迁移工作。

### 决策 2：前端使用 Vite 原生 TS/TSX

前端迁移应优先从边界文件开始：

```text
src/main.jsx -> src/main.tsx
Auth/Theme contexts -> .tsx
auth/projects/settings/ui 组件 -> .tsx
hooks/lib utils -> .ts 或 .tsx
```

迁移时补齐 props、context value、API response、event handler、ref 等类型。对仍未稳定的后端返回结构，可先定义窄类型并在转换边界做归一化，不把 `any` 扩散到 UI 组件内部。

### 决策 3：后端 TypeScript 必须有明确运行模式

后端不能只改成 `.ts` 后继续用 `node server/index.ts`。执行阶段二选一：

```text
方案 A：运行时 TS runner
├─ 增加直接 devDependency，例如 tsx
├─ dev/server/test 脚本用 TS runner 执行
└─ 发布前仍可编译到 dist/server

方案 B：编译后运行
├─ 新增 tsconfig.server.json
├─ tsc 编译 server/shared/scripts 到 dist-node
├─ package bin/main/postinstall 指向编译产物
└─ 本地 dev 可用 watch 编译或 TS runner
```

默认采用方案 B 作为发布路径，方案 A 可作为开发和测试路径。这样源码统一为 TS，发布包仍给 Node 执行 JS 编译产物，但编译产物不提交仓库。

### 决策 4：删除 `.js` + `.d.ts` 配对

当前以下模式应消失：

```text
shared/*.js + shared/*.d.ts
src/**/messageDedup.js + .d.ts
src/**/sessionActivityState.js + .d.ts
```

迁移后由 `.ts` 源码直接导出函数、类型和常量。测试应从 TS 源码或编译产物导入同一个模块，不再维护独立声明文件。

### 决策 5：配置和测试也纳入迁移

为了真正统一，配置和测试也要迁移：

- `vite.config.js`、Playwright 配置迁移为 `.ts`。
- `tailwind.config.js`、`postcss.config.js` 在确认工具链支持 TS 配置后迁移；如果某个工具必须保留 JS loader，需要在契约测试中列为临时例外并有退出任务。
- `tests/**/*.js` 迁移为 `.ts`，Node test 改用 TS runner 或先编译测试。
- Playwright spec/helper 迁移为 `.ts`，继续验证真实浏览器业务路径。

临时例外不能长期存在。执行阶段如果留下例外，必须在 `task.md` 中补充后续删除条件。

## tsconfig 结构

建议拆分为：

```text
tsconfig.json              # 引用子项目，不开启 allowJs
tsconfig.web.json          # src + Vite
tsconfig.node.json         # server + shared + scripts + config
tsconfig.test.json         # tests + 测试 helper
```

共同要求：

- `strict: true`
- `allowJs: false`
- `noEmit` 只用于 typecheck 配置
- server 编译配置允许 emit 到 ignored 目录
- 路径和模块解析保持 ESM 兼容

## 测试策略

执行阶段应把测试先写入本提案 `tests/` 目录，再同步到根测试套件：

- `typescript-migration-no-js-contract.test.ts`：用 `git ls-files` 扫描 tracked 文件，断言无 `.js/.jsx/.mjs/.cjs` 源码残留，例外清单为空或只包含已解释的外部工具 loader。
- `typescript-config-contract.test.ts`：读取 tsconfig 和 package scripts，断言 `allowJs` 关闭、typecheck 覆盖前后端和测试、运行入口不再指向 TS 无法执行的路径。
- `runtime-entrypoints-after-ts-migration.test.ts`：启动或 dry-run 校验 `pnpm run server`、`cbw` bin、postinstall、Playwright config、Node test 入口。
- 更新现有 server/spec/e2e 测试文件为 TS，继续覆盖项目发现、会话续聊、workflow、settings、Git、Shell 等真实业务行为。

这些测试能证明迁移不是只改扩展名，而是运行、发布、测试、类型契约都切到 TypeScript。

## 风险与处理

- 风险：后端直接运行 TS 失败。
  - 处理：发布路径采用编译产物，dev/test 使用直接声明的 TS runner。
- 风险：一次性迁移所有测试导致定位困难。
  - 处理：先迁移测试 helper 和高价值 server 测试，再批量迁移纯断言测试。
- 风险：导入路径在 ESM 下扩展名不一致。
  - 处理：统一约定源码导入写法，并用 typecheck/build/test 覆盖 Node 和 Vite 两套解析。
- 风险：为了快速迁移引入大量 `any`。
  - 处理：契约测试或 lint-like 脚本统计新增 `any`，只允许在外部 JSON 边界集中使用并带注释。
