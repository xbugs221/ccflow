#!/bin/bash
# PURPOSE: Run only the acceptance tests for the chat-history-full-text-search change.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-full-text-search.spec.js
