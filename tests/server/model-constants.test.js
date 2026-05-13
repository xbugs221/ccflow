/**
 * PURPOSE: Verify shared model catalogs expose provider-compatible model choices.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CODEX_MODELS } from '../../shared/modelConstants.js';

test('model constants no longer export Claude provider entry', async () => {
  const mod = await import('../../shared/modelConstants.js');
  assert.equal('CLAUDE_MODELS' in mod, false, 'CLAUDE_MODELS must not be exported');
});

test('Codex defaults are discovered from the CLI instead of static constants', () => {
  /**
   * Native Codex models vary by installed CLI/account, so constants stay empty.
   */
  assert.equal(CODEX_MODELS.DEFAULT, '');
  assert.deepEqual(CODEX_MODELS.OPTIONS, []);
});
