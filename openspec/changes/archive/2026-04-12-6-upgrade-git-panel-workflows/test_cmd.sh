#!/bin/bash
# PURPOSE: Run OpenSpec acceptance tests for Git panel workflow upgrades only.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/git-panel-workflows.spec.js
