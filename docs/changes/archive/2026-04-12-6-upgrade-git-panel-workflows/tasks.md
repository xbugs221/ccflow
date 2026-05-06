## 1. Safe Git backend contracts

- [x] 1.1 Replace shell-interpolated Git route execution with argument-safe process spawning
- [x] 1.2 Extend branch and status endpoints to return local/remote branch data plus staged/unstaged change groups
- [x] 1.3 Add guarded branch-deletion support and structured operation error responses
- [x] 1.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/git-panel-workflows.spec.js` 全部通过

## 2. Branches workflow UI

- [x] 2.1 Add a dedicated Branches tab to the Git panel
- [x] 2.2 Render local and remote branch sections with current-branch state, create flow, switch flow, and delete flow
- [x] 2.3 Keep current-branch deletion blocked and clearly explained in the UI
- [x] 2.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/git-panel-workflows.spec.js` 全部通过

## 3. Changes and failure feedback

- [x] 3.1 Split changes view presentation into staged and unstaged sections with change counts
- [x] 3.2 Add dismissible inline operation-error banners for fetch/pull/push and branch operations
- [x] 3.3 Refresh Git panel state coherently after successful or failed operations without forcing full-page reloads
- [x] 3.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/git-panel-workflows.spec.js` 全部通过
