/**
 * PURPOSE: Dedicated Playwright configuration for OpenSpec acceptance tests in tests/spec.
 * Reuses the main e2e fixture/bootstrap pipeline while scoping execution to spec-derived tests.
 */
import baseConfig from './playwright.config.js';

process.env.CCFLOW_FAKE_RUNNER = process.env.CCFLOW_FAKE_RUNNER || '1';
process.env.CCFLOW_FAKE_RUNNER_DELAY_MS = process.env.CCFLOW_FAKE_RUNNER_DELAY_MS || '8000';

export default {
  ...baseConfig,
  testDir: './tests/spec',
  testMatch: '**/*.spec.js',
};
