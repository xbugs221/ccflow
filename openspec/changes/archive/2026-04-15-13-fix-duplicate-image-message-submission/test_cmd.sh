#!/bin/bash
# PURPOSE: Run only the OpenSpec acceptance tests for duplicate image message submission.
set -e

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-message-submission-idempotency.spec.js
