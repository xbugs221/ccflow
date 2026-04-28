/**
 * PURPOSE: Verify shared model catalogs expose provider-compatible model choices.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CLAUDE_MODELS, CODEX_MODELS } from '../../shared/modelConstants.js';

test('Claude defaults stay native without provider-specific hardcoded model ids', () => {
  /**
   * Provider-specific model IDs must come from live model-list APIs.
   */
  const modelValues = CLAUDE_MODELS.OPTIONS.map((option) => option.value);

  assert.equal(CLAUDE_MODELS.DEFAULT, '');
  assert.deepEqual(modelValues, []);
  assert.equal(modelValues.some((value) => value.toLowerCase().includes('kimi')), false);
  assert.equal(new Set(modelValues).size, modelValues.length);
});

test('Codex defaults are discovered from the CLI instead of static constants', () => {
  /**
   * Native Codex models vary by installed CLI/account, so constants stay empty.
   */
  assert.equal(CODEX_MODELS.DEFAULT, '');
  assert.deepEqual(CODEX_MODELS.OPTIONS, []);
});
