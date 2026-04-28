## Context

The chat UI already has an in-app file-open path: tool cards call `onFileOpen`, the editor sidebar receives a workspace file path, and the existing project-scoped file API loads the document. Assistant markdown messages do not use that path. They render every link as a plain anchor with `target="_blank"`, so absolute filesystem paths become broken site URLs, project-relative paths resolve against the browser location instead of the workspace root, and `#L`-style file references never reach the embedded editor.

## Goals / Non-Goals

**Goals:**

- Recognize workspace file references inside assistant markdown content before the browser navigates.
- Reuse the existing `onFileOpen` flow so assistant file references and tool-card file opens converge on one editor path.
- Support the file-reference formats the app already emits most often: project-relative paths, absolute in-project paths, and file links with line suffixes or `#L` anchors.
- Preserve current external-link behavior for non-workspace hrefs.

**Non-Goals:**

- Adding a new backend API or a browser-visible filesystem protocol.
- Implementing precise editor cursor/scroll positioning for line and column references in this first change.
- Changing how tool cards open files; they already use the correct editor-routing path.

## Decisions

### 1. Introduce explicit workspace-link parsing in chat markdown rendering

Assistant markdown rendering will receive the same `onFileOpen` callback already used by tool cards. The markdown anchor renderer will classify href values as either workspace file references or ordinary links before deciding whether to intercept the click.

Alternatives considered:
- Regex-rewriting assistant message text before markdown render: rejected because it mixes presentation and transport concerns and is brittle around markdown escaping.
- Letting the browser navigate and then trying to recover state from the URL: rejected because the current URL scheme does not encode “open workspace file in editor”.

### 2. Treat relative paths as project-root-relative and absolute paths as valid only inside the selected project

The parser will accept:
- relative workspace paths such as `src/components/App.tsx`
- absolute filesystem paths under the selected project root
- the same paths with trailing `#L...` or `:line[:column]` suffixes

Absolute paths outside the selected project will not be intercepted and will fall back to normal link behavior.

Alternatives considered:
- Intercept every absolute path regardless of project membership: rejected because that would blur project boundaries and create ambiguous or unsafe editor opens.
- Supporting only absolute paths: rejected because assistant replies and human-authored markdown often use project-relative references.

### 3. Parse line suffixes now, defer precise line navigation

The parser will strip supported line suffixes when resolving the file path so common references like `[MessageComponent.tsx](/abs/path/MessageComponent.tsx#L407)` still open the target file. The first implementation will ignore the resolved line number after parsing unless the editor already exposes a low-risk navigation hook.

Alternatives considered:
- Rejecting links with line suffixes until full line navigation exists: rejected because it would fail the dominant file-reference format the app currently emits.
- Implementing custom editor scrolling in the same change: rejected because it expands scope into editor state and cursor management that the user did not ask for.

### 4. Keep external-link behavior intact

If an href is not recognized as a selected-project workspace reference, the renderer will preserve the existing anchor behavior. This keeps documentation, issue tracker, and web links working as they do today.

Alternatives considered:
- Sending every link through an app-owned redirect layer: rejected because it adds complexity without improving the workspace-file problem.

## Risks / Trade-offs

- [Workspace-link detection is too broad] → Require selected-project context and validate absolute paths stay under the current project root before intercepting.
- [Workspace-link detection is too narrow] → Support the path formats already emitted by assistant responses, including `#L` and `:line[:column]`, and cover them with acceptance tests.
- [Markdown renderer changes could break tool-result markdown or external links] → Keep interception local to file-reference classification and add an explicit acceptance test for non-workspace links.
- [Users may expect line-number jumping once `#L` links open] → Document that first delivery guarantees file open behavior; exact cursor placement remains out of scope.

## Migration Plan

1. Thread the existing `onFileOpen` callback into the markdown renderer used for assistant chat content.
2. Add a small workspace-link classifier/parser that distinguishes relative paths, in-project absolute paths, line-suffixed file references, and ordinary links.
3. Intercept recognized workspace file links, prevent browser navigation, and route them into the editor sidebar.
4. Add acceptance coverage for absolute, relative, and line-suffixed file references plus a regression test for external links.
5. Roll back by removing the markdown click interception if needed; the change is frontend-local and does not alter stored session data.

## Open Questions

- Should line references later scroll the editor only, or also visually highlight the target line?
- Should the same workspace-link interception be enabled for tool-result markdown content, or only assistant reply bodies in the first pass?
