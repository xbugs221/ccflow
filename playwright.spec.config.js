/**
 * PURPOSE: Dedicated Playwright configuration for OpenSpec acceptance tests in tests/spec.
 * Reuses the main e2e fixture/bootstrap pipeline while scoping execution to spec-derived tests.
 */
import baseConfig from './playwright.config.js';

process.env.CCFLOW_FAKE_RUNNER = process.env.CCFLOW_FAKE_RUNNER || '1';
process.env.CCFLOW_FAKE_RUNNER_DELAY_MS = process.env.CCFLOW_FAKE_RUNNER_DELAY_MS || '8000';

export default {
  ...baseConfig,
  testDir: './tests',
  testMatch: [
    'spec/**/*.spec.js',
    '2026-05-10-6-精简设置页和侧边栏导航-settings-sidebar-simplification.test.js',
    '2026-05-10-7-重新设计交互布局-workspace-dock-layout.test.js',
    '2026-05-10-2026-05-10-8-修正dock拉伸方向和源代码管理布局漂移-workspace-dock-regression.test.js',
  ],
};
