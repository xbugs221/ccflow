#!/bin/sh
set -eu

pnpm run typecheck
pnpm run test:spec:node
pnpm exec playwright test --config=playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js --grep "左侧项目内导航不提供排序和新建控件|项目主页的工作流和会话右键菜单支持收藏"
