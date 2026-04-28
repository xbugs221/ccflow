#!/bin/bash
# PURPOSE: 运行 2030-ccflow-ui 变更的 OpenSpec 验收测试。
set -euo pipefail

cd "$(dirname "$0")/../../.."

pnpm exec playwright test --config playwright.spec.config.js \
  tests/spec/project-workspace-navigation.spec.js \
  tests/spec/project-workflow-control-plane-routing.spec.js
