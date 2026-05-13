/**
 * PURPOSE: Dedicated Playwright configuration for OpenSpec acceptance tests in tests/spec.
 * Reuses the main e2e fixture/bootstrap pipeline while scoping execution to spec-derived tests.
 */
import baseConfig from './playwright.config.js';

process.env.CCFLOW_FAKE_RUNNER = process.env.CCFLOW_FAKE_RUNNER || '1';
process.env.CCFLOW_FAKE_RUNNER_DELAY_MS = process.env.CCFLOW_FAKE_RUNNER_DELAY_MS || '8000';
process.env.CODEX_INDEX_CACHE_TTL_MS = '0';

export default {
  ...baseConfig,
  testDir: './tests',
  testMatch: [
    'spec/**/*.spec.js',
    '2026-05-10-6-精简设置页和侧边栏导航-settings-sidebar-simplification.test.js',
    '2026-05-10-7-重新设计交互布局-workspace-dock-layout.test.js',
    '2026-05-10-8-修正dock拉伸方向和源代码管理布局漂移-workspace-dock-regression.test.js',
    '2026-05-10-9-修复工作区滚动和dock面板控制-workspace-scroll-and-pane-controls.test.js',
    '2026-05-10-10-修复桌面dock工作区宽度收缩-workspace-dock-width-regression.test.js',
    '2026-05-10-12-区分移动端单视图和精简会话标题-12-main-content-title-resume-id.test.js',
    '2026-05-10-12-区分移动端单视图和精简会话标题-12-mobile-single-view-workspace.test.js',
    '2026-05-11-13-前端多选启动wo并支持新规划-workflow-action-dialog.spec.js',
    '2026-05-11-14-修复前端tab选中和终端细节-workspace-regression.test.js',
    '2026-05-11-16-修正OpenCode设置页状态误报-opencode-settings-status.test.js',
    '2026-05-11-17-修复移动端会话视图和更新dock预期-mobile-session-view-regression.test.js',
    '2026-05-13-20-优化工作流卡片和详情链接呈现-workflow-presentation.test.js',
  ],
};
