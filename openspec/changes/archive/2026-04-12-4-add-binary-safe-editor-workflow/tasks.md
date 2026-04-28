## 1. Binary classification and transport

- [x] 1.1 Add file classification metadata for text, markdown, image, and binary open flows
- [x] 1.2 Route binary downloads through a byte-preserving transport instead of text decoding
- [x] 1.3 Keep existing text file reads and saves compatible with the new classification contract
- [x] 1.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/binary-safe-editor-workflow.spec.js` 全部通过

## 2. Editor mode branching

- [x] 2.1 Add a dedicated binary placeholder component and wire it into the editor open flow
- [x] 2.2 Hide save and markdown-preview controls whenever the opened file is non-text
- [x] 2.3 Keep image assets on a visual-preview path and avoid regressing current image viewing behavior
- [x] 2.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/binary-safe-editor-workflow.spec.js` 全部通过

## 3. Download correctness and UX

- [x] 3.1 Update download actions so binary files are fetched and saved as raw bytes
- [x] 3.2 Surface clear user messaging when a file is intentionally non-editable
- [x] 3.3 Verify null-byte and mislabeled-binary fixtures take the binary-safe path
- [x] 3.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/binary-safe-editor-workflow.spec.js` 全部通过
