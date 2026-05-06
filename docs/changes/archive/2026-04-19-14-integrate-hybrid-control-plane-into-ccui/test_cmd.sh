#!/bin/bash
# PURPOSE: Run only the OpenSpec acceptance tests for 2028-integrate-hybrid-control-plane-into-ccflow.
set -euo pipefail

cd "$(dirname "$0")/../../.."
pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js
