## Why

Agent replies in the chat transcript often include markdown file references, but those links currently behave like ordinary browser URLs. That breaks two core workflows: project-relative links resolve to the wrong location, and valid workspace file paths do not open the embedded editor the user is already working in.

## What Changes

- Detect workspace file references rendered inside assistant markdown messages instead of treating every link as an external URL.
- Resolve both project-relative and absolute in-workspace file paths against the selected project before opening them.
- Route recognized workspace file references through the existing inline editor open flow so the current session stays in place.
- Preserve normal browser behavior for non-workspace links such as docs, issue trackers, or other external URLs.
- Add acceptance coverage for assistant-message file references so future rendering changes do not regress editor-opening behavior.

## Capabilities

### New Capabilities
- `chat-file-links-open-in-editor`: Recognize workspace file references in assistant markdown replies and open them in the embedded editor instead of navigating the browser.

### Modified Capabilities
- None.

## Impact

- Affected frontend areas: chat markdown rendering, message click handling, and editor open routing under `src/components/chat/**` and `src/components/code-editor/**`.
- Affected acceptance coverage: new Playwright specs under `tests/spec/` for assistant-message link resolution and editor opening.
- No backend API contract changes are required if the frontend continues to use the existing project-scoped file read flow.
