/**
 * PURPOSE: Guard against empty update_plan tool results hiding the input plan content.
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
 * Encode the absolute project path the same way Claude stores project folders.
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
});

test('update_plan 在空 result 时仍然展示 input 里的计划步骤', async ({ page }) => {
  /** Scenario: 真实运行中 tool_result 可能只返回空对象，输入侧的计划仍然必须可见。 */
  const sessionId = 'fixture-update-plan-empty-result';

  await writeClaudeSession({
    sessionId,
    entries: buildClaudeTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-20T09:10:01.000Z',
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call-plan-empty-result',
                name: 'update_plan',
                input: {
                  explanation: '先确认问题，再改渲染逻辑。',
                  plan: [
                    { step: '确认空白来源', status: 'completed' },
                    { step: '修正回退策略', status: 'in_progress' },
                  ],
                },
              },
            ],
          },
        },
        {
          timestamp: '2026-04-20T09:10:02.000Z',
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call-plan-empty-result',
                content: {},
                is_error: false,
              },
            ],
          },
        },
      ],
    }),
  });

  await page.goto(`/session/${sessionId}`, { waitUntil: 'networkidle' });

  await expect(page.getByTestId('tool-plan-content')).toContainText('先确认问题，再改渲染逻辑。');
  await expect(page.getByTestId('tool-plan-step-0')).toContainText('确认空白来源');
  await expect(page.getByTestId('tool-plan-step-1')).toContainText('修正回退策略');
  await expect(page.getByTestId('tool-plan-step-1')).toContainText('进行中');
});
