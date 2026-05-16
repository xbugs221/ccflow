/**
 * PURPOSE: Verify cbw resolves wo user-state runtime paths with the same
 * repository isolation rules used by the external runner.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import test from 'node:test';

import {
  formatWoStatePathForDiagnostics,
  resolveWoRepoKey,
  resolveWoRunsRoot,
  resolveWoStateRoot,
  sanitizeWoRepoBasename,
} from '../../server/domains/workflows/wo-runtime-paths.js';

/**
 * Compute the expected repo key independently from the production helper.
 */
function expectedRepoKey(projectPath) {
  const absolutePath = path.resolve(projectPath);
  const prefix = path.basename(absolutePath).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
  const hash = crypto.createHash('sha1').update(absolutePath).digest('hex').slice(0, 10);
  return `${prefix}-${hash}`;
}

test('wo runtime paths isolate repositories with the same basename', () => {
  const left = path.join('/tmp', 'left', 'same-name');
  const right = path.join('/tmp', 'right', 'same-name');

  assert.equal(resolveWoRepoKey(left), expectedRepoKey(left));
  assert.equal(resolveWoRepoKey(right), expectedRepoKey(right));
  assert.notEqual(resolveWoRepoKey(left), resolveWoRepoKey(right));
});

test('wo runtime paths sanitize special repository basenames', () => {
  const projectPath = path.join('/tmp', 'My Repo__测试!!');

  assert.equal(sanitizeWoRepoBasename(projectPath), 'my-repo');
  assert.match(resolveWoRepoKey(projectPath), /^my-repo-[0-9a-f]{10}$/);
});

test('wo runtime paths use XDG_STATE_HOME for runs root and diagnostics', () => {
  const env = { XDG_STATE_HOME: path.join('/tmp', 'cbw-state') };
  const projectPath = path.join('/tmp', 'project');
  const repoKey = expectedRepoKey(projectPath);
  const runsRoot = resolveWoRunsRoot(projectPath, env);
  const statePath = path.join(runsRoot, 'run-a', 'state.json');

  assert.equal(resolveWoStateRoot(env), path.join(env.XDG_STATE_HOME, 'wo'));
  assert.equal(runsRoot, path.join(env.XDG_STATE_HOME, 'wo', 'repos', repoKey, 'runs'));
  assert.equal(
    formatWoStatePathForDiagnostics(statePath, env),
    path.posix.join('${XDG_STATE_HOME:-~/.local/state}', 'wo', 'repos', repoKey, 'runs', 'run-a', 'state.json'),
  );
});
