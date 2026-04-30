#!/usr/bin/env bash
# 验收测试运行脚本 - 供 openspec-scheduler test_cmd 使用
# 只运行本变更新增的 tests/spec/ 验收测试，不干扰其他测试。
set -euo pipefail
cd "$(dirname "$0")/../../.."
node --test \
  tests/spec/test_workflow_session_index_recovery.js \
  tests/spec/test_project_workflow_control_plane_index_recovery.js
