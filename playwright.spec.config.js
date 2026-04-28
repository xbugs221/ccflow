/**
 * PURPOSE: Dedicated Playwright configuration for OpenSpec acceptance tests in tests/spec.
 * Reuses the main e2e fixture/bootstrap pipeline while scoping execution to spec-derived tests.
 */
import baseConfig from './playwright.config.js';

export default {
  ...baseConfig,
  testDir: './tests/spec',
  testMatch: '**/*.spec.js',
};
