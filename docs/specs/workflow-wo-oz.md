# wo / oz workflow contract

## Requirements

### Use wo and oz as the only workflow commands

ccflow uses `oz` to discover and manage change artifacts, and `wo` to run sealed workflow automation.

- The `oz` and `wo` executables are resolved from the current web service `PATH`; source code must not depend on user-specific absolute paths.
- Active changes are discovered with `oz list --json`.
- Starting a workflow runs `wo run --change <change> --json` and reads `run_id`.
- Resuming a workflow runs `wo resume --run-id <run-id> --json`.
- Aborting a workflow runs `wo abort --run-id <run-id> --json`.
- Runtime dependency diagnostics require `oz` and `wo`; old `ox` and `mc` commands are not fallback paths.
- Runtime dependency diagnostics expose each resolved executable as `command_path`.
- `oz` availability is validated with `oz --version`.
- `wo` availability is validated with `wo contract --json` and the required workflow capabilities: `list-changes`, `run`, `resume`, `status`, and `abort`.
- Missing commands or failed contract/version checks report the command name, failed subcommand, stderr or parse summary, and the current service `PATH`.

### Read only wo user-state run state

Workflow read models are built only from `${XDG_STATE_HOME:-~/.local/state}/wo/repos/<repo-key>/runs/<run-id>/state.json`.

- The repo key is derived from the absolute project path so same-basename repositories do not share runtime state.
- Missing user-state runs roots produce an empty workflow list, not an error.
- Project-local `.wo/runs` state is not listed as a workflow source.
- Old `.ccflow/runs` state is not listed as a workflow source.
- Runner JSON is treated as snake_case for run binding, including `run_id` and `change_name`.
- Starting or resuming a workflow waits for the user-state `state.json` path and must not fall back to project-local `.wo/runs`.

### Aggregate multi-round stages in workflow cards

Project overview and sidebar workflow cards must not grow endless stage icons with more review/repair rounds.

- All `review_N` stages are aggregated into a single review icon showing `xN` (e.g. `x2`).
- All `repair_N` / `fix_N` stages are aggregated into a single fix icon showing `xN` (e.g. `x1`).
- Single-stage icons (planning, execution, archive, fixer) keep their original appearance.
- Aggregated icon color follows active/failed priority: if any summed stage is `active`, `running`, `blocked`, or `failed`, the aggregated icon shows the active color, never completed color.

### Render wo v1.0 five-role rows as the primary workflow view

Workflow detail pages show `workflowRoleSummary.rows` as the main progress surface, matching `wo status` semantics.

- Fixed role rows are `规` (planning), `写` (executor), `审` (reviewer), `修` (fixer), and `存` (archiver).
- Completion counts use digit notation `xN` (e.g. `x3`) instead of repeated `✓` marks.
- `写` count includes `execution` and any `fix_N` / `repair_N` stages.
- `审` count includes all `review_N` stages.
- `修` count includes all `fix_N` and `repair_N` stages.
- `存` count includes `archive` stages.
- `规` shows `工作流开始之前就已完成` when no planning session is present; no invalid link is generated. Regardless of session presence, when the workflow is bound to an oz change, the row also shows `proposal.md`, `design.md`, `spec.md`, and `task.md` document links pointing to the active or archived change directory.
- Each row links to its matched workflow child session, with the visible link text as `会话` (not the raw session ID).
- Each row shows a link to the current-round artifact (e.g. `review-2.json`) after the session link, choosing the latest review/repair/fix stage file.
- When the current-round artifact does not exist or `exists = false`, no artifact link is rendered.
- Session resolution must support provider prefixes (`codex:*`, `opencode:*`, `pi:*`); unknown or unsupported providers must not render broken links.
- `workflowDisplay.lines` remains as a compatibility fallback when `workflowRoleSummary` is absent.
- `stage=done` and `status=done` are terminal metadata, not workflow display rows.

### Support arbitrary happened review, repair, and fix rounds

Workflow read models support every `review_N`, `repair_N`, and `fix_N` stage that appears in the wo user-state `state.json`.

- Dynamic stage ordering is `execution`, then alternating `review_1`, `repair_1` (or `fix_1`), `review_2`, `repair_2` (or `fix_2`), and so on for all happened rounds, followed by `archive`.
- Legal multi-round stages such as `review_4`, `repair_4`, or `fix_4` must not produce unknown-stage diagnostics.
- `archive` is ordered after every happened review/repair/fix loop.
- `fix_N` and `repair_N` stages are both mapped to the `修` role row.

### Link matched jsonl session labels

Display-line jsonl labels are resolved against workflow child sessions.

- A matched label such as `codex-exec-thread.jsonl` is rendered as a link to the workflow child-session route.
- Matching is exact against the session id with or without the `.jsonl` suffix.
- If a jsonl label cannot be matched, the label remains visible as ordinary text and diagnostics include a warning.

### Start workflows through an action dialog

Project workflow startup is driven by an explicit workflow action dialog instead of a select-based form.

- The project overview and project workspace navigation both expose a `工作流操作` entry that opens the same dialog behavior.
- Adoptable active oz changes are displayed as selectable buttons or cards, not as the main-path `<select>` control.
- The dialog supports selecting one or more changes, selecting all changes, clearing selection, and showing the selected count.
- Starting selected changes calls the existing single-workflow creation API once per change with `openspecChangeName`; the backend continues to execute `wo run --change <name> --json`.
- Each selected change has its own launch state: waiting, starting, started, or failed.
- A single successful launch navigates directly to that workflow detail route; multiple launches remain on the result list and expose a detail link for each successful workflow.
- After launching, the project/workflow data and adoptable change list are refreshed so already-bound changes no longer appear as startable items.

### Open planning sessions without starting wo

Users can start a normal planning conversation before any oz change exists.

- The workflow action dialog provides `发起新的规划`.
- Planning creates an ordinary Codex manual session with an initial prompt that asks to discuss problem, scope, non-goals, and test strategy before creating an oz change.
- Planning does not call the workflow creation API, does not run `wo run`, and does not create wo run state.
- After the planning session creates a new active oz change, that change is discovered by the normal adoptable-change list and can be started through the same dialog.

### Display batch grouping and progress in workflow overview

Batch workflows group multiple runs under a single batch context with progress display.

- The read model reads `batches/<batchId>/state.json` from the wo user-state directory and derives batch metadata: `id`, `displayId` (e.g. `b1`), `status`, `currentIndex`, `total`, `runIds`, and `error`.
- Each child run carries `batchId`, `batchDisplayId`, `batchIndex`, `batchTotal`, and `batchStatus` so detail pages can show batch context.
- The frontend groups runs by batch; ungrouped runs appear in a "单独运行" (standalone) section.
- Batch header shows `批量任务 bN`, status, and `current/total` progress.
- Clicking the batch header expands or collapses child runs; it does not navigate to a separate batch detail page.
- Clicking a child run navigates to `/runs/<runId>` detail view.
- Progress display uses `displayCurrent = currentIndex + 1` for user-visible 1-based indexing.

### Show oz change planning documents in the 规 role row

When a workflow is bound to an oz change, the `规` role row must display links to the four core planning documents: `proposal.md`, `design.md`, `spec.md`, and `task.md`.

- Active changes resolve to `docs/changes/<change>/`.
- Archived changes resolve to `docs/changes/archive/<archived-change>/`, supporting both exact directory names and `-<change>` suffix patterns.
- When multiple archive candidate directories match the same change, the backend selects the directory with the latest `mtime`; older exact matches must not shadow newer date-prefixed directories.
- Clicking any document link opens the file in the existing file viewer.
- Missing documents carry `exists: false` so the frontend does not render a link to a broken path.
- Planning session absence must not prevent document links from being displayed.
- After a change is archived and the detail page is refreshed, document links must resolve to the archive directory rather than the stale active path.
- The `写`, `审`, `修`, `存` rows retain their existing compact single-artifact display.

### Discover fixed artifacts in run directories

In addition to artifacts declared in `state.paths`, the read model discovers fixed-name artifacts from the run directory.

- Scanned artifacts include `review-N.json`, `fix-N.json`, `repair-N.json`, and matching Markdown files such as `fix-N.md`.
- `review-N.*` artifacts belong to the `审` role; `fix-N.*` and `repair-N.*` artifacts belong to the `修` role.
- Artifact output uses controlled paths so the frontend can open file contents directly.
- Only the latest-round artifact per role is shown in the role summary; historical rounds are visible in the detail artifact area.
- Missing artifacts do not produce broken links.

### Filter workflow-owned sessions from manual session area

The "manual sessions" area only shows user-initiated chat sessions, not wo workflow child sessions.

- Backend provider session lists filter out sessions whose id appears in any workflow `childSessions`, `runnerProcesses.sessionId`, or the wo state `sessions` role map.
- Frontend manual session area retains `isWorkflowOwnedSession` as a fallback filter.
- Workflow sessions remain accessible from run detail pages via their provider session links.

### Keep batch view read-only

Frontend can display batch and run state but must not mutate it.

- Batch UI does not render skip, reorder, resume, retry, or abort operations.
- Frontend does not directly write to `batches/.../state.json` or `runs/.../state.json`.
- Any future batch intervention must go through stable wo commands with explicit confirmation.

### Cover the migrated business workflow in tests

Tests cover the new command contract and browser behavior.

- Fake PATH tests provide only `oz` and `wo` and verify old `mc` / `ox` commands are not required.
- Runtime diagnostics tests provide fake `oz`, `wo`, and `co` only through PATH and verify resolved `command_path` values.
- Fake `wo run --json` writes `${XDG_STATE_HOME:-~/.local/state}/wo/repos/<repo-key>/runs/<run-id>/state.json`, and ccflow binds the returned `run_id`.
- Read-model tests cover happened display lines, unmatched jsonl warnings, arbitrary review/repair rounds, `workflow_display.lines` precedence, and terminal `done` metadata.
- Browser/e2e tests verify wo display lines are visible, jsonl session links navigate to workflow child sessions, and project navigation does not show multiple indistinguishable `001` entries.
- Browser/e2e tests verify the workflow action dialog has no select in the main launch path, supports batch launching two active changes, preserves successful results when another launch fails, and starts a planning session without creating wo run state.

### Hide or disambiguate temporary 001 project leftovers

Project discovery must not expose obvious test leftovers as multiple indistinguishable sidebar projects.

- Empty `/tmp/Test.../001` projects with no Claude/Codex/OpenCode sessions, no wo user-state workflows, and no explicit user-retention metadata are filtered from `/api/projects`.
- Temporary or duplicate-basename projects that have business data are retained but displayed with a distinguishing short path component, such as `001 - Test...`.
- Project selection, routing, and session loading continue to use `fullPath` and `routePath`, not `displayName`.
