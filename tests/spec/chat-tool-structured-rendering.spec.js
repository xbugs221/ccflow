/**
 * PURPOSE: Acceptance tests for structured tool rendering of plans, batch execute results, and file changes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.js';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.js';

/**
 * Encode an absolute project path the same way Claude stores project folders.
 *
 * @param {string} projectPath
 * @returns {string}
 */
function encodeClaudeProjectName(projectPath) {
  return projectPath.replace(/\//g, '-');
}

/**
 * Write one Claude JSONL session file under the Playwright fixture HOME.
 *
 * @param {{ sessionId: string, entries: Array<Record<string, unknown>> }} params
 * @returns {Promise<void>}
 */
async function writeClaudeSession({ sessionId, entries }) {
  const projectDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.claude',
    'projects',
    encodeClaudeProjectName(PRIMARY_FIXTURE_PROJECT_PATH),
  );
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Build a minimal Claude transcript containing tool_use/tool_result pairs.
 *
 * @param {{ sessionId: string, records: Array<Record<string, unknown>> }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildClaudeTranscript({ sessionId, records }) {
  return records.map((record, index) => ({
    sessionId,
    cwd: PRIMARY_FIXTURE_PROJECT_PATH,
    parentUuid: index === 0 ? null : `${sessionId}-uuid-${index - 1}`,
    uuid: `${sessionId}-uuid-${index}`,
    ...record,
  }));
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'claude');
  });
});

test('会将 update_plan、ctx_batch_execute、write_stdin 和 FileChanges 渲染为结构化内容', async ({ page }) => {
  /** Scenario: 历史会话中的工具消息不再展示原始 JSON，计划步骤也要反映最新推进状态。 */
  const sessionId = 'fixture-structured-tool-rendering';

  await writeClaudeSession({
    sessionId,
    entries: buildClaudeTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-20T09:00:01.000Z',
          type: 'user',
          message: {
            role: 'user',
            content: '请把工作计划和命令执行结果展示清楚。',
          },
        },
        {
          timestamp: '2026-04-20T09:00:02.000Z',
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call-plan',
                name: 'update_plan',
                input: {
                  explanation: '先整理计划，再跑命令，最后检查文件变更。',
                  plan: [
                    { step: '整理工作计划', status: 'in_progress' },
                    { step: '执行批量查询', status: 'pending' },
                    { step: '检查文件变更', status: 'pending' },
                  ],
                },
              },
              {
                type: 'tool_use',
                id: 'call-batch',
                name: 'ctx_batch_execute',
                input: {
                  commands: [
                    { label: 'Source Tree', command: 'rg --files src/components/chat/tools' },
                    { label: 'Tool Configs', command: 'sed -n "1,120p" src/components/chat/tools/configs/toolConfigs.ts' },
                  ],
                  queries: ['update_plan renderer', 'filechanges parser success error'],
                },
              },
              {
                type: 'tool_use',
                id: 'call-ctx-exec',
                name: 'ctx_execute',
                input: {
                  language: 'shell',
                  code: 'git status --short',
                  intent: '检查工作区变更',
                  timeout: 5000,
                },
              },
              {
                type: 'tool_use',
                id: 'call-files',
                name: 'FileChanges',
                input: {
                  status: 'completed',
                  changes: [
                    { kind: 'added', path: 'src/components/chat/tools/components/ContentRenderers/PlanContent.tsx' },
                    { kind: 'modified', path: 'src/components/chat/tools/configs/toolConfigs.ts' },
                  ],
                },
              },
              {
                type: 'tool_use',
                id: 'call-stdin',
                name: 'functions.write_stdin',
                input: {
                  session_id: 68389,
                  chars: 'status\\n',
                },
              },
            ],
          },
        },
        {
          timestamp: '2026-04-20T09:00:03.000Z',
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call-plan',
                content: {
                  explanation: '先整理计划，再跑命令，最后检查文件变更。',
                  plan: [
                    { step: '整理工作计划', status: 'completed' },
                    { step: '执行批量查询', status: 'in_progress' },
                    { step: '检查文件变更', status: 'pending' },
                  ],
                },
                is_error: false,
              },
              {
                type: 'tool_result',
                tool_use_id: 'call-batch',
                content: [
                  {
                    type: 'text',
                    text: [
                      'Executed 2 commands (120 lines, 3.0KB). Indexed 4 sections. Searched 2 queries.',
                      '',
                      '## Indexed Sections',
                      '- ToolRenderer (2.0KB)',
                      '- toolConfigs (1.0KB)',
                      '',
                      '## Source Tree',
                      'Found files under tools.',
                      '',
                      '## update_plan renderer',
                      '### Source Tree',
                      'Plan renderer search hit.',
                      '',
                      '## filechanges parser success error',
                      '### Tool Configs',
                      'FileChanges parser search hit.',
                    ].join('\n'),
                  },
                ],
                is_error: false,
              },
              {
                type: 'tool_result',
                tool_use_id: 'call-ctx-exec',
                content: ' M src/components/chat/tools/configs/toolConfigs.ts',
                is_error: false,
              },
              {
                type: 'tool_result',
                tool_use_id: 'call-stdin',
                content: {
                  output: 'job-42: finished\\nnext poll ready',
                },
                is_error: false,
              },
            ],
          },
        },
        {
          timestamp: '2026-04-20T09:00:04.000Z',
          type: 'assistant',
          message: {
            role: 'assistant',
            content: '结构化渲染已经准备好。',
          },
        },
      ],
    }),
  });

  const params = new URLSearchParams({
    provider: 'claude',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
  });
  await page.goto(`/session/${sessionId}?${params.toString()}`, { waitUntil: 'networkidle' });

  await expect(page.getByTestId('tool-plan-content').first()).toContainText('先整理计划，再跑命令，最后检查文件变更。');
  await expect(page.getByTestId('tool-plan-step-0').first()).toContainText('整理工作计划');
  await expect(page.getByTestId('tool-plan-step-0').first()).toContainText('已完成');
  await expect(page.getByTestId('tool-plan-step-1').first()).toContainText('执行批量查询');
  await expect(page.getByTestId('tool-plan-step-1').first()).toContainText('进行中');
  await expect(page.getByTestId('tool-plan-content')).toHaveCount(1);

  await expect(page.getByTestId('tool-batch-execute-content').first()).toContainText('Source Tree');
  await expect(page.getByText('rg --files src/components/chat/tools')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show output' }).first()).toBeVisible();
  await expect(page.getByText('Found files under tools.')).toBeHidden();
  await expect(page.getByText('查询 2 条')).toHaveCount(0);
  await expect(page.getByText('update_plan renderer')).toBeVisible();
  await expect(page.getByText('filechanges parser success error')).toBeVisible();
  await expect(page.getByText('Plan renderer search hit.')).toBeHidden();
  await expect(page.getByText('FileChanges parser search hit.')).toBeHidden();
  await expect(page.getByTestId('tool-batch-command-card').nth(0)).toContainText('Source Tree');
  await expect(page.getByTestId('tool-batch-command-card').nth(0)).toContainText('update_plan renderer');
  await expect(page.getByTestId('tool-batch-command-card').nth(0)).not.toContainText('filechanges parser success error');
  await expect(page.getByTestId('tool-batch-command-card').nth(1)).toContainText('Tool Configs');
  await expect(page.getByTestId('tool-batch-command-card').nth(1)).toContainText('filechanges parser success error');
  await expect(page.getByTestId('tool-batch-command-card').nth(1)).not.toContainText('update_plan renderer');
  await expect(page.getByTestId('tool-batch-query-result')).toHaveCount(2);
  await expect(page.getByText('Executed 2 commands (120 lines, 3.0KB). Indexed 4 sections. Searched 2 queries.')).toBeHidden();
  await expect(page.getByText('git status --short')).toBeVisible();
  await expect(page.getByText('M src/components/chat/tools/configs/toolConfigs.ts')).toBeHidden();
  await expect(page.locator('text=\"code\": \"git status --short\"')).toHaveCount(0);
  await expect(page.getByTestId('tool-context-code-card')).toHaveCount(3);
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' })).toHaveAttribute('data-single-line', 'true');
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).locator('xpath=ancestor::details')).toHaveCount(0);
  await expect(page.getByTestId('tool-batch-execute-content').locator('xpath=ancestor::details')).toHaveCount(0);
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).locator('pre').first()).not.toHaveClass(/context-code-scrollbar-active/);
  await page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).click();
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).locator('pre').first()).toHaveClass(/context-code-scrollbar-active/);
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).locator('code').first()).toHaveCSS('white-space', 'pre');

  await expect(page.getByText('stdin -> session 68389')).toBeVisible();
  await expect(page.getByText('status\\n')).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: 'job-42: finished' }).first()).toContainText('next poll ready');

  await expect(page.getByTestId('tool-file-changes-content').first()).toContainText('completed');
  await expect(page.getByTestId('tool-file-changes-content').first()).toContainText('PlanContent.tsx');
  await expect(page.getByTestId('tool-file-changes-content').first()).toContainText('toolConfigs.ts');

  await expect(page.locator('text=\"plan\": [')).toHaveCount(0);
  await expect(page.locator('text=\"commands\": [')).toHaveCount(0);
  await expect(page.locator('text=\"session_id\": 68389')).toHaveCount(0);
  await expect(page.locator('text=\"chars\": \"status')).toHaveCount(0);
  await expect(page.locator('text=\"changes\": [')).toHaveCount(0);
});
