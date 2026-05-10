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

### Read only .wo run state

Workflow read models are built from `.wo/runs/<run-id>/state.json`.

- Old `.ccflow/runs` state is not listed as a workflow source.
- Runner JSON is treated as snake_case for run binding, including `run_id` and `change_name`.

### Render wo display lines as the primary workflow view

Workflow detail pages show `workflowDisplay.lines` as the main progress surface.

- Display text follows wo-visible wording such as `start`, `review`, `1 fix`, `1 fix review`, and `archive`.
- Only happened or active stages are shown; future repair, review, or archive placeholders are not generated.
- The old stage artifact tree is not rendered as the main workflow pipeline.
- Logs, processes, and diagnostics remain available as auxiliary sections.
- If `state.workflow_display.lines` exists, its marker, text, raw line, and stage key are the display authority; ccflow may only add matched session references.
- If `workflow_display.lines` is missing, fallback text must follow wo wording: `execution` as `start`, `review_1` as `review`, `repair_N` as `N fix`, `review_N` for `N > 1` as `(N - 1) fix review`, and `archive` as `archive`.
- `stage=done` and `status=done` are terminal metadata, not workflow display rows.

### Support arbitrary happened review and repair rounds

Workflow read models support every `review_N` and `repair_N` stage that appears in `.wo/runs/<run-id>/state.json`.

- Dynamic stage ordering is `execution`, then alternating `review_1`, `repair_1`, `review_2`, `repair_2`, and so on for all happened rounds, followed by `archive`.
- Legal multi-round stages such as `review_4` or `repair_4` must not produce unknown-stage diagnostics.
- `archive` is ordered after every happened review/repair loop.

### Link matched jsonl session labels

Display-line jsonl labels are resolved against workflow child sessions.

- A matched label such as `codex-exec-thread.jsonl` is rendered as a link to the workflow child-session route.
- Matching is exact against the session id with or without the `.jsonl` suffix.
- If a jsonl label cannot be matched, the label remains visible as ordinary text and diagnostics include a warning.

### Cover the migrated business workflow in tests

Tests cover the new command contract and browser behavior.

- Fake PATH tests provide only `oz` and `wo` and verify old `mc` / `ox` commands are not required.
- Runtime diagnostics tests provide fake `oz`, `wo`, and `co` only through PATH and verify resolved `command_path` values.
- Fake `wo run --json` writes `.wo/runs/<run-id>/state.json`, and ccflow binds the returned `run_id`.
- Read-model tests cover happened display lines, unmatched jsonl warnings, arbitrary review/repair rounds, `workflow_display.lines` precedence, and terminal `done` metadata.
- Browser/e2e tests verify wo display lines are visible, jsonl session links navigate to workflow child sessions, and project navigation does not show multiple indistinguishable `001` entries.

### Hide or disambiguate temporary 001 project leftovers

Project discovery must not expose obvious test leftovers as multiple indistinguishable sidebar projects.

- Empty `/tmp/Test.../001` projects with no Claude/Codex/OpenCode sessions, no `.wo/runs` workflows, and no explicit user-retention metadata are filtered from `/api/projects`.
- Temporary or duplicate-basename projects that have business data are retained but displayed with a distinguishing short path component, such as `001 - Test...`.
- Project selection, routing, and session loading continue to use `fullPath` and `routePath`, not `displayName`.
