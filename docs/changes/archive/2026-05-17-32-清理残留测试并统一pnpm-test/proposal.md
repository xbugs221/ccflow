## 问题

近期变更已经完成了仓库精简、TypeScript 统一迁移、XDG 运行态迁移、Pi provider 接入、wo/oz 新契约和工作流详情 UI 调整，但测试和归档文档中仍残留旧断言：

- 部分测试仍读取 `src/main.jsx`、`SetupForm.jsx`、`LanguageSelector.jsx` 等已迁移的旧文件。
- 部分测试仍硬编码 `.wo/runs`、`.cbw/runs`，没有使用当前 XDG state 下的 wo/cbw 运行态路径。
- 旧 proposal 根目录测试与 `tests/server`、`tests/spec` 中的 canonical 测试重复，且没有同步近期业务意图。
- Playwright 测试仍使用旧 dock 默认可见、旧 OpenCode provider 文案、旧工作流 role row 按钮选择器、旧会话标题等预期。
- `package.json` 还没有 `pnpm test` 全量入口，无法用一个命令证明当前代码库测试全部通过。

当前状态导致“近期代码行为正确但旧测试失败”和“可能存在真实回归”混在一起，审查者无法快速判断哪些失败需要修产品、哪些失败应修测试。

## 目标

以近期变更提案已经确立的行为为准，清理残留测试和文档，并建立全量测试入口：

- 不回撤 TypeScript、XDG state、Pi provider、wo/oz 新命令、工作流详情新 UI 等近期实现。
- 删除或合并重复历史测试，只保留每个业务契约的 canonical 测试。
- 更新测试和归档文档，使其断言当前代码库行为，而不是旧文件名、旧路径或旧 UI。
- 复核 Pi 会话、co reconnect、shell reconnect、收藏持久化等失败，确认为真实回归时修源码，否则修测试夹具和断言。
- 新增 `pnpm test`，覆盖 typecheck、server、spec node、spec browser 和 e2e。
- 完成后 `pnpm test` 必须全部通过，不允许通过 skip、弱化业务断言或恢复旧行为来达成绿灯。

## 范围

```text
测试入口
├─ package.json 增加 test 脚本
├─ test 覆盖 typecheck、server、spec、browser spec、e2e
└─ 保留细分脚本，方便定位失败

历史测试清理
├─ 归并或删除与 tests/server canonical 重复的根目录旧 proposal 测试
├─ 更新仍有价值的根目录 proposal 测试到当前 TS/XDG/Pi 契约
├─ 修正静态契约里的 .js/.jsx 旧路径
└─ 清理 docs/changes/archive 中指向旧测试路径的文档

Playwright 测试适配
├─ fixture helper 统一解析 XDG wo/cbw state 路径
├─ 更新会话标题、role row、dock、OpenCode 设置页等当前 UI 选择器
├─ 修复 Pi 手动会话、co reconnect、shell reconnect、收藏状态等真实业务失败
└─ 避免依赖测试执行顺序或上一次 fixture 副作用
```

## 非目标

- 不恢复 `.js/.jsx` 源码入口。
- 不恢复旧 `.wo/runs` 或 `.cbw/runs` 作为运行态来源。
- 不移除 Pi provider 或恢复 provider 集合到旧状态。
- 不把浏览器测试从全量入口中排除。
- 不通过 `test.skip`、条件跳过、删除高价值业务覆盖或放宽到无意义断言来制造通过。
- 不做与测试收口无关的 UI 重构或产品功能扩展。

## 测试意图

执行阶段需要新增或更新真实测试：

- `pnpm-test-entry-contract.test.ts`：断言 `package.json` 中 `test` 脚本覆盖 `typecheck`、`test:server`、`test:spec` 和 `test:e2e`，且 `test:spec` 包含 browser spec。
- `no-stale-test-contract.test.ts`：扫描测试和归档文档，断言不再引用已删除的 `.jsx` 入口、旧 `.cbw/runs`、旧 `.wo/runs` 或旧重复日期路径。
- `canonical-tests-contract.test.ts`：断言根目录旧 proposal 测试已经删除、归并或更新，不再与 `tests/server` canonical 测试冲突。
- `playwright-fixture-runtime-paths.test.ts`：验证 Playwright fixture 通过 helper 解析当前 XDG wo state 路径，避免硬编码旧项目内运行态目录。
- 更新 Pi、co reconnect、shell reconnect、workflow role row、OpenCode settings、chat search、dock 和收藏持久化相关 Playwright 测试，让它们覆盖当前真实业务行为。

最终验收命令：

```bash
pnpm test
```
