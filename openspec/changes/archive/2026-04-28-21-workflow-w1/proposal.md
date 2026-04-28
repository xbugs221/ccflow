# Change: Refactor and simplify repository structure

## Why

The repository has accumulated mixed package-manager state, tracked workflow artifacts, large multi-responsibility modules, and uneven source layout. This makes installs less reproducible, increases review cost, and makes it harder for multiple developers to work in parallel without touching the same files.

## What

- Standardize package management on pnpm, including scripts, package metadata, lockfile policy, and reproducible install guidance.
- Remove generated workflow and verification artifacts from git tracking, and ensure future generated files are ignored.
- Reorganize source folders around clear business domains and runtime boundaries instead of flat component and server buckets.
- Extract shared utilities and business helpers from high-risk large files so route handlers, UI components, hooks, and runtime adapters have narrower responsibilities.
- Preserve existing behavior while improving maintainability through focused tests and verification commands.

## Impact

Primary impact areas are package metadata, repository ignore rules, frontend feature folders, server routing/service modules, shared utilities, and tests that protect chat, project, workflow, git, and task flows.

## Non-goals

- No new user-facing product behavior.
- No production hotfix or remote deployment.
- No rewrite of the frontend framework, server framework, or database layer.
- No deletion of source capabilities without replacement tests or explicit dead-code evidence.
