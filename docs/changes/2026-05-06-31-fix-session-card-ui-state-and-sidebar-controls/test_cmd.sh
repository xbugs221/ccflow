#!/bin/sh
set -eu

pnpm run typecheck
pnpm exec playwright test --config=playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js
