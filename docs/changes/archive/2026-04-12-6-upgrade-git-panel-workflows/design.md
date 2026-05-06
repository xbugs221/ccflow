## Context

`src/components/git-panel/` already covers status, diffs, commits, and remote operations, but it still models branches as a flat list and relies on shell-interpolated Git commands in `server/routes/git.js`. The user experience for fetch/pull/push failures is also weak because errors are mostly logged rather than surfaced in the panel. This change spans API contracts, command execution safety, and UI structure, so it needs a clear design before implementation.

## Goals / Non-Goals

**Goals:**

- Let users manage common branch workflows directly from the Git panel.
- Separate local and remote branch presentation in the panel.
- Distinguish staged and unstaged changes in the panel UI.
- Surface fetch/pull/push failures inline with dismissible feedback.
- Harden Git route execution by moving sensitive commands to argument-safe process spawning.

**Non-Goals:**

- Implementing merge conflict resolution, rebase flows, stash management, or advanced history rewriting.
- Building a full Git hosting integration for pull requests or remote auth setup.
- Replacing the existing commit history flow with a new timeline system.

## Decisions

### 1. Move Git execution to argument-safe spawning

Git routes will use `spawn`/`execFile`-style argument arrays with `shell: false` instead of shell-interpolated command strings. This reduces injection risk and makes path/branch handling more predictable across files with spaces or special characters.

Alternatives considered:
- Escaping strings more carefully around `exec`: rejected because correctness is brittle and future route additions would likely regress.

### 2. Expand Git API contracts to match UI needs

The backend will return structured branch data (`currentBranch`, `localBranches`, `remoteBranches`) and operation failures with stable error/details fields. Status data will also expose enough information for the UI to split staged and unstaged changes deterministically.

Alternatives considered:
- Keeping the current flat branch list and inferring everything in the client: rejected because the client cannot safely infer branch provenance or command failure semantics.

### 3. Add a dedicated Branches tab instead of overloading the header menu

Branch lifecycle actions will live in a third Git panel tab. That keeps branch management visible, avoids burying destructive actions inside the header, and leaves the existing changes/history views focused on their current jobs.

Alternatives considered:
- Keeping branch actions in the header dropdown only: rejected because it scales poorly once local/remote sections and delete actions are introduced.

### 4. Keep operation errors as controller state with explicit dismissal

`useGitPanelController` will own an `operationError` state so failed fetch/pull/push/delete/switch actions can render an inline banner and clear predictably when the user dismisses it or a subsequent action succeeds.

Alternatives considered:
- Continuing to rely on console logging or modal alerts: rejected because users lose context and the panel cannot express recoverable failure states.

## Risks / Trade-offs

- [Worktree, detached-HEAD, or remote-less repositories have edge cases] → Return explicit backend state and empty-section UI instead of assuming a normal tracked branch setup.
- [Switching branches with local changes can surprise users] → Keep confirmation flows and surface backend refusal messages inline.
- [Staged/unstaged parsing varies with Git porcelain output] → Normalize parsing in one backend helper and cover it with realistic repository tests.
- [Branches tab increases UI density] → Keep the first version scoped to branch lifecycle basics and defer advanced Git features.

## Migration Plan

1. Replace shell-interpolated Git routes with argument-safe execution helpers.
2. Extend the branches/status API contracts and add delete-branch support.
3. Add controller state for structured operation errors.
4. Add the Branches tab and staged/unstaged sections to the existing Git panel.
5. Roll back by hiding the new tab and reusing the safer backend helpers even if the richer UI is reverted.

## Open Questions

- Should switching to a remote branch auto-create a local tracking branch, or should the first version only switch existing local branches?
- Do we want per-action retry buttons inside the inline error banner, or is dismiss-only enough for the first release?
- Should ahead/behind counts appear only for the current branch or for every tracked local branch?
