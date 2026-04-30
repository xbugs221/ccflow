#!/bin/bash
# 验收测试运行脚本 — 供 openspec-scheduler test_cmd 使用
# 只运行 tests/spec/ 下的 workflow-stage-provider 验收测试，不干扰其他测试
set -e
cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config=playwright.spec.config.js tests/spec/workflow-stage-provider.spec.js --reporter=line
