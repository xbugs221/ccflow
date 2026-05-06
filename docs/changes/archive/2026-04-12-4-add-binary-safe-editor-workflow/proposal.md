## Why

The current editor assumes most opened artifacts are text. That causes poor UX for binary assets and creates a real correctness risk when download flows decode and re-encode bytes as UTF-8, which can corrupt images, PDFs, archives, and other non-text files.

## What Changes

- Detect binary files before rendering them in the code editor.
- Add a dedicated non-editable binary-file experience with clear user guidance and download actions.
- Split editor behavior by file type so text, markdown, images, and binary assets follow explicit handling paths.
- Make binary download and archive flows byte-preserving end to end.
- Ensure file open and download flows reuse binary-safe transport instead of text-oriented endpoints.

## Capabilities

### New Capabilities
- `binary-safe-editor-workflow`: Open, classify, and download non-text workspace files without corrupting content or forcing them through the text editor.

### Modified Capabilities
- None.

## Impact

- Affected frontend areas: `src/components/code-editor/**`, file open flows, and related download affordances.
- Affected backend areas: file content/download endpoints and any archive generation used by workspace downloads.
- Acceptance coverage will need binary fixtures and byte-level assertions for open/download behavior.
- This change depends on the workspace file APIs remaining project-root safe and transport-correct.
