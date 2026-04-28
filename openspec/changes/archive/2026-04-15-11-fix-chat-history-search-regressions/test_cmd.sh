#!/bin/bash
# PURPOSE: Run OpenSpec acceptance tests for chat history search regressions only.
set -euo pipefail

cd "$(dirname "$0")/../../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-search-regressions.spec.js
