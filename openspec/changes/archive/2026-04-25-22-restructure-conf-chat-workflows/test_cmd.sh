#!/bin/bash
# 验收测试运行脚本：只运行本变更对应的 tests/spec/ 验收测试。
set -e
cd "$(git rev-parse --show-toplevel)"
node --test \
  tests/spec/test_project_chat_config_v2.js \
  tests/spec/test_project_workflow_control_plane_conf_v2.js \
  tests/spec/test_codex_project_discovery_conf_v2.js
