#!/usr/bin/env bash
# 验收测试运行脚本 - 供 openspec-scheduler test_cmd 使用。
# 只运行本变更在 tests/spec/ 下的验收测试，不运行其他测试。
set -euo pipefail
cd "$(dirname "$0")/../../.."
node --test tests/spec/test_session_management_refactor.js
