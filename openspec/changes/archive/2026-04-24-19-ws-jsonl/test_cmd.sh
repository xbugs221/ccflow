#!/bin/bash
# 验收测试运行脚本 - 供 openspec-scheduler test_cmd 使用。
# 只运行 19-ws-jsonl 对应的 tests/spec 验收测试，不干扰其他测试。
set -e
cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-message-rendering.spec.js
