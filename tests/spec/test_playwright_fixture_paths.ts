import { describe, it } from 'node:test';
import { ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

describe('playwright-fixture-runtime-paths', () => {
  it('wo-runtime-paths 模块可导入且 resolveWoRunsRoot 返回 XDG 路径', async () => {
    const {
      resolveWoRunsRoot,
      resolveWoRunStatePath,
    } = await import('../../server/domains/workflows/wo-runtime-paths.ts');

    const projectPath = '/tmp/test-project';
    const fakedEnv = { XDG_STATE_HOME: '/tmp/xdg-state' };

    const runsRoot = resolveWoRunsRoot(projectPath, fakedEnv);
    ok(runsRoot.startsWith('/tmp/xdg-state/wo/'), 'runs root 应在 XDG_STATE_HOME/wo 下');

    const statePath = resolveWoRunStatePath(projectPath, 'run-42', fakedEnv);
    ok(
      statePath.endsWith('/runs/run-42/state.json'),
      `statePath 应以 /runs/run-42/state.json 结尾，实际为 ${statePath}`,
    );
  });

  it('resolveWoRepoKey 对同一路径返回一致结果', async () => {
    const { resolveWoRepoKey } = await import(
      '../../server/domains/workflows/wo-runtime-paths.ts'
    );

    const key1 = resolveWoRepoKey('/home/user/my-project');
    const key2 = resolveWoRepoKey('/home/user/my-project');
    ok(key1 === key2);
  });

  it('playwright fixture 使用 resolveWoRunStatePath 而非项目内 .wo 路径', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'tests/e2e/helpers/playwright-fixture.ts'),
      'utf8',
    );

    ok(
      content.includes('resolveWoRunStatePath'),
      'playwright-fixture.ts 应导入并使用 resolveWoRunStatePath',
    );

    ok(
      !content.includes("'.wo/runs'"),
      'playwright-fixture.ts 不应硬编码 .wo/runs 路径',
    );
    ok(
      !content.includes("'.cbw/runs'"),
      'playwright-fixture.ts 不应硬编码 .cbw/runs 路径',
    );
  });

  it('workflow kickoff e2e 测试使用 XDG runsRoot', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'tests/e2e/workflow-kickoff-with-openspec.spec.ts'),
      'utf8',
    );

    ok(
      content.includes('resolveWoRunsRoot'),
      'workflow kickoff e2e 测试应导入 resolveWoRunsRoot',
    );
    ok(
      !content.includes("'.wo', 'runs'"),
      'workflow kickoff e2e 测试不应拼接 .wo/runs 路径',
    );
  });
});
