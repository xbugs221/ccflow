## Why

The current file tree is primarily a read-and-open surface. Users still need to leave CCUI for routine workspace management tasks such as creating files, renaming paths, uploading folders, and downloading artifacts, which breaks flow and weakens the value of the web workspace.

## What Changes

- Add first-class file tree operations for creating, renaming, deleting, copying paths, and refreshing workspace entries.
- Add upload flows for files and nested folders directly from the file tree.
- Add download flows for single files and whole folders from the file tree.
- Add node and background context menus so the file tree exposes workspace actions without falling back to the terminal.
- Add server-side path validation and project-root confinement for all new file operation endpoints.

## Capabilities

### New Capabilities
- `workspace-file-tree-operations`: Manage workspace files and folders from the file tree, including create, rename, delete, upload, and download flows.

### Modified Capabilities
- None.

## Impact

- Affected frontend areas: `src/components/file-tree/**`, shared API helpers, and related i18n strings.
- Affected backend areas: project file routes in `server/index.js` or extracted routes for file operations and archive/download handling.
- New dependency likely required for folder archive generation in the server or browser flow.
- Acceptance coverage will need end-to-end tests for realistic workspace file management flows.
