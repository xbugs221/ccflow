#!/bin/bash
# PURPOSE: Run OpenSpec acceptance tests for removing the project overview manual-session card limit.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js --grep "项目主页手动会话超过 5 个时仍展示全部已加载卡片"
