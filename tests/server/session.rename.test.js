/**
 * PURPOSE: Verify Claude session rename persistence behavior for sidebar rename flows.
 * The tests append summary records to real JSONL session files and confirm refreshed reads use the new title.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addProjectManually,
  clearProjectDirectoryCache,
  createManualSessionDraft,
  bindManualSessionDraftProviderSession,
  deleteCodexSession,
  deleteSession,
  finalizeManualSessionDraft,
  getManualSessionDraftRuntime,
  getCodexSessions,
  getSessions,
  loadProjectConfig,
  renameCodexSession,
  renameSession,
  saveProjectConfig,
  startManualSessionDraft,
} from '../../server/projects.js';
import {
  createProjectWorkflow,
  listProjectWorkflows,
  registerWorkflowChildSession,
} from '../../server/workflows.js';
let homeIsolationQueue = Promise.resolve();

/**
 * Execute each test case under an isolated HOME directory.
 */
async function withTemporaryHome(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-session-rename-test-'));
    const binDir = path.join(tempHome, 'bin');

    process.env.HOME = tempHome;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    clearProjectDirectoryCache();
    try {
      await writeFakeWorkflowTools(binDir);
      await testBody(tempHome);
    } finally {
      clearProjectDirectoryCache();
      process.env.PATH = originalPath || '';
      if (originalHome) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }

      await fs.rm(tempHome, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Write fake opsx/mc commands so workflow child-session tests exercise the
 * current Go-backed contract without requiring machine-global binaries.
 */
async function writeFakeWorkflowTools(binDir) {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'opsx'),
    [
      '#!/bin/sh',
      'changes_dir="$PWD/docs/changes"',
      'case "$1" in',
      '  --version) echo "opsx-session-test";;',
      '  list)',
      "    printf '{\"changes\":['",
      '    first=1',
      '    if [ -d "$changes_dir" ]; then',
      '      for entry in "$changes_dir"/*; do',
      '        [ -d "$entry" ] || continue',
      '        [ "$(basename "$entry")" = "archive" ] && continue',
      '        if [ "$first" -eq 0 ]; then printf ","; fi',
      '        first=0',
      "        printf '{\"name\":\"%s\"}' \"$(basename \"$entry\")\"",
      '      done',
      '    fi',
      "    printf ']}\\n';;",
      '  status) if [ -d "$changes_dir/$2" ]; then printf \'{"name":"%s","status":"active"}\\n\' "$2"; else exit 1; fi;;',
      '  *) echo \'{}\';;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(binDir, 'mc'),
    [
      '#!/bin/sh',
      'run_id="session-test-run-$(date +%s%N)"',
      'if [ "$1" = "--version" ]; then echo "mc-session-test"; exit 0; fi',
      'if [ "$1" = "list-changes" ]; then opsx list --json; exit 0; fi',
      'if [ "$1" = "run" ]; then',
      '  change=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--change" ]; then shift; change="$1"; fi',
      '    shift || break',
      '  done',
      '  run_dir="$PWD/.ccflow/runs/$run_id"',
      '  mkdir -p "$run_dir/logs"',
      '  echo "session workflow log" > "$run_dir/logs/executor.log"',
      '  cat > "$run_dir/state.json" <<JSON',
      '{"runId":"$run_id","changeName":"$change","status":"running","stage":"execution","stages":{"execution":"running"},"paths":{"executor_log":".ccflow/runs/$run_id/logs/executor.log"},"sessions":{},"error":""}',
      'JSON',
      '  printf \'{"runId":"%s","changeName":"%s","status":"running","stage":"execution"}\\n\' "$run_id" "$change"',
      '  exit 0',
      'fi',
      'echo "usage: mc run resume status abort --json --run-id --change"',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/**
 * Create one active docs/ change before constructing a Go-backed workflow.
 */
async function createGoWorkflow(project, payload = {}) {
  const changeName = `go-${String(payload.title || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'}`;
  const changeRoot = path.join(project.fullPath || project.path, 'docs', 'changes', changeName);
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });
  await fs.writeFile(path.join(changeRoot, 'proposal.md'), '# proposal\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'design.md'), '# design\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [ ] session workflow setup\n', 'utf8');
  return createProjectWorkflow(project, {
    ...payload,
    openspecChangeName: changeName,
  });
}

/**
 * Create a minimal Claude session JSONL file that the parser can list and rename.
 */
async function createClaudeSessionFile(projectName, sessionId, message = 'original session prompt', cwd = '/tmp/workspace') {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        sessionId,
        type: 'user',
        timestamp: '2026-03-06T08:00:00.000Z',
        cwd,
        message: { role: 'user', content: message },
        parentUuid: null,
        uuid: 'user-1',
      }),
      JSON.stringify({
        sessionId,
        type: 'assistant',
        timestamp: '2026-03-06T08:00:05.000Z',
        cwd,
        message: { role: 'assistant', content: 'assistant reply' },
        parentUuid: 'user-1',
        uuid: 'assistant-1',
      }),
    ].join('\n') + '\n',
    'utf8',
  );

  return sessionPath;
}

/**
 * Create a minimal Codex session JSONL file that project discovery can index.
 */
async function createCodexSessionFile(homeDir, projectPath, sessionId, options = {}) {
  /**
   * PURPOSE: Allow tests to model creation time separately from latest activity.
   */
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '03', '06');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const startedAt = options.startedAt || '2026-03-06T08:00:00.000Z';
  const messageAt = options.messageAt || '2026-03-06T08:00:01.000Z';
  const finalAt = options.finalAt || null;
  const message = options.message || '真实 Codex workflow 会话';

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: startedAt,
        payload: { id: sessionId, cwd: projectPath, model: 'gpt-5.4' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: messageAt,
        payload: { type: 'user_message', message },
      }),
      finalAt
        ? JSON.stringify({
          type: 'event_msg',
          timestamp: finalAt,
          payload: { type: 'agent_message', message: 'assistant follow-up' },
        })
        : null,
    ].filter(Boolean).join('\n') + '\n',
    'utf8',
  );

  return sessionPath;
}

/**
 * Create a Claude session fixture with custom user prompts for summary tests.
 */
async function createClaudeSessionFixture(projectName, sessionId, userPrompts) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);

  await fs.mkdir(projectDir, { recursive: true });
  const lines = userPrompts.map((prompt, index) => JSON.stringify({
    sessionId,
    type: 'user',
    timestamp: `2026-03-06T08:00:0${index}.000Z`,
    cwd: '/tmp/workspace',
    message: { role: 'user', content: prompt },
    parentUuid: index === 0 ? null : `user-${index}`,
    uuid: `user-${index + 1}`,
  }));
  await fs.writeFile(sessionPath, `${lines.join('\n')}\n`, 'utf8');

  return sessionPath;
}

test('Claude session rename persists via appended summary records', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-demo');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Demo');
    const sessionPath = await createClaudeSessionFile(project.name, 'session-1');

    await renameSession(project.name, 'session-1', 'Renamed Session');

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions.length, 1);
    assert.equal(sessionsResult.sessions[0].summary, 'Renamed Session');

    const persistedContent = await fs.readFile(sessionPath, 'utf8');
    assert.match(persistedContent, /"type":"summary"/);
    assert.match(persistedContent, /"summary":"Renamed Session"/);
  });
});

test('Codex session rename persists project-local conf title', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-rename-title');
    await fs.mkdir(projectPath, { recursive: true });

    await addProjectManually(projectPath, 'Codex Rename Title Demo');
    await createCodexSessionFile(tempHome, projectPath, 'codex-rename-real');
    const config = await loadProjectConfig(projectPath);
    config.chat = {
      1: {
        sessionId: 'codex-rename-real',
        title: '旧 Codex 标题',
        ui: {},
      },
    };
    await saveProjectConfig(config, projectPath);

    await renameCodexSession('codex-rename-real', '新 Codex 标题', projectPath);

    const nextConfig = await loadProjectConfig(projectPath);
    assert.equal(nextConfig.chat[1].title, '新 Codex 标题');
  });
});

test('Claude session rename rejects blank summaries', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-demo-empty');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Demo Empty');
    await createClaudeSessionFile(project.name, 'session-blank');

    await assert.rejects(
      () => renameSession(project.name, 'session-blank', '   '),
      /Session summary is required/,
    );
  });
});

test('Claude session summary ignores bootstrap ping and uses the first real prompt', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-demo-bootstrap');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Demo Bootstrap');
    await createClaudeSessionFixture(project.name, 'session-bootstrap', ['ping', '真正的业务问题']);

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions.length, 1);
    assert.equal(sessionsResult.sessions[0].summary, '真正的业务问题');
  });
});

test('Claude session rename updates display summary without changing filename', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-demo-rename-file');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Demo Rename File');
    const sessionPath = await createClaudeSessionFile(project.name, 'session-stable-file');

    await renameSession(project.name, 'session-stable-file', '新的会话名称');

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions[0].summary, '新的会话名称');
    await assert.doesNotReject(fs.access(sessionPath));
    assert.equal(path.basename(sessionPath), 'session-stable-file.jsonl');
  });
});

test('manual Claude draft sessions are visible before the first provider message', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-manual-draft');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Draft Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'claude', '会话1');

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions.length, 1);
    assert.equal(sessionsResult.sessions[0].id, draftSession.id);
    assert.equal(sessionsResult.sessions[0].summary, '会话1');
    assert.equal(sessionsResult.sessions[0].status, 'draft');
  });
});

test('manual Codex draft sessions are visible before the first provider message', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-manual-draft');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Draft Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话2');

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, draftSession.id);
    assert.equal(sessions[0].summary, '会话2');
    assert.equal(sessions[0].status, 'draft');
  });
});

test('rebuilt Codex route numbers follow creation time instead of latest activity', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-route-rebuild');
    await fs.mkdir(projectPath, { recursive: true });

    await addProjectManually(projectPath, 'Codex Route Rebuild');
    await createCodexSessionFile(tempHome, projectPath, 'older-updated-later', {
      startedAt: '2026-03-06T08:00:00.000Z',
      messageAt: '2026-03-06T08:01:00.000Z',
      finalAt: '2026-03-06T10:00:00.000Z',
      message: 'older session updated later',
    });
    await createCodexSessionFile(tempHome, projectPath, 'newer-updated-earlier', {
      startedAt: '2026-03-06T09:00:00.000Z',
      messageAt: '2026-03-06T09:05:00.000Z',
      message: 'newer session updated earlier',
    });

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const olderSession = sessions.find((session) => session.id === 'older-updated-later');
    const newerSession = sessions.find((session) => session.id === 'newer-updated-earlier');
    assert.equal(olderSession?.routeIndex, 1);
    assert.equal(newerSession?.routeIndex, 2);

    const config = await loadProjectConfig(projectPath);
    assert.equal(config.chat?.['1']?.sessionId, 'older-updated-later');
    assert.equal(config.chat?.['2']?.sessionId, 'newer-updated-earlier');
  });
});

test('manual Codex route hides the bound provider session after first message', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-manual-bound');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Bound Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话3');
    await createCodexSessionFile(tempHome, projectPath, 'codex-real-session');
    await startManualSessionDraft(project.name, projectPath, draftSession.id, 'codex', 'req-1');
    await bindManualSessionDraftProviderSession(
      project.name,
      projectPath,
      draftSession.id,
      'codex-real-session',
      'req-1',
    );

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, draftSession.id);
    assert.equal(sessions[0].providerSessionId, 'codex-real-session');
  });
});

test('manual draft start request cannot be overwritten by another tab', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'manual-start-request-lock');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Manual Start Lock Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话锁');

    assert.deepEqual(
      await startManualSessionDraft(project.name, projectPath, draftSession.id, 'codex', 'req-1'),
      {
        started: true,
        record: {
          sessionId: draftSession.id,
          title: '会话锁',
          provider: 'codex',
          startRequestId: 'req-1',
        },
      },
    );

    const secondStart = await startManualSessionDraft(project.name, projectPath, draftSession.id, 'codex', 'req-2');
    assert.equal(secondStart.started, false);
    assert.equal(secondStart.reason, 'already-started');
    assert.equal(secondStart.startRequestId, 'req-1');
  });
});

test('manual draft route indices stay unique across Claude and Codex providers in one project', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'mixed-provider-drafts');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Mixed Provider Draft Demo');
    const claudeDraft = await createManualSessionDraft(project.name, projectPath, 'claude', '会话1');
    const codexDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话2');

    assert.equal(claudeDraft.id, 'c1');
    assert.equal(claudeDraft.routeIndex, 1);
    assert.equal(codexDraft.id, 'c2');
    assert.equal(codexDraft.routeIndex, 2);

    const config = await loadProjectConfig(projectPath);
    assert.equal(config.chat['1'].sessionId, claudeDraft.id);
    assert.equal(config.chat['2'].sessionId, codexDraft.id);
  });
});

test('workflow-owned Codex drafts stay out of the standalone manual-session collection', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-workflow-draft');
    await fs.mkdir(projectPath, { recursive: true });

      const project = await addProjectManually(projectPath, 'Codex Workflow Draft Demo');
      await createManualSessionDraft(project.name, projectPath, 'codex', '规划提案：隐藏草稿', {
        workflowId: 'workflow-hidden-draft',
        stageKey: 'planning',
      });

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    assert.equal(sessions.length, 0);
  });
});

test('manual Codex draft numbering ignores workflow child sessions in project route bucket', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-workflow-route-bucket');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Workflow Route Demo');
    const firstManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createCodexSessionFile(tempHome, projectPath, 'codex-workflow-child-real');

    const config = await loadProjectConfig(projectPath);
    config.workflows = {
      1: {
        title: '工作流',
        chat: {
          1: {
            sessionId: 'codex-workflow-child-real',
            provider: 'codex',
            stageKey: 'execution',
          },
        },
      },
    };
    await saveProjectConfig(config, projectPath);

    const secondManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话2');
    const sessions = await getCodexSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });

    assert.equal(secondManualDraft.routeIndex, 2);
    assert.ok(sessions.some((session) => session.id === secondManualDraft.id));
    assert.equal(sessions.some((session) => session.id === 'codex-workflow-child-real'), false);
  });
});

test('manual Codex draft numbering skips terminal-created standalone route indices', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-terminal-route-bucket');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Terminal Route Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createCodexSessionFile(tempHome, projectPath, 'codex-terminal-real-18');
    await createCodexSessionFile(tempHome, projectPath, 'codex-terminal-real-19');

    const config = await loadProjectConfig(projectPath);
    config.chat = {
      ...(config.chat || {}),
      18: { sessionId: 'codex-terminal-real-18', provider: 'codex', title: '终端会话18' },
      19: { sessionId: 'codex-terminal-real-19', provider: 'codex', title: '终端会话19' },
    };
    await saveProjectConfig(config, projectPath);

    const nextManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话20');

    assert.equal(nextManualDraft.routeIndex, 20);
    assert.equal(nextManualDraft.id, 'c20');
  });
});

test('manual Codex draft numbering does not recycle after a manual draft is removed', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-manual-delete-counter');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Manual Delete Counter Demo');
    const firstManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    const secondManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话2');

    const config = await loadProjectConfig(projectPath);
    delete config.chat[String(firstManualDraft.routeIndex)];
    await saveProjectConfig(config, projectPath);

    const thirdManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话3');

    assert.equal(secondManualDraft.routeIndex, 2);
    assert.equal(thirdManualDraft.routeIndex, 3);
  });
});

test('deleting a Claude session removes its JSONL file', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-delete-real-file');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Delete Real File Demo');
    const sessionPath = await createClaudeSessionFile(project.name, 'claude-delete-real');

    await deleteSession(project.name, 'claude-delete-real');

    await assert.rejects(fs.access(sessionPath));
  });
});

test('deleting a Codex session removes its JSONL file', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-delete-real-file');
    await fs.mkdir(projectPath, { recursive: true });

    await addProjectManually(projectPath, 'Codex Delete Real File Demo');
    const sessionPath = await createCodexSessionFile(tempHome, projectPath, 'codex-delete-real');

    await deleteCodexSession('codex-delete-real');

    await assert.rejects(fs.access(sessionPath));
  });
});

test('deleting a stale Codex chat record removes the local route entry', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-delete-stale-chat');
    await fs.mkdir(projectPath, { recursive: true });

    await addProjectManually(projectPath, 'Codex Delete Stale Chat Demo');
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        77: {
          sessionId: 'c78b7c1c-5ec0-4722-981f-e7442264a3bc',
          title: 'Stale Codex Chat',
          provider: 'codex',
        },
      },
    }, projectPath);

    await deleteCodexSession('c78b7c1c-5ec0-4722-981f-e7442264a3bc', projectPath);

    const config = await loadProjectConfig(projectPath);
    assert.equal(config.chat, undefined);
  });
});

test('finalizing a manual Claude draft binds the label to the real backend session', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-manual-finalize');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Finalize Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'claude', '会话3');
    await createClaudeSessionFile(project.name, 'claude-session-real');

    const finalized = await finalizeManualSessionDraft(
      project.name,
      draftSession.id,
      'claude-session-real',
      'claude',
    );

    assert.equal(finalized, true);

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    const finalizedSession = sessionsResult.sessions.find((session) => session.id === 'claude-session-real');
    assert.equal(finalizedSession?.summary, '会话3');

    const config = await loadProjectConfig(projectPath);
    const finalizedChat = Object.values(config.chat || {}).find((record) => record.sessionId === 'claude-session-real');
    assert.equal(finalizedChat?.title, '会话3');
  });
});

test('finalizing a manual Codex draft keeps the original route slot', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-manual-finalize');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Finalize Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话4');
    await createCodexSessionFile(tempHome, projectPath, 'codex-session-real');

    const finalized = await finalizeManualSessionDraft(
      project.name,
      draftSession.id,
      'codex-session-real',
      'codex',
      projectPath,
    );

    assert.equal(finalized, true);

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const finalizedSession = sessions.find((session) => session.id === 'codex-session-real');
    assert.equal(finalizedSession?.summary, '会话4');
    assert.equal(finalizedSession?.routeIndex, draftSession.routeIndex);
    assert.equal(sessions.some((session) => session.id === draftSession.id), false);

    const config = await loadProjectConfig(projectPath);
    const finalizedChat = Object.values(config.chat || {}).find((record) => record.sessionId === 'codex-session-real');
    assert.equal(finalizedChat?.title, '会话4');
    assert.equal('manualSessionDrafts' in config, false);
  });
});

test('finalizing workflow-owned drafts preserves ownership on real provider sessions', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'workflow-finalize');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Workflow Finalize Demo');
      const claudeDraft = await createManualSessionDraft(project.name, projectPath, 'claude', '审核会话', {
        workflowId: 'workflow-review',
        stageKey: 'verification',
      });
    await createClaudeSessionFile(project.name, 'claude-workflow-real');

      const codexDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '执行会话', {
        workflowId: 'workflow-execution',
        stageKey: 'execution',
      });
    await createCodexSessionFile(tempHome, projectPath, 'codex-workflow-real');

    assert.equal(
      await finalizeManualSessionDraft(project.name, claudeDraft.id, 'claude-workflow-real', 'claude'),
      true,
    );
    assert.equal(
      await finalizeManualSessionDraft(project.name, codexDraft.id, 'codex-workflow-real', 'codex'),
      true,
    );

    const claudeSessions = await getSessions(project.name, 5, 0, { includeHidden: true });
      const claudeSession = claudeSessions.sessions.find((session) => session.id === 'claude-workflow-real');
      assert.equal(claudeSession.workflowId, 'workflow-review');
      assert.equal(claudeSession.stageKey, 'verification');

    const codexSessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
      const codexSession = codexSessions.find((session) => session.id === 'codex-workflow-real');
      assert.equal(codexSession.workflowId, 'workflow-execution');
      assert.equal(codexSession.stageKey, 'execution');
    });
});

test('finalizing a workflow child draft replaces the temporary child session id', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'workflow-child-finalize');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Workflow Child Finalize Demo');
    const workflow = await createGoWorkflow(project, {
      title: '重构精简仓库',
      objective: '验证工作流子会话 finalize 后仍稳定指向同一个内部会话槽位',
    });
      const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '规划提案：重构精简仓库', {
        workflowId: workflow.id,
        stageKey: 'planning',
      });
    await registerWorkflowChildSession(project, workflow.id, {
      sessionId: draftSession.id,
      title: '规划提案：重构精简仓库',
      summary: '规划提案：重构精简仓库',
        provider: 'codex',
        stageKey: 'planning',
      });

    const beforeFinalize = await listProjectWorkflows(projectPath);
    assert.equal(beforeFinalize[0].childSessions[0].id, draftSession.id);
    assert.equal(beforeFinalize[0].childSessions[0].routeIndex, 1);

    assert.equal(
      await finalizeManualSessionDraft(project.name, draftSession.id, 'codex-workflow-real', 'codex', projectPath),
      true,
    );

    const afterFinalize = await listProjectWorkflows(projectPath);
    assert.equal(afterFinalize[0].childSessions[0].id, 'codex-workflow-real');
    assert.equal(afterFinalize[0].childSessions[0].routeIndex, 1);
      assert.equal(afterFinalize[0].childSessions[0].workflowId, workflow.id);
      assert.equal(afterFinalize[0].childSessions[0].stageKey, 'planning');
    });
});

test('finalizing an indexed review draft preserves the existing review child route', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'workflow-review-finalize');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Workflow Review Finalize Demo');
    const workflow = await createGoWorkflow(project, {
      title: '重构精简仓库',
      objective: '验证初审 finalize 不会从 c3 漂移到 c4',
    });
    await registerWorkflowChildSession(project, workflow.id, {
      sessionId: 'planning-real',
        title: '规划提案：重构精简仓库',
        provider: 'codex',
        stageKey: 'planning',
      });
    await registerWorkflowChildSession(project, workflow.id, {
      sessionId: 'execution-real',
        title: '执行：重构精简仓库',
        provider: 'codex',
        stageKey: 'execution',
      });
      const reviewDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '评审1：重构精简仓库', {
        workflowId: workflow.id,
        stageKey: 'review_1',
      });
    await registerWorkflowChildSession(project, workflow.id, {
      sessionId: reviewDraft.id,
        title: '评审1：重构精简仓库',
        provider: 'codex',
        stageKey: 'review_1',
      });
  
      const beforeFinalize = await listProjectWorkflows(projectPath);
      const reviewBefore = beforeFinalize[0].childSessions.find((session) => session.stageKey === 'review_1');
    assert.equal(reviewBefore.id, reviewDraft.id);
    assert.equal(reviewBefore.routeIndex, 3);

    assert.equal(
      await finalizeManualSessionDraft(project.name, reviewDraft.id, 'review-real', 'codex', projectPath),
      true,
    );

      const afterFinalize = await listProjectWorkflows(projectPath);
      const reviewSessions = afterFinalize[0].childSessions.filter((session) => session.stageKey === 'review_1');
    assert.equal(reviewSessions.length, 1);
    assert.equal(reviewSessions[0].id, 'review-real');
    assert.equal(reviewSessions[0].routeIndex, 3);
  });
});

test('workflow chat draft finalizes without a manual draft mirror', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'workflow-chat-draft-finalize');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Workflow Chat Draft Finalize Demo');
    const workflow = await createGoWorkflow(project, {
      title: '清理技术债',
      objective: '验证 workflow 内部 cN 草稿能绑定真实 provider 会话',
    });
    await registerWorkflowChildSession(project, workflow.id, {
      sessionId: 'c1',
      title: '提案落地：清理技术债',
      provider: 'claude',
      stageKey: 'execution',
    });

    const startResult = await startManualSessionDraft(
      project.name,
      projectPath,
      'c1',
      'claude',
      'workflow-start-1',
    );
    assert.equal(startResult.started, true);
    assert.equal(
      await bindManualSessionDraftProviderSession(
        project.name,
        projectPath,
        'c1',
        'claude-workflow-real',
        'workflow-start-1',
      ),
      true,
    );

    const runtime = await getManualSessionDraftRuntime(project.name, projectPath, 'c1');
    assert.equal(runtime?.pendingProviderSessionId, 'claude-workflow-real');
    assert.equal(runtime?.startRequestId, 'workflow-start-1');

    assert.equal(
      await finalizeManualSessionDraft(project.name, 'c1', 'claude-workflow-real', 'claude', projectPath),
      true,
    );

    const workflows = await listProjectWorkflows(projectPath);
    const executionSession = workflows[0].childSessions.find((session) => session.stageKey === 'execution');
    assert.equal(executionSession?.id, 'claude-workflow-real');
    assert.equal(executionSession?.routeIndex, 1);
    assert.equal(executionSession?.workflowId, workflow.id);
  });
});

test('workflow orphan provider sessions stay out of manual session lists', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'workflow-orphan-filter');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Workflow Orphan Filter Demo');
    await createGoWorkflow(project, {
      title: '实现工作流调度加购',
      objective: '验证未索引的内部会话不会进入手动会话区',
    });

    await createClaudeSessionFile(
      project.name,
      'claude-workflow-orphan',
      '执行 OpenSpec 变更中的任务\n\n1. **选择变更**',
      projectPath,
    );
    await createCodexSessionFile(tempHome, projectPath, 'codex-workflow-orphan', {
      message: '评审2：实现工作流调度加购',
    });

    const claudeSessions = await getSessions(project.name, 10, 0, {
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    assert.equal(
      claudeSessions.sessions.some((session) => session.id === 'claude-workflow-orphan'),
      false,
    );

    const codexSessions = await getCodexSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    assert.equal(
      codexSessions.some((session) => session.id === 'codex-workflow-orphan'),
      false,
    );
  });
});

test('Claude session rename with projectPath writes conf to project-local config', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const externalProjectPath = path.join(tempHome, 'workspace', 'claude-demo-path');
    await fs.mkdir(externalProjectPath, { recursive: true });

    const project = await addProjectManually(externalProjectPath, 'Claude Demo Path');
    const sessionPath = await createClaudeSessionFile(project.name, 'session-with-path');

    await renameSession(project.name, 'session-with-path', '带路径的改名', externalProjectPath);

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions.length, 1);
    assert.equal(sessionsResult.sessions[0].summary, '带路径的改名');

    const persistedContent = await fs.readFile(sessionPath, 'utf8');
    assert.match(persistedContent, /"type":"summary"/);
    assert.match(persistedContent, /"summary":"带路径的改名"/);

    const projectLocalConfig = await loadProjectConfig(externalProjectPath);
    assert.equal(projectLocalConfig.chat?.['1']?.title, '带路径的改名');
  });
});
