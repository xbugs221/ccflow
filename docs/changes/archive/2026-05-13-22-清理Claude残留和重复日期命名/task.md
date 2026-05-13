## 1. Claude SDK 残留

- [x] 1.1 删除 `server/claude-sdk.js`。
- [x] 1.2 删除 `tests/server/claude-sdk.unsupported.test.js`。
- [x] 1.3 更新 `tests/spec/upstream-critical-fixes.spec.js`，移除对 `server/claude-sdk.js` 的导入断言。
- [x] 1.4 更新 legacy guard 测试，断言兼容模块不存在且没有生产导入。

## 2. 前端通用状态命名

- [x] 2.1 将 `ClaudeStatus.tsx` 改为通用处理中组件 `ProcessingStatus.tsx`。
- [x] 2.2 将 `claudeStatus` state/prop/type 改为 `processingStatus`。
- [x] 2.3 保持发送消息、处理中展示和停止按钮行为不变。
- [x] 2.4 更新相关静态测试和业务测试断言。

## 3. 模型常量和文案

- [x] 3.1 删除 `shared/modelConstants.js` 中的 `CLAUDE_MODELS`。
- [x] 3.2 更新 `tests/server/model-constants.test.js`。
- [x] 3.3 更新 README，描述 ccflow + co + wo 的当前支持面。
- [x] 3.4 清理文档中把 Claude 写成当前 provider 的过期文案。

## 4. 重复日期命名去重

- [x] 4.1 重命名根 `tests/` 下重复日期前缀文件（10 个文件）。
- [x] 4.2 重命名 `docs/changes/archive/` 下重复日期前缀目录（3 个目录）。
- [x] 4.3 更新 `playwright.spec.config.js` 和文档引用。
- [x] 4.4 使用 `rg` 确认不存在旧重复日期路径引用。

## 5. 测试和验证

- [x] 5.1 在本提案 `tests/` 目录编写真实测试（15 个 guard tests，全部通过）。
- [x] 5.2 运行 legacy Claude guard 测试。
- [x] 5.3 运行 provider contract 相关 server 测试。
- [x] 5.4 运行 `pnpm run typecheck`。
