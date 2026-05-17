## 背景

31 号 TypeScript 迁移提案记录了 browser spec 中已有失败，但那些失败不能继续作为新基线保留。本提案专门收口这些残留测试问题，并把全量验收统一到 `pnpm test`。

核心原则：

```text
近期提案行为是当前事实
├─ 不回撤源码到旧 JS/旧路径/旧 UI
├─ 测试和文档必须迁移到当前事实
├─ 失败先分类，再决定修测试或修源码
└─ 最终以 pnpm test 全绿作为完成条件
```

## 技术决策

### 决策 1：建立一个全量入口，而不是继续依赖多个局部脚本

`package.json` 应新增：

```text
test
├─ pnpm run typecheck
├─ pnpm run test:server
├─ pnpm run test:spec
└─ pnpm run test:e2e
```

其中 `test:spec` 已包含 node spec 和 browser spec，因此 `pnpm test` 会覆盖用户可感知的浏览器业务路径。细分脚本继续保留，用于开发阶段快速定位。

### 决策 2：每个业务契约只保留一个 canonical 测试

当前根目录 proposal 测试中有多份历史副本，例如 wo workflow、co client、runtime dependencies 等。执行阶段应按以下规则处理：

```text
重复且旧预期错误
└─ 删除旧副本，保留 tests/server 或 tests/spec canonical 测试

重复但覆盖独有场景
└─ 把独有场景迁入 canonical 测试，再删除旧副本

非重复但预期过期
└─ 更新为近期提案确定的新行为
```

删除测试只允许删除重复覆盖；不得删除唯一的业务场景。

### 决策 3：运行态路径通过 helper 解析

近期代码已经把 wo/cbw 运行态迁移到 XDG state。测试不得继续拼接项目内 `.wo/runs` 或 `.cbw/runs` 作为真实运行态。

执行阶段应把 Playwright fixture helper 暴露出明确函数：

```text
resolveFixtureWoStatePath(projectPath, runId)
resolveFixtureWoRunsRoot(projectPath)
resolveFixtureProjectConfigPath(projectPath)
```

测试只通过这些 helper 读写 fixture 状态。项目内 `.wo` 字符串只能作为展示用 artifact path 或兼容输入，不得作为测试读写 state.json 的实际路径。

### 决策 4：静态契约断言当前 TS 代码库

旧测试中的 `.js/.jsx` 文件名应更新为当前文件：

```text
src/main.jsx                         -> src/main.tsx
src/components/auth/SetupForm.jsx    -> src/components/auth/SetupForm.tsx
src/components/auth/Onboarding.jsx   -> src/components/auth/Onboarding.tsx
ProjectCreationWizard.jsx            -> ProjectCreationWizard.tsx
LanguageSelector.jsx                 -> LanguageSelector.tsx
```

服务端源码导入可继续按当前 ESM/构建策略使用 `.js` import specifier，只要 typecheck/build/runtime 证明它能工作。测试不应强制源码 import 字符串必须写 `.ts`，除非该约定已经被近期提案明确要求且构建链支持。

### 决策 5：Playwright 失败分层修复

浏览器失败分三层处理：

```text
旧选择器/文案
├─ dock 默认可见断言
├─ OpenCode provider 文案
├─ workflow role row getByRole('button') 多匹配
└─ fixture session 标题变更

fixture 路径或数据过期
├─ chat search 修改旧 .cbw/runs state.json
├─ workflow kickoff 检查旧 .wo/runs
└─ 搜索结果仍期望旧 sessionSummary

潜在真实回归
├─ Pi 新建会话不进入 cN
├─ co reconnect 不写 startRequestId
├─ shell reconnect 找不到 /shell websocket
└─ 项目主页收藏没有持久化到当前 config
```

前两层优先修测试和 helper。第三层必须用最小复现确认；若当前产品行为确实破坏近期提案意图，则修源码。

## 测试策略

执行阶段应先把本提案 `tests/` 中的真实测试同步到根测试套件，再实现修复：

- `pnpm-test-entry-contract.test.ts` 放入 `tests/` 根目录，使用 `node:test` 静态读取 `package.json`。
- `no-stale-test-contract.test.ts` 放入 `tests/` 根目录，使用 `git ls-files` 或 `rg` 扫描测试和归档文档。
- `canonical-tests-contract.test.ts` 放入 `tests/` 根目录，断言已知重复测试路径不存在或已更新为 canonical 引用。
- `playwright-fixture-runtime-paths.test.ts` 放入 `tests/server` 或 `tests/spec/test_*.ts`，直接导入 fixture/helper 和 `wo-runtime-paths.ts` 验证路径。
- 更新现有 Playwright spec/e2e，仍通过真实浏览器行为验证 Pi、co、shell、workflow、search、settings 和 dock。

这些测试必须反映真实业务需求：用户能创建会话、打开工作流、搜索聊天历史、操作 shell、切换设置页并看到当前 provider 状态。

## 风险与处理

- 风险：删除根目录旧 proposal 测试时丢失独有场景。
  - 处理：删除前用文件名和测试名对比 canonical 测试；独有断言先迁入 canonical 文件。
- 风险：Playwright 测试变绿但不再覆盖真实流程。
  - 处理：优先使用用户可见按钮、URL、API payload、持久化配置和 WebSocket 消息断言，不只检查元素存在。
- 风险：`pnpm test` 时间变长。
  - 处理：保留细分脚本供开发使用；全量入口作为合并前验收。
- 风险：真实回归与测试过期难以区分。
  - 处理：每个潜在回归先单测或单 spec 复现，确认业务意图后再改源码。
