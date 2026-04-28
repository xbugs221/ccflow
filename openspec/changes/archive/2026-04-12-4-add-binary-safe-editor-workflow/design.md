## Context

`src/components/code-editor/` currently assumes the opened document is text-centric, and download flows risk passing binary content through UTF-8 decoding/re-encoding. The repository already has a binary-content endpoint for some file views, but the editor workflow does not yet classify files before render or present a dedicated non-text experience. This change spans editor state, file-open routing, and byte-preserving downloads, so it needs a design that separates file types explicitly.

## Goals / Non-Goals

**Goals:**

- Detect whether an opened file should be treated as text, markdown, image, or binary before rendering editor UI.
- Present binary files through a dedicated, non-editable UI that still supports safe download.
- Ensure binary download flows preserve exact bytes end to end.
- Keep existing text and markdown editing flows intact.

**Non-Goals:**

- Building a general-purpose binary viewer or hex editor.
- Performing server-side transcoding for media files.
- Replacing the dedicated image-viewer experience with a generic editor container.

## Decisions

### 1. Classify files before rendering editor state

The file-open flow will obtain enough metadata to determine whether a target file is text-safe before constructing the text editor surface. Binary classification should prefer raw-byte inspection and MIME/extension hints over extension-only guesses.

Alternatives considered:
- Client-only extension checks: rejected because extension-only detection misses extensionless files and mislabeled binary assets.

### 2. Route non-text files to explicit UI modes

The editor workflow will branch into explicit modes: editable text/markdown, image preview, or binary placeholder. Binary mode will never initialize the text editor or expose save/markdown-preview controls.

Alternatives considered:
- Rendering binary files as best-effort text with warning banners: rejected because it still encourages corruption and confusing UX.

### 3. Keep downloads byte-preserving and independent from text endpoints

Download actions for non-text files will call a binary-safe endpoint and construct browser downloads from raw bytes rather than decoded strings. This applies to files opened from the editor as well as related “download current file” affordances.

Alternatives considered:
- Reusing the text read endpoint for all downloads: rejected because UTF-8 decode/re-encode can alter bytes.

### 4. Make unsupported diff/edit states explicit

If a binary file is opened through a workflow that normally supports diff/edit behavior, the UI will show a clear non-editable state rather than pretending the content can be merged or saved.

Alternatives considered:
- Silently hiding the editor: rejected because users would not understand whether the file failed to load or was intentionally blocked from editing.

## Risks / Trade-offs

- [Binary detection can misclassify unusual text encodings] → Keep the detection conservative, prefer raw-byte inspection, and treat ambiguous content as non-editable instead of corruptible.
- [Different open paths may diverge in behavior] → Centralize file classification and mode selection instead of scattering it across file tree, editor, and Git diff code paths.
- [Users may expect more preview types once binary mode exists] → Keep the first version explicit about scope: text editing, image preview, or binary download only.
- [Byte-preserving downloads may require separate code paths from existing text downloads] → Accept the duplicated transport logic to protect correctness.

## Migration Plan

1. Add file classification metadata and binary-safe transport at the file-open/download boundary.
2. Introduce explicit editor modes and a binary placeholder component without changing current text editor behavior.
3. Wire download controls to the binary-safe path for non-text assets.
4. Roll back by restoring the previous text-only editor path if necessary, while keeping additive transport helpers isolated.

## Open Questions

- Should image assets always stay in the dedicated image viewer, or can the editor shell host that preview in a later phase?
- Do we need a visible “open externally” affordance for binary files in addition to download?
- Which exact byte-level heuristic should define “binary” for extensionless files?
