## 1. Workspace link detection

- [x] 1.1 Thread selected-project file-open context into assistant markdown rendering so links can opt into editor routing
- [x] 1.2 Implement workspace file-reference parsing for absolute paths, project-relative paths, and line-suffixed references
- [x] 1.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-file-links-open-in-editor.spec.js` 全部通过

## 2. Embedded editor routing

- [x] 2.1 Intercept recognized workspace file links and prevent browser navigation for those clicks
- [x] 2.2 Route recognized workspace file links through the existing editor sidebar open flow while keeping the current session route active
- [x] 2.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-file-links-open-in-editor.spec.js` 全部通过

## 3. External-link regression coverage

- [x] 3.1 Preserve normal browser behavior for non-workspace links rendered in assistant markdown
- [x] 3.2 Keep OpenSpec acceptance artifacts aligned: `tests/spec/chat-file-links-open-in-editor.spec.js`, `tests/spec/README.md`, and `test_cmd.sh`
- [x] 3.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-file-links-open-in-editor.spec.js` 全部通过
