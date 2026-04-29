/**
 * PURPOSE: Business tests for project-home session card read receipts.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  getSessionActivitySignature,
  getSessionProjectName,
  getViewedSessionKey,
  hasUnreadSessionActivity,
} from '../../src/components/main-content/view/subcomponents/sessionActivityState.js';

test('historical project-home sessions are read on first visit until activity changes', () => {
  /**
   * A missing localStorage signature means the sidebar has not recorded a newer
   * activity signature yet, so the project home must not light every old card.
   */
  const session = {
    id: 'c1',
    __provider: 'codex',
    messageCount: 2,
    updatedAt: '2026-04-29T01:00:00.000Z',
  };
  const signature = getSessionActivitySignature(session);

  assert.equal(
    hasUnreadSessionActivity({
      isSelected: false,
      viewedSignature: null,
      activitySignature: signature,
    }),
    false,
  );
  assert.equal(
    hasUnreadSessionActivity({
      isSelected: false,
      viewedSignature: '1:2026-04-29T00:00:00.000Z',
      activitySignature: signature,
    }),
    true,
  );
});

test('cross-project session cards use the source project key when clearing unread state', () => {
  /**
   * Worktree and cross-project sessions carry __projectName; read receipts must
   * use that same key for rendering and click clearing.
   */
  const homeProjectName = 'main-project';
  const session = {
    id: 'c2',
    __provider: 'claude',
    __projectName: 'worktree-project',
    messageCount: 4,
    updatedAt: '2026-04-29T02:00:00.000Z',
  };

  const sourceProjectName = getSessionProjectName(homeProjectName, session);
  const renderKey = getViewedSessionKey(sourceProjectName, session);
  const clickClearKey = getViewedSessionKey(getSessionProjectName(homeProjectName, session), session);

  assert.equal(sourceProjectName, 'worktree-project');
  assert.equal(clickClearKey, renderKey);
  assert.notEqual(renderKey, getViewedSessionKey(homeProjectName, session));
});

test('project-home session cards are wired to production activity rendering', async () => {
  /**
   * Guard the business path: the project overview card must use the activity
   * helpers directly, not leave them as isolated acceptance-test utilities.
   */
  const overviewSource = await readFile(
    new URL('../../src/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx', import.meta.url),
    'utf8',
  );
  const actionMenuSource = await readFile(
    new URL('../../src/components/session-actions/SessionActionIconMenu.tsx', import.meta.url),
    'utf8',
  );

  assert.match(overviewSource, /formatTimeAgo\(sessionView\.sessionTime,\s*currentTime,\s*t\)/);
  assert.match(overviewSource, /hasUnreadSessionActivity\(/);
  assert.match(overviewSource, /writeViewedSessionSignature\(sessionKey,\s*activitySignature\)/);
  assert.match(overviewSource, /<SessionActionIconMenu/);
  assert.match(actionMenuSource, /<span>\{labels\.rename\}<\/span>/);
  assert.match(actionMenuSource, /<span>\{favoriteLabel\}<\/span>/);
  assert.match(actionMenuSource, /<span>\{labels\.delete\}<\/span>/);
});

test('project-home and sidebar cards expose business sort choices without changing route numbers', async () => {
  /**
   * Sorting must be a card-display concern. The visible #cN/#wN route numbers
   * remain sourced from routeIndex while users can sort by update time, title,
   * or provider.
   */
  const overviewSource = await readFile(
    new URL('../../src/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx', import.meta.url),
    'utf8',
  );
  const sidebarSessionsSource = await readFile(
    new URL('../../src/components/sidebar/view/subcomponents/SidebarProjectSessions.tsx', import.meta.url),
    'utf8',
  );
  const sidebarWorkflowsSource = await readFile(
    new URL('../../src/components/sidebar/view/subcomponents/SidebarProjectWorkflows.tsx', import.meta.url),
    'utf8',
  );

  assert.match(overviewSource, /value: 'updated', label: '最近消息'/);
  assert.match(overviewSource, /value: 'title', label: '标题'/);
  assert.match(overviewSource, /value: 'provider', label: 'Provider'/);
  assert.match(overviewSource, /compareSessionsByCardSortMode\(sessionA, sessionB, sessionSortMode, t\)/);
  assert.match(sidebarSessionsSource, /aria-label="手动会话排序"/);
  assert.match(sidebarWorkflowsSource, /aria-label="工作流排序"/);
});
