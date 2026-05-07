/**
 * PURPOSE: Build an isolated HOME fixture for Playwright end-to-end runs.
 * The fixture keeps e2e independent from the developer's real Claude/Codex history,
 * auth database, and long-running local CCUI instances.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const FIXTURE_ROOT = path.join(process.cwd(), '.tmp', 'playwright-home');
const AUTH_DB_PATH = path.join(FIXTURE_ROOT, '.ccflow', 'auth.db');
const INIT_SQL_PATH = path.join(process.cwd(), 'server', 'database', 'init.sql');
const PROJECT_CONF_PATH = path.join(FIXTURE_ROOT, 'workspace', 'fixture-project', '.ccflow', 'conf.json');

const FIXTURE_PROJECTS = [
  {
    label: 'fixture-project',
    path: path.join(FIXTURE_ROOT, 'workspace', 'fixture-project'),
    sessionId: 'fixture-project-session',
    userMessage: 'fixture-project session',
  },
  {
    label: 'alpha',
    path: path.join(FIXTURE_ROOT, 'workspace', 'alpha'),
    sessionId: 'fixture-alpha-session',
    userMessage: 'alpha fixture session',
  },
  {
    label: '.fixture-project',
    path: path.join(FIXTURE_ROOT, 'workspace', '.fixture-project'),
    sessionId: 'fixture-dot-project-session',
    userMessage: 'dot fixture-project session',
  },
  {
    label: 'matx',
    path: path.join(FIXTURE_ROOT, 'workspace', 'matx'),
    sessionId: 'fixture-matx-parent-session',
    userMessage: 'matx parent fixture session',
  },
  {
    label: 'matx-worktree',
    path: path.join(FIXTURE_ROOT, 'workspace', 'matx', '.worktrees', 'refactor-relocate-tests-out-of-src'),
    sessionId: 'fixture-matx-worktree-session',
    userMessage: 'matx worktree fixture session',
  },
  {
    label: 'history-scroll',
    path: path.join(FIXTURE_ROOT, 'workspace', 'history-scroll'),
    sessionId: 'fixture-history-scroll-session',
    userMessage: 'history scroll fixture session',
    messagePairs: 80,
  },
  {
    label: 'zeta',
    path: path.join(FIXTURE_ROOT, 'workspace', 'zeta'),
    sessionId: 'fixture-zeta-session',
    userMessage: 'zeta fixture session',
  },
];

const FIXTURE_PROJECT_EXTRA_SESSIONS = [
  {
    projectLabel: 'fixture-project',
    sessionId: 'fixture-project-manual-session',
    userMessage: 'fixture-project manual-only session',
    baseTimestamp: '2026-04-19T11:30:00.000Z',
  },
  {
    projectLabel: 'fixture-project',
    sessionId: 'fixture-project-execution-session',
    userMessage: 'fixture-project execution fixture session',
    baseTimestamp: '2026-04-18T09:00:00.000Z',
  },
];

/**
 * Encode an absolute project path the same way Claude stores project folders.
 * @param {string} projectPath - Absolute project path.
 * @returns {string} Encoded Claude project directory name.
 */
function encodeClaudeProjectName(projectPath) {
  return projectPath.replace(/\//g, '-');
}

/**
 * Write a minimal Claude session JSONL file that project discovery can parse quickly.
 * @param {string} projectPath - Absolute project path.
 * @param {string} sessionId - Synthetic session ID.
 * @param {string} userMessage - Session summary source text.
 * @param {number} messagePairs - Number of user/assistant turns to write.
 * @param {boolean} isActive - Whether to stamp the fixture as recently active.
 * @param {string | null} baseTimestamp - Optional fixed ISO timestamp for deterministic ordering.
 */
function writeClaudeSessionFixture(projectPath, sessionId, userMessage, messagePairs = 1, isActive = false, baseTimestamp = null) {
  const projectDir = path.join(FIXTURE_ROOT, '.claude', 'projects', encodeClaudeProjectName(projectPath));
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);
  const sessionLines = [];

  fs.mkdirSync(projectDir, { recursive: true });

  for (let index = 0; index < messagePairs; index += 1) {
    const pairNumber = index + 1;
    const baseTimeMs = baseTimestamp ? new Date(baseTimestamp).getTime() : null;
    const timestamp = Number.isFinite(baseTimeMs)
      ? new Date(baseTimeMs - index * 60 * 1000).toISOString()
      : isActive
        ? new Date(Date.now() - index * 60 * 1000).toISOString()
        : new Date(Date.UTC(2026, 2, 28, 16, 10 + index, 0)).toISOString();
    const userContent = index === 0
      ? userMessage
      : `${userMessage} history turn ${String(pairNumber).padStart(2, '0')}`;

    sessionLines.push(JSON.stringify({
      sessionId,
      cwd: projectPath,
      timestamp,
      parentUuid: null,
      uuid: `${sessionId}-user-${pairNumber}`,
      type: 'user',
      message: {
        role: 'user',
        content: userContent,
      },
    }));

    sessionLines.push(JSON.stringify({
      sessionId,
      cwd: projectPath,
      timestamp: new Date(new Date(timestamp).getTime() + 1000).toISOString(),
      type: 'assistant',
      message: {
        role: 'assistant',
        content: `${userMessage} assistant turn ${String(pairNumber).padStart(2, '0')}`,
      },
    }));
  }

  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, `${sessionLines.join('\n')}\n`, 'utf8');
}

/**
 * Create an auth database with one active user for local token generation.
 */
function writeAuthDatabaseFixture() {
  fs.mkdirSync(path.dirname(AUTH_DB_PATH), { recursive: true });
  const db = new Database(AUTH_DB_PATH);

  try {
    db.exec(fs.readFileSync(INIT_SQL_PATH, 'utf8'));
    db.prepare(
      `
        INSERT OR IGNORE INTO users (
          username,
          password_hash,
          is_active,
          has_completed_onboarding
        ) VALUES (?, ?, 1, 1)
      `,
    ).run('playwright-user', 'playwright-password-hash');
  } finally {
    db.close();
  }
}

/**
 * Persist one project-local workflow fixture used by project-workflow acceptance tests.
 */
function writeWorkflowStoreFixture() {
  fs.mkdirSync(path.dirname(PROJECT_CONF_PATH), { recursive: true });
  const fixtureProjectPath = FIXTURE_PROJECTS.find((project) => project.label === 'fixture-project')?.path;
  if (!fixtureProjectPath) {
    return;
  }

  fs.mkdirSync(path.join(fixtureProjectPath, 'workflow-output'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, 'data'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, 'images'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, '.ccflow', 'runs', 'run-fixture', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(fixtureProjectPath, 'notes', 'todo.md'), '# TODO\n', 'utf8');
  fs.writeFileSync(
    path.join(fixtureProjectPath, 'notes', 'boundary.md'),
    `${'a'.repeat(8191)}中\n\n# 边界标题\n\n这是一段中文正文。\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(fixtureProjectPath, 'assets', 'manual.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]));
  fs.writeFileSync(path.join(fixtureProjectPath, 'assets', 'archive.bin'), Buffer.from([0x10, 0x00, 0xff, 0x7f, 0x42, 0x24]));
  fs.writeFileSync(path.join(fixtureProjectPath, 'data', 'weird.dat'), Buffer.from([0x48, 0x49, 0x00, 0x41, 0x42, 0x43]));
  fs.writeFileSync(path.join(fixtureProjectPath, 'images', 'pixel.png'), Buffer.from('iVBORw0KGgo=', 'base64'));
  fs.writeFileSync(path.join(fixtureProjectPath, 'SUMMARY.md'), '# Workflow summary fixture\n', 'utf8');
  fs.writeFileSync(path.join(fixtureProjectPath, 'workflow-output', 'result.txt'), 'workflow artifact folder fixture\n', 'utf8');
  fs.writeFileSync(path.join(fixtureProjectPath, '.ccflow', 'runs', 'run-fixture', 'logs', 'executor.log'), 'executor log fixture\n', 'utf8');
  fs.writeFileSync(path.join(fixtureProjectPath, '.ccflow', 'runs', 'run-fixture', 'state.json'), `${JSON.stringify({
    runId: 'run-fixture',
    changeName: '登录升级',
    status: 'running',
    stage: 'review_1',
    stages: {
      planning: 'completed',
      execution: 'completed',
      review_1: 'running',
    },
    paths: {
      executor_log: '.ccflow/runs/run-fixture/logs/executor.log',
      summary: 'SUMMARY.md',
      workflow_output: 'workflow-output',
    },
    sessions: {
      planning: 'fixture-project-session',
      execution: 'fixture-project-execution-session',
    },
    processes: [
      {
        stage: 'planning',
        role: 'executor',
        status: 'completed',
        sessionId: 'fixture-project-session',
      },
      {
        stage: 'execution',
        role: 'executor',
        status: 'completed',
        sessionId: 'fixture-project-execution-session',
        pid: 4321,
        logPath: '.ccflow/runs/run-fixture/logs/executor.log',
      },
    ],
  }, null, 2)}\n`, 'utf8');

  fs.writeFileSync(
    PROJECT_CONF_PATH,
    `${JSON.stringify({
      schemaVersion: 2,
    }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Prepare the isolated Playwright fixture tree.
 * @param {{ preserveAuthDatabase?: boolean }} [options]
 * @returns {{ homeDir: string, authDbPath: string, projectPaths: string[] }} Fixture metadata.
 */
export function ensurePlaywrightFixture(options = {}) {
  /**
   * Auth DB can already be open by the Playwright process or web server. Preserve
   * it during per-test fixture resets so sqlite never writes to an unlinked file.
   */
  if (options.preserveAuthDatabase === true) {
    fs.rmSync(path.join(FIXTURE_ROOT, 'workspace'), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    fs.rmSync(path.join(FIXTURE_ROOT, '.claude'), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    fs.rmSync(path.join(FIXTURE_ROOT, '.codex'), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } else {
    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

  for (const project of FIXTURE_PROJECTS) {
    fs.mkdirSync(project.path, { recursive: true });
    writeClaudeSessionFixture(
      project.path,
      project.sessionId,
      project.userMessage,
      project.messagePairs || 1,
      project.label === 'fixture-project',
      project.label === 'fixture-project' ? '2026-04-19T10:00:00.000Z' : null,
    );
  }

  for (const extraSession of FIXTURE_PROJECT_EXTRA_SESSIONS) {
    const project = FIXTURE_PROJECTS.find((entry) => entry.label === extraSession.projectLabel);
    if (!project) {
      continue;
    }
    writeClaudeSessionFixture(
      project.path,
      extraSession.sessionId,
      extraSession.userMessage,
      1,
      false,
      extraSession.baseTimestamp,
    );
  }

  if (options.preserveAuthDatabase !== true) {
    writeAuthDatabaseFixture();
  }
  writeWorkflowStoreFixture();

  return {
    homeDir: FIXTURE_ROOT,
    authDbPath: AUTH_DB_PATH,
    projectPaths: FIXTURE_PROJECTS.map((project) => project.path),
  };
}

export const PLAYWRIGHT_FIXTURE_HOME = FIXTURE_ROOT;
export const PLAYWRIGHT_FIXTURE_AUTH_DB = AUTH_DB_PATH;
export const PLAYWRIGHT_FIXTURE_PROJECT_PATHS = FIXTURE_PROJECTS.map((project) => project.path);
export const PLAYWRIGHT_FIXTURE_SESSION_IDS = FIXTURE_PROJECTS.map((project) => project.sessionId);
