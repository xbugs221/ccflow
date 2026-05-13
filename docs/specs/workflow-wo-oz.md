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
- All `repair_N` / `fix_N` stages are aggregated into a single repair icon showing `xN` (e.g. `x1`).
- Single-stage icons (planning, execution, archive) keep their original appearance.
- Aggregated icon color follows active/failed priority: if any summed stage is `active`, `running`, `blocked`, or `failed`, the aggregated icon shows the active color, never completed color.

### Render wo 0.9 fixed role rows as the primary workflow view

Workflow detail pages show `workflowRoleSummary.rows` as the main progress surface, matching `wo status -w1` semantics.

- Fixed role rows are `规` (planning), `写` (executor), `审` (reviewer), and `存` (archiver).
- Completion counts use digit notation `xN` (e.g. `x3`) instead of repeated `✓` marks.
- `写` count includes `execution` and any `fix_N` / `repair_N` stages.
- `审` count includes all `review_N` stages.
- `存` count includes `archive` stages.
- `规` shows `未知` when no planning session is present; no invalid link is generated.
- Each row links to its matched workflow child session, with the visible link text as `会话` (not the raw session ID).
- Each row shows a link to the current-round artifact (e.g. `review-2.json`) after the session link, choosing the latest review/repair/fix stage file.
- When the current-round artifact does not exist or `exists = false`, no artifact link is rendered.
- `workflowDisplay.lines` remains as a compatibility fallback when `workflowRoleSummary` is absent.
- `stage=done` and `status=done` are terminal metadata, not workflow display rows.

### Support arbitrary happened review and repair rounds

Workflow read models support every `review_N` and `repair_N` stage that appears in the wo user-state `state.json`.

- Dynamic stage ordering is `execution`, then alternating `review_1`, `repair_1`, `review_2`, `repair_2`, and so on for all happened rounds, followed by `archive`.
- Legal multi-round stages such as `review_4` or `repair_4` must not produce unknown-stage diagnostics.
- `archive` is ordered after every happened review/repair loop.

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
