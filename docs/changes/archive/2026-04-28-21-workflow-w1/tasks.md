# Tasks

## 1. Package and Git Boundary

- [x] Add pnpm package metadata and convert npm-recursive scripts to pnpm.
- [x] Remove npm lock state and keep pnpm lock/workspace files as the reproducible install source.
- [x] Remove tracked workflow artifacts from git tracking: `planner-output.json`, `execution-manifest.json`, `verification-evidence.json`, and `delivery-summary.md`.
- [x] Update ignore rules so regenerated workflow, execution, verification, build, cache, and local environment outputs stay untracked.

## 2. Source Structure

- [x] Define target frontend feature folders and move files in behavior-preserving slices.
- [x] Define target server domain folders and move route-adjacent business logic into service modules.
- [x] Keep shared client utilities, shared server utilities, and cross-runtime shared modules in explicit locations.
- [x] Update imports, exports, and path references after each move.

## 3. Logic Extraction

- [x] Split high-risk frontend hotspots, starting with chat interface/state, task list, project creation, and settings/git controllers.
- [x] Split high-risk server hotspots, starting with projects, workflows, taskmaster routes, git routes, and server index orchestration.
- [x] Extract pure helpers for parsing, message transforms, command argument building, stream/session writers, and workflow state transitions.
- [x] Add or update function-level docstrings for extracted business logic.

## 4. Verification

- [x] Verify `pnpm install --frozen-lockfile`.
- [x] Verify `pnpm run build`.
- [x] Verify `pnpm run typecheck`.
- [x] Run relevant server and browser workflow tests covering chat/session, project/workflow, taskmaster, git, and package-manager behavior.
- [x] Confirm `git status --short` does not show regenerated artifacts after verification commands.
