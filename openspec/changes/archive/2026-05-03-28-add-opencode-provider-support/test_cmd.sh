#!/usr/bin/env bash
# Acceptance test runner for change 28 — OpenCode provider scaffolding.
# Scope: type / constant / UI scaffolding only. Backend SDK, REST routes,
# session discovery, WebSocket, and workflow integration are explicit
# non-goals and live in subsequent changes (see proposal.md / design.md).
set -euo pipefail
cd "$(dirname "$0")/../../.."

node --test tests/spec/opencode-provider-integration.spec.js
