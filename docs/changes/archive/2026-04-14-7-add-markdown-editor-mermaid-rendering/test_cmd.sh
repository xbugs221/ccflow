#!/bin/bash
# PURPOSE: Run only the acceptance tests for markdown editor Mermaid rendering.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/markdown-editor-mermaid-rendering.spec.js
