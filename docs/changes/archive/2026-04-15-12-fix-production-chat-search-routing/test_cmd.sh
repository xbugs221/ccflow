#!/bin/bash
# PURPOSE: Run OpenSpec acceptance tests for production chat-search routing only.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-search-production-routing.spec.js
