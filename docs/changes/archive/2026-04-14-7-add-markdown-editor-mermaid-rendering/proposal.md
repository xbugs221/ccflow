## Why

Markdown files opened in the workspace editor can switch into preview mode, but fenced `mermaid` blocks currently fall back to plain code. That blocks a common documentation workflow where architecture notes, flow charts, and state diagrams need to render directly inside the editor before saving or sharing.

## What Changes

- Add Mermaid diagram rendering to markdown preview inside the workspace code editor.
- Keep ordinary fenced code blocks and non-Mermaid markdown content rendering as they do today.
- Show a clear fallback state when a Mermaid block cannot be rendered so preview mode stays usable instead of failing silently.
- Add acceptance coverage for rendered Mermaid diagrams and invalid Mermaid source handling in markdown preview.

## Capabilities

### New Capabilities
- `markdown-editor-mermaid-rendering`: Render Mermaid fenced code blocks in workspace markdown preview while preserving normal markdown behavior for other content.

### Modified Capabilities
- None.

## Impact

- Affected frontend areas: [`src/components/code-editor/view/subcomponents/markdown/MarkdownPreview.tsx`](/path/to/project/src/components/code-editor/view/subcomponents/markdown/MarkdownPreview.tsx) and any new markdown-preview helper components.
- Affected dependencies: frontend markdown preview may add Mermaid rendering support and its styling/runtime initialization.
- Affected acceptance coverage: new Playwright spec under `tests/spec/` plus `tests/spec/README.md` and the change-local `test_cmd.sh`.
