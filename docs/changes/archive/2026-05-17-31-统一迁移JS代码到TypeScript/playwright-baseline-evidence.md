# Playwright Baseline Comparison Evidence — Change 31

## Run Information

- **Baseline commit**: `39cb50a3e35810df2c5be457c4309b518d241afe`
- **HEAD**: current working tree (post TS migration, fix-4)
- **Command**: `pnpm exec playwright test --config=playwright.spec.config.ts --reporter=line`
- **Baseline result**: 194 passed, 1 skipped, 18 failed (10.2m)
- **HEAD result**: 194 passed, 1 skipped, 18 failed (10.2m)

## Actual Baseline Run Output

The full baseline test output is archived at `playwright-baseline-output.txt`.

### Baseline (39cb50a3) Failed Tests

| # | File:line | Test Title |
|---|-----------|-----------|
|  1 | `workspace-scroll-and-pane-controls.test.ts:86:1` | chat transcript scrolls while composer stays visible with docks open |
|  2 | `workspace-scroll-and-pane-controls.test.ts:97:1` | project overview center scrolls without moving workspace tabs |
|  3 | `workspace-scroll-and-pane-controls.test.ts:124:1` | dock pane controls are in the pane header and collapse uses top tabs |
|  4 | `opencode-settings-status.test.ts:34:1` | settings shows OpenCode providers and API metadata from service PATH fake CLI |
|  5 | `opencode-settings-status.test.ts:52:1` | settings shows provider read failure without reporting CLI disconnected |
|  6 | `chat-history-full-text-search.spec.ts:551:1` | JSONL thread search opens a workflow child session when the runner owns the thread |
|  7 | `chat-history-search-production-routing.spec.ts:42:1` | returns fixture chat matches for an authenticated chat search request |
|  8 | `chat-message-submission-idempotency.spec.ts:64:1` | submitting an attachment message twice during a slow upload still creates one user message |
|  9 | `chat-message-submission-idempotency.spec.ts:107:1` | one touch-originated send with an attachment is not replayed by the follow-up mouse event |
| 10 | `chat-message-submission-idempotency.spec.ts:143:1` | a failed attachment upload keeps the draft and attachment until the user explicitly retries |
| 11 | `chat-tool-structured-rendering.spec.ts:68:1` | 会将 update_plan、ctx_batch_execute、write_stdin 和 FileChanges 渲染为结构化内容 |
| 12 | `co-browser-reconnect.spec.ts:314:1` | running co conversation continues after page reload |
| 13 | `co-browser-reconnect.spec.ts:332:1` | two browser windows share one co conversation without duplicate submit or wrong abort |
| 14 | `project-workflow-control-plane-routing.spec.ts:27:3` | 工作流详情展示固定角色行，工作流会话不展示流程图预览 |
| 15 | `project-workflow-control-plane.spec.ts:354:3` | 打开规划会话会直接进入已有 planning 子会话 |
| 16 | `project-workflow-control-plane.spec.ts:436:3` | 2030 工作流详情页显示固定角色行，工作流子会话页不显示流程图预览 |
| 17 | `project-workflow-control-plane.spec.ts:768:3` | 项目主页的工作流和会话右键菜单支持收藏、待处理、隐藏及恢复 |
| 18 | `project-workspace-navigation.spec.ts:52:3` | 工作流详情用 wo 行进入 runner 子会话且不展示进程卡片 |

### HEAD (post-migration) Failed Tests

| # | File:line | Test Title | Δ Line |
|---|-----------|-----------|--------|
|  1 | `workspace-scroll-and-pane-controls.test.ts:87:1` | (same) | +1 |
|  2 | `workspace-scroll-and-pane-controls.test.ts:98:1` | (same) | +1 |
|  3 | `workspace-scroll-and-pane-controls.test.ts:125:1` | (same) | +1 |
|  4 | `opencode-settings-status.test.ts:35:1` | (same) | +1 |
|  5 | `opencode-settings-status.test.ts:53:1` | (same) | +1 |
|  6 | `chat-history-full-text-search.spec.ts:552:1` | (same) | +1 |
|  7 | `chat-history-search-production-routing.spec.ts:42:1` | (same) | 0 |
|  8 | `chat-message-submission-idempotency.spec.ts:65:1` | (same) | +1 |
|  9 | `chat-message-submission-idempotency.spec.ts:108:1` | (same) | +1 |
| 10 | `chat-message-submission-idempotency.spec.ts:144:1` | (same) | +1 |
| 11 | `chat-tool-structured-rendering.spec.ts:69:1` | (same) | +1 |
| 12 | `co-browser-reconnect.spec.ts:315:1` | (same) | +1 |
| 13 | `co-browser-reconnect.spec.ts:333:1` | (same) | +1 |
| 14 | `project-workflow-control-plane-routing.spec.ts:27:3` | (same) | 0 |
| 15 | `project-workflow-control-plane.spec.ts:355:3` | (same) | +1 |
| 16 | `project-workflow-control-plane.spec.ts:437:3` | (same) | +1 |
| 17 | `project-workflow-control-plane.spec.ts:769:3` | (same) | +1 |
| 18 | `project-workspace-navigation.spec.ts:52:3` | (same) | 0 |

## Comparison Analysis

1. **Identical failure count**: Both baseline and HEAD have exactly 18 failed, 1 skipped, 194 passed.
2. **Identical test titles**: All 18 failing test names match exactly between baseline and HEAD.
3. **Line number difference explained**: Where `@ts-nocheck` was added (+1 line at file top), line numbers shifted +1. Files with no `@ts-nocheck` addition (import path changes only) have unchanged line numbers.
4. **Git diff confirms no test logic changes**: `git diff 39cb50a3 HEAD -- <each failing file>` shows only:
   - Added `// @ts-nocheck` comments
   - Import path adjustments (`.js` → `.ts`, `../helpers/...` → `../../spec/helpers/...`)

## Reproducibility

```bash
# Reproduce baseline:
git worktree add /tmp/baseline 39cb50a3e35810df2c5be457c4309b518d241afe
cd /tmp/baseline
pnpm install --frozen-lockfile && pnpm run build
pnpm exec playwright test --config=playwright.spec.config.ts --reporter=line
# Result: 18 failed, 1 skipped, 194 passed (same failures as HEAD)

# Clean up:
git worktree remove /tmp/baseline
```

The raw baseline output is archived at `playwright-baseline-output.txt` in this change directory.

## Exit Conditions

These 18 Playwright failures are pre-existing and not introduced by the JS→TS migration:
1. Same 18 failures on baseline (39cb50a3) and HEAD, same test titles, same count
2. All file changes are mechanical (comments / import extensions), no test logic modified
3. All non-Playwright tests pass (165 server + 49 spec:node + 18 contract)
4. Compiled CLI, dev server, and bin entry all execute correctly

These should be addressed in a dedicated Playwright test stability improvement change.
