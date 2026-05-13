## 设计原则

本次只清理旧 provider 残留，不扩大到执行架构重写。判断标准是：

```text
当前支持面:
  manual chat provider: codex | opencode
  workflow runner: wo
  chat executor: co

应清理:
  可导入的 Claude SDK/provider 模块
  以前端当前功能命名出现的 Claude 状态
  把 Claude 写成当前支持 provider 的文案和测试

应保留:
  第三方项目名或历史背景中的 Claude
  为避免嵌套进程误判而删除 CLAUDECODE 的环境隔离逻辑
  明确拒绝 legacy Claude 输入的业务测试
```

## Claude 残留分类

```text
Claude 残留
  |
  +-- provider 实现/兼容层       -> 删除
  +-- 当前 UI 状态命名           -> 改成 providerStatus / ProcessingStatus
  +-- 当前支持 provider 文案      -> 改成 Codex/OpenCode/co/wo
  +-- legacy 拒绝测试            -> 保留，但不能依赖 claude-sdk.js 存在
  +-- 第三方 TaskMaster 文档链接  -> 保留
  +-- CLAUDECODE 环境隔离         -> 保留并改注释为 nested agent marker
```

## 预期代码调整

- 删除 `server/claude-sdk.js`。
- 删除 `tests/server/claude-sdk.unsupported.test.js`。
- 更新 `tests/spec/upstream-critical-fixes.spec.js`，不再 import `server/claude-sdk.js`，只覆盖仍有效的 upstream fix。
- 将 `ClaudeStatus.tsx` 改名为通用 `ProcessingStatus.tsx`，并将 `claudeStatus` state/prop 改名为 `providerStatus` 或 `processingStatus`。
- 删除 `shared/modelConstants.js` 中的 `CLAUDE_MODELS`，同步更新 `tests/server/model-constants.test.js`。
- 更新 `tests/spec/test_legacy_claude_surfaces.js`，从“兼容层不导入 Anthropic SDK”改为“兼容层文件不存在且没有生产导入”。
- 清理 README 中当前支持面为 Codex/OpenCode/co/wo。

## 重复日期命名去重

执行阶段需要重命名已发现的重复日期前缀：

```text
tests/2026-05-10-2026-05-09-4-... -> tests/2026-05-09-4-...
tests/2026-05-10-2026-05-10-5-... -> tests/2026-05-10-5-...
tests/2026-05-11-2026-05-11-16-... -> tests/2026-05-11-16-...
docs/changes/archive/2026-05-11-2026-05-11-16-... -> docs/changes/archive/2026-05-11-16-...
docs/changes/archive/2026-05-11-2026-05-11-17-... -> docs/changes/archive/2026-05-11-17-...
```

重命名后必须同步更新：

- `playwright.spec.config.js`
- 归档设计文档中的测试路径引用
- 任何 `rg` 能找到的旧路径字符串

## 风险

- 部分测试当前把 `claude` 作为“必须拒绝的 legacy provider”输入。执行时要保留这类负向测试，避免误删拒绝契约。
- `ClaudeStatus` 实际是通用处理中 UI。重命名时要只改命名，不改加载/停止按钮行为。
- 空的 `tests/` 提案目录不写占位文件，真实测试在执行阶段同步到根测试套件。
