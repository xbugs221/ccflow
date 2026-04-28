## Context

The workspace editor already classifies Markdown files and lets users switch between editable source and a rendered preview. That preview is built with `react-markdown`, `remark-gfm`, `remark-math`, and `rehype-katex`, so prose, tables, math, and ordinary code fences render correctly, but fenced `mermaid` blocks stay plain text. This change is frontend-local, but it introduces a new rendering dependency and needs a clear fallback for invalid diagram source so preview mode does not become brittle.

## Goals / Non-Goals

**Goals:**

- Render fenced `mermaid` code blocks as diagrams inside workspace markdown preview.
- Preserve existing rendering for non-Mermaid markdown content, including ordinary code blocks.
- Keep preview usable when Mermaid parsing fails by showing a visible fallback state.
- Cover the behavior with acceptance tests that exercise the real editor preview flow.

**Non-Goals:**

- Adding Mermaid support to chat markdown or other markdown surfaces outside the workspace editor.
- Implementing live diagram rendering inside the editable CodeMirror surface.
- Supporting every Mermaid runtime customization option in the first change.

## Decisions

### 1. Add Mermaid at the markdown preview component boundary

`MarkdownPreview.tsx` already owns markdown-specific rendering concerns. The change will keep `react-markdown` as the entry point and extend the custom `code` renderer so fenced blocks tagged as `mermaid` render through a dedicated React component instead of the generic syntax-highlighted code path.

Alternatives considered:
- Preprocessing markdown text before it reaches `react-markdown`: rejected because it mixes parsing and rendering concerns and is harder to keep aligned with existing markdown plugins.
- Replacing the whole markdown renderer: rejected because the current stack already covers GFM and KaTeX correctly.

### 2. Render Mermaid diagrams client-side from fenced source

The dedicated Mermaid block component will render the diagram client-side from the fenced source string and inject the returned SVG into the preview surface. It will isolate Mermaid initialization/configuration behind that component so the rest of the editor keeps a simple content-in, DOM-out contract.

Alternatives considered:
- Server-side or build-time diagram rendering: rejected because markdown preview content is user-edited and needs immediate local feedback.
- Using a generic HTML passthrough for Mermaid script tags: rejected because the current preview path is React-based and should not rely on raw script execution.

### 3. Treat invalid Mermaid source as a local block failure, not a preview-wide failure

When Mermaid cannot parse a fenced block, the preview will show a small inline fallback message and the original source text for that block. Other markdown content on the page must continue rendering.

Alternatives considered:
- Silently hiding invalid diagrams: rejected because users lose the source and have no clue why the preview is blank.
- Throwing through React and failing the whole preview: rejected because one broken block should not take down the document preview.

## Risks / Trade-offs

- [Mermaid adds bundle/runtime cost] -> Scope the dependency to markdown preview and avoid touching non-markdown editor flows.
- [Diagram SVG styling conflicts with current prose styles] -> Keep Mermaid rendering inside a dedicated wrapper with constrained overflow and acceptance coverage for visible output.
- [Invalid Mermaid source becomes confusing] -> Render a visible fallback state with source text instead of a blank block.
- [Preview tests become flaky if they depend on implementation details] -> Assert user-visible outcomes in Playwright: preview toggle, diagram SVG presence, and fallback messaging.

## Migration Plan

1. Add Mermaid rendering support to the markdown preview component used by the workspace editor.
2. Introduce a dedicated Mermaid block renderer with per-block error handling.
3. Add OpenSpec acceptance tests for successful diagram rendering, ordinary code-block preservation, and invalid-source fallback.
4. Update `tests/spec/README.md` and the change-local `test_cmd.sh`.
5. Roll back by removing the Mermaid renderer and reverting the preview component to generic code-block rendering; no data migration is required.

## Open Questions

- Whether later iterations should support theme-aware Mermaid configuration so diagrams inherit light/dark styling more precisely.
- Whether chat markdown preview should eventually reuse the same Mermaid block renderer for consistency.
