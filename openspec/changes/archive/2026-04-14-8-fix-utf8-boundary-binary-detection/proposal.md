## Why

当前编辑器的文件分类逻辑会先截取固定长度样本，再用严格 UTF-8 解码判断文本安全性。对于包含中文等多字节字符的合法 UTF-8 Markdown/文本文件，如果样本边界恰好落在字符中间，系统会把本应可编辑的文本误判为二进制，直接阻断编辑与预览。

## What Changes

- 修正工作区编辑器的文本/二进制分类规则，使合法 UTF-8 文件不会因为采样边界截断而被误判。
- 明确 Markdown 与普通文本在“文本安全”判定通过后的后续路由，继续进入可编辑路径，而不是落到二进制占位态。
- 补充覆盖 UTF-8 多字节字符边界场景的验收测试，固定这一回归风险。

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `binary-safe-editor-workflow`: 文件分类要求需要更新，合法 UTF-8 文本即使在采样边界出现不完整尾字节，也必须继续按文本/Markdown 处理，而不是误判为二进制。

## Impact

- 后端影响：`server/index.js` 中的文本安全检测与文件分类逻辑。
- 前端影响：编辑器打开同一路径后应继续展示 Markdown/文本编辑能力，避免错误进入 binary placeholder。
- 验收影响：需要扩展 `tests/spec/binary-safe-editor-workflow.spec.js`，加入真实中文 Markdown 边界场景。
