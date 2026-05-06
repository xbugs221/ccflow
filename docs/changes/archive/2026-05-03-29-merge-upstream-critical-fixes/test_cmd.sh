#!/usr/bin/env bash
# 验收测试运行脚本 - 供 openspec-scheduler test_cmd 使用
# 只运行本变更新增的 tests/spec/ 验收测试，不干扰其他测试。
set -euo pipefail
cd "$(dirname "$0")/../../.."

node --test tests/spec/upstream-critical-fixes.spec.js
