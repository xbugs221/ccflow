#!/bin/bash
# PURPOSE: 运行 2-simplify-project-workflow-routing 的验收测试。
set -euo pipefail

cd "$(dirname "$0")/../.."/..
pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-route-addressing.spec.js
