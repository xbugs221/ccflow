# Design: Repository simplification and modular refactor

## Goals

This change keeps one OpenSpec proposal while implementing three ordered phases: repository hygiene, folder-boundary cleanup, and logic extraction. The implementation should remain behavior-preserving and should keep each commit reviewable.

## Current Observations

- Package management is ambiguous because pnpm workspace files and npm lock state coexist, while scripts still call `npm run`.
- Tracked workflow artifacts such as planner and execution outputs blur the boundary between source and generated state.
- Large hotspots include `server/projects.js`, `server/index.js`, `server/routes/taskmaster.js`, `server/workflows.js`, `src/components/chat/view/ChatInterface.tsx`, `src/components/TaskList.jsx`, and chat state hooks.
- Frontend code is partly feature-oriented but still has flat root components and shared helpers spread across `components`, `hooks`, `lib`, and `utils`.
- Server code mixes routes, orchestration, adapters, persistence access, and streaming/session helpers in large files.

## Target Structure

### Package and Repository Boundary

- Use pnpm as the only supported package manager.
- Keep `pnpm-lock.yaml` and `pnpm-workspace.yaml`; remove npm lock state.
- Add `packageManager` metadata and convert package scripts that shell back into npm to pnpm.
- Move tracked workflow outputs out of source control and add ignore rules for regenerated equivalents.

### Frontend Boundary

- Organize feature code by domain, for example chat, projects, workflows, settings, sidebar, shell, git, file-tree, task management, and shared UI.
- Keep common UI primitives and pure utilities outside feature folders.
- Extract pure data transforms, reducers, parsers, and API helpers from large view components and hooks.
- Avoid moving files solely for cosmetics; each move should reduce ownership ambiguity or coupling.

### Server Boundary

- Keep route modules thin.
- Move business operations into service modules grouped by domain, such as projects, workflows, sessions, agents, git, taskmaster, and shell.
- Move reusable adapters, stream writers, response collectors, filesystem helpers, and command builders into explicit shared server modules.
- Keep database access and persistence helpers behind stable module boundaries.

### Test Boundary

- Tests should verify real workflows: install/build/typecheck, chat/session message behavior, project/workflow routing, taskmaster operations, git operations, and server routes touched by refactors.
- Where logic is extracted into pure helpers, add focused tests for the helper behavior and keep at least one workflow-level test for the surrounding feature.

## Migration Strategy

1. Normalize pnpm and git-tracking boundaries first so later refactors run from a reproducible baseline.
2. Move files in domain-sized slices and update imports without changing behavior.
3. Extract helpers from the largest hotspots only when tests or existing behavior make the boundary clear.
4. Run verification after each slice to isolate regressions.

## Risks

- Broad file moves can make diffs hard to review. Mitigation: separate move-only steps from logic extraction where practical.
- Refactoring chat/session/workflow code can regress live state behavior. Mitigation: protect message, session, and workflow flows with existing and added tests.
- Package-manager cleanup can break install scripts. Mitigation: require frozen pnpm install and build/typecheck verification.
