## 1. Contract and Tests

- [x] 1.1 Add runner state fixtures for running execution, review, repair, completed, failed, aborted, external run, missing paths, duplicate stage sessions, and corrupt state.
- [x] 1.2 Add server tests for `state.json -> ProjectWorkflow` read model mapping without invoking old workflow store code.
- [x] 1.3 Add tests proving `.ccflow/conf.json.workflows` is ignored for workflow list/detail, sorting, route generation, and child session routing.
- [x] 1.4 Add tests proving workflow creation/resume/abort only call `mc run/resume/abort --json`.
- [x] 1.5 Update e2e tests that still expect `/wN` so they assert `/runs/<runId>`.

## 2. Backend Boundary

- [x] 2.1 Extract a dedicated `mc-read-model` module from `server/workflows.js`.
- [x] 2.2 Make workflow list/detail build read models only from `.ccflow/runs/*/state.json`.
- [x] 2.3 Use stable `updatedAt` from runner state or state file mtime; remove workflow `routeIndex` sorting.
- [x] 2.4 Normalize artifact/log paths with semantic classification and existence diagnostics.
- [x] 2.5 Support child session addresses for `<stage>`, `<stage>/<role>`, and `by-id/<sessionId>`.
- [x] 2.6 Add workflow diagnostics fields for state path, mtime, raw status, contract version, and mapping warnings.
- [x] 2.7 Ensure corrupt state files do not prevent other valid runs from rendering.

## 3. Remove Legacy Runner Residue

- [x] 3.1 Delete or fully detach old planning/review/repair/archive prompt launcher helpers.
- [x] 3.2 Remove `workflowAutoStart`, `autoPrompt`, and `workflow-autostart:*` paths from automatic workflow execution.
- [x] 3.3 Remove workflow-owned draft session creation that exists only to launch old Node/TS stages.
- [x] 3.4 Remove `.ccflow/conf.json.workflows` write/compact/controller-event persistence paths.
- [x] 3.5 Remove workflow favorite/pending/hidden/rename fields from read model and UI logic unless they are only ignored legacy input.
- [x] 3.6 Remove dead functions after call sites are gone.

## 4. Frontend Read Model and Routes

- [x] 4.1 Tighten `ProjectWorkflow` and related types to the mc-backed read model fields.
- [x] 4.2 Keep manual session `cN` route support, but remove workflow `wN/routeIndex` assumptions.
- [x] 4.3 Update workflow list default sorting to use stable `updatedAt` and title fallback.
- [x] 4.4 Update workflow detail to show typed artifacts/logs and diagnostics.
- [x] 4.5 Update child session navigation to use the backend-provided child session address.
- [x] 4.6 Ensure frontend never parses raw runner stdout or raw `state.json`.

## 5. Documentation and Validation

- [x] 5.1 Update README runner boundary section.
- [x] 5.2 Update specs for Go runner integration, workflow control plane, and route addressing.
- [x] 5.3 Run `pnpm run test:server`.
- [x] 5.4 Run `pnpm run test:spec`.
- [x] 5.5 Run focused Playwright tests for workflow creation, workflow detail, child session route, artifact/log jump, and diagnostics rendering.
- [x] 5.6 Manually verify a real project with existing `.ccflow/runs/*/state.json` renders without `.ccflow/conf.json.workflows`.
