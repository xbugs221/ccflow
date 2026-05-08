# wo / oz workflow contract

## Requirements

### Use wo and oz as the only workflow commands

ccflow uses `oz` to discover and manage change artifacts, and `wo` to run sealed workflow automation.

- Active changes are discovered with `oz list --json`.
- Starting a workflow runs `wo run --change <change> --json` and reads `run_id`.
- Resuming a workflow runs `wo resume --run-id <run-id> --json`.
- Aborting a workflow runs `wo abort --run-id <run-id> --json`.
- Runtime dependency diagnostics require `oz` and `wo`; old `ox` and `mc` commands are not fallback paths.

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

### Link matched jsonl session labels

Display-line jsonl labels are resolved against workflow child sessions.

- A matched label such as `codex-exec-thread.jsonl` is rendered as a link to the workflow child-session route.
- Matching is exact against the session id with or without the `.jsonl` suffix.
- If a jsonl label cannot be matched, the label remains visible as ordinary text and diagnostics include a warning.

### Cover the migrated business workflow in tests

Tests cover the new command contract and browser behavior.

- Fake PATH tests provide only `oz` and `wo` and verify old `mc` / `ox` commands are not required.
- Fake `wo run --json` writes `.wo/runs/<run-id>/state.json`, and ccflow binds the returned `run_id`.
- Read-model tests cover happened display lines and unmatched jsonl warnings.
- Browser/e2e tests verify wo display lines are visible and jsonl session links navigate to workflow child sessions.
