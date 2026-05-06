#!/bin/bash
# PURPOSE: Run OpenSpec acceptance tests for workspace file-tree operations only.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/file-tree-operations.spec.js
