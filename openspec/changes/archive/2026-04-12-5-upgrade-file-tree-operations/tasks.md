## 1. Backend file operation surface

- [x] 1.1 Add centralized project-root path normalization and traversal protection for file mutations
- [x] 1.2 Implement create, rename, delete, upload, and download/archive endpoints for project files
- [x] 1.3 Add frontend API helpers and response typing for the new file operation routes
- [x] 1.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/file-tree-operations.spec.js` 全部通过

## 2. File tree mutation UX

- [x] 2.1 Add toolbar actions for new file, new folder, refresh, and collapse flows
- [x] 2.2 Add create, rename, delete, copy-path, and download handling in dedicated file-tree hooks
- [x] 2.3 Add node and background context menus wired to the scoped file-tree actions
- [x] 2.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/file-tree-operations.spec.js` 全部通过

## 3. Upload and archive workflows

- [x] 3.1 Add file and folder upload handling with preserved relative paths
- [x] 3.2 Add folder archive download handling that preserves nested content and raw bytes
- [x] 3.3 Surface operation success and error feedback in the file tree without forcing a full page reload
- [x] 3.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/file-tree-operations.spec.js` 全部通过
