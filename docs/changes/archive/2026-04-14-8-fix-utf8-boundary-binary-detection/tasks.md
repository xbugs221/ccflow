## 1. 文本分类边界修复

- [x] 1.1 调整后端 UTF-8 文本安全检测，使固定长度样本在尾部截断多字节字符时不再误判为二进制
- [x] 1.2 保持 `NUL`、图片和真实二进制文件的现有分类行为不回退
- [x] 1.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/binary-safe-editor-workflow.spec.js -g "utf-8 markdown files remain editable when the sample boundary splits a multibyte character"` 全部通过

## 2. Markdown 编辑器回归保护

- [x] 2.1 确认 Markdown 文件在文本安全判定通过后继续进入 Markdown 编辑路径并保留预览入口
- [x] 2.2 将中文 Markdown 边界场景纳入 OpenSpec 验收测试与变更本地测试命令
- [x] 2.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/binary-safe-editor-workflow.spec.js` 全部通过

## 3. OpenSpec 产物对齐

- [x] 3.1 保持 proposal、design、delta spec、`tests/spec/README.md` 与变更内 `test_cmd.sh` 一致
- [x] 3.2 验收：`bash openspec/changes/1-fix-utf8-boundary-binary-detection/test_cmd.sh` 全部通过
