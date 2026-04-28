#!/bin/bash
# PURPOSE: Run OpenSpec acceptance tests for binary-safe editor workflows only.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/binary-safe-editor-workflow.spec.js
