#!/bin/bash
# PURPOSE: Run only the acceptance tests for chat file links opening in editor.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-file-links-open-in-editor.spec.js
