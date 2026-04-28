## Context

`src/components/file-tree/` currently supports project browsing, search, view-mode switching, image preview, and file open callbacks, but it does not own mutation flows. Users must leave the file tree for routine workspace management, and the backend only exposes read/save primitives rather than a complete file-operation surface. This change spans frontend hooks, project file routes, upload/download transport, and archive handling, so it benefits from an explicit design before implementation.

## Goals / Non-Goals

**Goals:**

- Let authenticated users create, rename, delete, upload, and download workspace content directly from the file tree.
- Keep every new file-system operation constrained to the selected project root.
- Preserve nested relative paths during folder upload and folder download flows.
- Expose the new actions through lightweight toolbar buttons and scoped context menus.

**Non-Goals:**

- Replacing the existing code editor or changing save semantics for text files.
- Adding merge/conflict resolution for concurrent edits.
- Implementing cloud sync, resumable uploads, or background transfer queues.

## Decisions

### 1. Add dedicated file-operation endpoints instead of overloading existing read/save routes

The server will expose additive endpoints under the project file namespace for create, rename, delete, upload, and download operations. A shared project-root resolver and path validator will normalize incoming paths, reject traversal attempts, and keep mutations inside the selected workspace.

Alternatives considered:
- Extending the existing `/api/projects/:projectName/file` read/save route: rejected because CRUD, upload, and archive semantics would become ambiguous and path validation would stay scattered.

### 2. Preserve directory structure during uploads with multipart payloads plus explicit relative paths

Folder upload will use `multipart/form-data` with `targetPath`, repeated file parts, and a JSON array of `relativePaths`. The browser can collect files from drag-and-drop entries or a fallback file picker; the server reconstructs the final tree under the chosen directory.

Alternatives considered:
- JSON-encoded base64 uploads: rejected because payload inflation is large and binary handling becomes more error-prone.

### 3. Generate folder downloads as ZIP archives without text decoding

Folder download will be implemented as a binary-safe archive response that reads raw bytes from disk and preserves nested paths. The implementation must not reuse text-oriented file endpoints or browser-side string-to-blob reconstruction.

Alternatives considered:
- Building ZIP archives in the browser from tree data: rejected because the browser would need a complete recursive file-read surface and would be more likely to corrupt binary assets.

### 4. Keep file-tree state changes in focused hooks

The file tree will add focused hooks for operations and uploads, while `FileTree.tsx` remains the orchestrator for view state, modal state, and refresh behavior. Context menu rendering stays in a dedicated component so node actions and blank-space actions can share positioning and keyboard handling.

Alternatives considered:
- Putting all mutation state into `FileTree.tsx`: rejected because create/rename/delete/upload flows would become hard to test and harder to reuse across node/background actions.

## Risks / Trade-offs

- [Browser directory drag-and-drop support differs across engines] → Provide a file-list fallback and keep uploads server-driven once files are collected.
- [Large folder downloads may consume memory during archive construction] → Stream where feasible and define conservative size/error handling for oversized archives.
- [External file-system changes can race with user actions] → Refresh tree state after successful mutations and show operation-level errors instead of assuming local state is authoritative.
- [Path validation bugs could expose files outside the project root] → Centralize normalization and add explicit acceptance coverage for traversal attempts.

## Migration Plan

1. Add backend file-operation endpoints and path-safety helpers behind additive routes.
2. Add frontend API helpers and mutation hooks without removing existing browse/open flows.
3. Ship toolbar actions first, then node/background context menus and upload affordances.
4. Roll back by hiding the new UI affordances and disabling the additive endpoints if a regression appears; existing browse/open/save behavior remains intact.

## Open Questions

- What maximum upload/download size should CCUI allow before showing a refusal or warning?
- Should create flows allow nested path entry in one step, or only create within the currently selected directory?
- Do we want overwrite prompts for uploads, or deterministic “fail if exists” behavior in the first version?
