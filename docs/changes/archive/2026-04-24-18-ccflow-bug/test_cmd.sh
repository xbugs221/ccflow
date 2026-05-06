#!/usr/bin/env bash
# PURPOSE: 运行 18-ccflow-bug 变更的验收测试。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-child-session-isolation.spec.js
