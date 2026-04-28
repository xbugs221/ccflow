## 1. Markdown preview Mermaid renderer

- [x] 1.1 Add Mermaid preview rendering support under the workspace editor markdown preview path
- [x] 1.2 Keep ordinary fenced code blocks on the existing syntax-highlighted rendering path
- [x] 1.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/markdown-editor-mermaid-rendering.spec.js -g "markdown preview renders valid mermaid fenced blocks as diagrams"` 全部通过

## 2. Invalid diagram fallback

- [x] 2.1 Add per-block Mermaid render error handling with a visible fallback message and source text
- [x] 2.2 Ensure invalid Mermaid blocks do not break the rest of the markdown preview
- [x] 2.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/markdown-editor-mermaid-rendering.spec.js -g "markdown preview shows a visible fallback when a mermaid block is invalid"` 全部通过

## 3. Acceptance artifact alignment

- [x] 3.1 Keep OpenSpec artifacts aligned: proposal, design, spec, acceptance README, and change-local test command
- [x] 3.2 Verify the full Mermaid acceptance spec passes after implementation
- [x] 3.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/markdown-editor-mermaid-rendering.spec.js` 全部通过
