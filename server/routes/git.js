/**
 * PURPOSE: Serve Git panel APIs with argument-safe Git execution and stable
 * response contracts for status, branches, diffs, and repository operations.
 */
import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import { extractProjectDirectory } from '../projects.js';
import { queryClaudeSDK } from '../claude-sdk.js';
import { queryCodex } from '../openai-codex.js';

const router = express.Router();

/**
 * Spawn a child process with shell disabled and collect its output.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import('child_process').SpawnOptionsWithoutStdio} [options]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(stderr.trim() || stdout.trim() || `Command failed: ${command}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      error.command = command;
      error.args = args;
      reject(error);
    });
  });
}

/**
 * Run a Git command in the target repository.
 *
 * @param {string} projectPath
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runGit(projectPath, args) {
  return spawnAsync('git', args, { cwd: projectPath });
}

/**
 * Convert Git porcelain status characters into the UI's coarse status buckets.
 *
 * @param {string} statusCode
 * @returns {'M' | 'A' | 'D' | 'U'}
 */
function mapStatusCode(statusCode) {
  if (statusCode === '?' || statusCode === 'U') {
    return 'U';
  }

  if (statusCode === 'A') {
    return 'A';
  }

  if (statusCode === 'D') {
    return 'D';
  }

  return 'M';
}

/**
 * Normalize Git porcelain output into the legacy flat groups plus staged and
 * unstaged sections needed by the new panel.
 *
 * @param {string} statusOutput
 * @returns {{
 *   modified: string[],
 *   added: string[],
 *   deleted: string[],
 *   untracked: string[],
 *   stagedChanges: Array<{ path: string, status: 'M' | 'A' | 'D' | 'U' }>,
 *   unstagedChanges: Array<{ path: string, status: 'M' | 'A' | 'D' | 'U' }>
 * }}
 */
function parsePorcelainStatus(statusOutput) {
  const parsed = {
    modified: [],
    added: [],
    deleted: [],
    untracked: [],
    stagedChanges: [],
    unstagedChanges: [],
  };
  const groupedPaths = {
    modified: new Set(),
    added: new Set(),
    deleted: new Set(),
    untracked: new Set(),
  };

  for (const line of statusOutput.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const rawPath = line.slice(3).trim();
    const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;

    if (!filePath) {
      continue;
    }

    if (indexStatus === '?' && worktreeStatus === '?') {
      parsed.unstagedChanges.push({ path: filePath, status: 'U' });
      if (!groupedPaths.untracked.has(filePath)) {
        groupedPaths.untracked.add(filePath);
        parsed.untracked.push(filePath);
      }
      continue;
    }

    if (indexStatus !== ' ') {
      parsed.stagedChanges.push({ path: filePath, status: mapStatusCode(indexStatus) });
    }

    if (worktreeStatus !== ' ') {
      parsed.unstagedChanges.push({ path: filePath, status: mapStatusCode(worktreeStatus) });
    }

    const primaryStatus = indexStatus !== ' ' ? mapStatusCode(indexStatus) : mapStatusCode(worktreeStatus);
    if (primaryStatus === 'A' && !groupedPaths.added.has(filePath)) {
      groupedPaths.added.add(filePath);
      parsed.added.push(filePath);
    } else if (primaryStatus === 'D' && !groupedPaths.deleted.has(filePath)) {
      groupedPaths.deleted.add(filePath);
      parsed.deleted.push(filePath);
    } else if (primaryStatus === 'U' && !groupedPaths.untracked.has(filePath)) {
      groupedPaths.untracked.add(filePath);
      parsed.untracked.push(filePath);
    } else if (!groupedPaths.modified.has(filePath)) {
      groupedPaths.modified.add(filePath);
      parsed.modified.push(filePath);
    }
  }

  return parsed;
}

/**
 * Select a human-readable message for a failed Git operation.
 *
 * @param {string} operation
 * @param {unknown} error
 * @returns {{ operation: string, error: string, details: string }}
 */
function formatOperationError(operation, error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
  const rawMessage = stderr || stdout || (error instanceof Error ? error.message : String(error));
  const message = rawMessage || `${operation} failed`;

  if (message.includes('Could not resolve hostname')) {
    return {
      operation,
      error: `${operation} failed`,
      details: 'Unable to connect to the remote repository. Check the remote URL and network.',
    };
  }

  if (message.includes('does not appear to be a git repository')) {
    return {
      operation,
      error: `${operation} failed`,
      details: 'No usable remote repository is configured for this project.',
    };
  }

  if (message.includes('Please commit your changes or stash them')) {
    return {
      operation,
      error: `${operation} failed`,
      details: 'Local changes must be committed, stashed, or discarded before continuing.',
    };
  }

  if (message.includes('CONFLICT')) {
    return {
      operation,
      error: `${operation} failed`,
      details: 'Git reported merge conflicts. Resolve them in the working tree before retrying.',
    };
  }

  if (message.includes('rejected') || message.includes('non-fast-forward')) {
    return {
      operation,
      error: `${operation} failed`,
      details: 'The remote has commits your branch does not have yet. Pull the latest changes first.',
    };
  }

  if (message.includes('Permission denied')) {
    return {
      operation,
      error: `${operation} failed`,
      details: 'Authentication failed. Check the repository credentials or SSH keys.',
    };
  }

  if (message.includes('Cannot delete branch') || message.includes('checked out')) {
    return {
      operation,
      error: `${operation} failed`,
      details: 'The current branch cannot be deleted. Switch to another branch first.',
    };
  }

  if (message.includes('not fully merged')) {
    return {
      operation,
      error: `${operation} failed`,
      details: 'Git refused to delete the branch because it is not fully merged.',
    };
  }

  return {
    operation,
    error: `${operation} failed`,
    details: message,
  };
}

/**
 * Send a stable operation error payload for the Git panel.
 *
 * @param {import('express').Response} res
 * @param {string} operation
 * @param {unknown} error
 * @param {number} [statusCode]
 * @returns {import('express').Response}
 */
function sendOperationError(res, operation, error, statusCode = 500) {
  return res.status(statusCode).json(formatOperationError(operation, error));
}

/**
 * Resolve the project path from the encoded project name.
 *
 * @param {string} projectName
 * @param {string | null | undefined} projectPathHint
 * @returns {Promise<string>}
 */
async function getActualProjectPath(projectName, projectPathHint = null) {
  const hintedPath = typeof projectPathHint === 'string' ? projectPathHint.trim() : '';

  try {
    const resolvedPath = await extractProjectDirectory(projectName);
    const stats = await fs.stat(resolvedPath).catch(() => null);
    if (stats) {
      return resolvedPath;
    }
  } catch (error) {
    console.error(`Error extracting project directory for ${projectName}:`, error);
  }

  if (hintedPath) {
    return path.resolve(hintedPath);
  }

  throw new Error(`Project path not found: ${projectName}`);
}

/**
 * Strip diff headers so the panel renders just hunks and body lines.
 *
 * @param {string} diff
 * @returns {string}
 */
function stripDiffHeaders(diff) {
  if (!diff) {
    return '';
  }

  const lines = diff.split('\n');
  const filteredLines = [];
  let startIncluding = false;

  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      continue;
    }

    if (line.startsWith('@@') || startIncluding) {
      startIncluding = true;
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

/**
 * Ensure the requested project path is an accessible Git work tree.
 *
 * @param {string} projectPath
 * @returns {Promise<void>}
 */
async function validateGitRepository(projectPath) {
  try {
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  try {
    const { stdout } = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree']);
    if (stdout.trim() !== 'true') {
      throw new Error('Not inside a git work tree');
    }

    await runGit(projectPath, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error('Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.');
  }
}

/**
 * Read the current branch and whether the repository already has commits.
 *
 * @param {string} projectPath
 * @returns {Promise<{ branch: string, hasCommits: boolean }>}
 */
async function getCurrentBranchInfo(projectPath) {
  try {
    const { stdout } = await runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return {
      branch: stdout.trim() || 'main',
      hasCommits: true,
    };
  } catch (error) {
    const message = typeof error?.stderr === 'string' ? error.stderr : error instanceof Error ? error.message : '';
    if (message.includes('unknown revision') || message.includes('ambiguous argument') || message.includes('Needed a single revision')) {
      return {
        branch: 'main',
        hasCommits: false,
      };
    }

    throw error;
  }
}

/**
 * Return all configured remotes.
 *
 * @param {string} projectPath
 * @returns {Promise<string[]>}
 */
async function listRemotes(projectPath) {
  try {
    const { stdout } = await runGit(projectPath, ['remote']);
    return stdout.split('\n').map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Choose the preferred remote name for the repository.
 *
 * @param {string} projectPath
 * @returns {Promise<string | null>}
 */
async function getPreferredRemoteName(projectPath) {
  const remotes = await listRemotes(projectPath);
  if (remotes.length === 0) {
    return null;
  }

  return remotes.includes('origin') ? 'origin' : remotes[0];
}

/**
 * Resolve the current branch upstream if one exists.
 *
 * @param {string} projectPath
 * @param {string} branch
 * @returns {Promise<{ trackingBranch: string, remoteName: string, remoteBranch: string } | null>}
 */
async function getUpstreamInfo(projectPath, branch) {
  try {
    const { stdout } = await runGit(projectPath, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
    const trackingBranch = stdout.trim();
    const [remoteName, ...remoteBranchParts] = trackingBranch.split('/');
    return {
      trackingBranch,
      remoteName,
      remoteBranch: remoteBranchParts.join('/'),
    };
  } catch {
    return null;
  }
}

/**
 * Get local and remote branch lists for the panel.
 *
 * @param {string} projectPath
 * @returns {Promise<{
 *   currentBranch: string,
 *   localBranches: Array<{ name: string, isCurrent: boolean }>,
 *   remoteBranches: Array<{ name: string, remoteName: string, localName: string, hasLocal: boolean, isCurrent: boolean }>
 * }>}
 */
async function getBranchSnapshot(projectPath) {
  const { branch: currentBranch } = await getCurrentBranchInfo(projectPath);
  const { stdout: localOutput } = await runGit(projectPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  const { stdout: remoteOutput } = await runGit(projectPath, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']);

  const localBranchNames = localOutput.split('\n').map((item) => item.trim()).filter(Boolean);
  const localSet = new Set(localBranchNames);
  const localBranches = localBranchNames.map((name) => ({
    name,
    isCurrent: name === currentBranch,
  }));

  const remoteBranches = remoteOutput
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item && !item.endsWith('/HEAD'))
    .map((name) => {
      const [remoteName, ...branchParts] = name.split('/');
      const localName = branchParts.join('/');
      return {
        name,
        remoteName,
        localName,
        hasLocal: localSet.has(localName),
        isCurrent: localName === currentBranch,
      };
    });

  return {
    currentBranch,
    localBranches,
    remoteBranches,
  };
}

// Get git status for a project.
router.get('/status', async (req, res) => {
  const { project, projectPath } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { branch, hasCommits } = await getCurrentBranchInfo(resolvedProjectPath);
    const { stdout } = await runGit(resolvedProjectPath, ['status', '--porcelain']);
    const parsedStatus = parsePorcelainStatus(stdout);

    return res.json({
      branch,
      hasCommits,
      ...parsedStatus,
    });
  } catch (error) {
    console.error('Git status error:', error);
    return res.json({
      error: error.message.includes('Not a git repository') ? error.message : 'Git operation failed',
      details: error.message,
    });
  }
});

// Get diff for a specific file.
router.get('/diff', async (req, res) => {
  const { project, file, projectPath } = req.query;

  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { stdout: statusOutput } = await runGit(resolvedProjectPath, ['status', '--porcelain', '--', file]);
    const trimmedStatus = statusOutput.trim();
    const isUntracked = trimmedStatus.startsWith('??');
    const isDeleted = trimmedStatus.startsWith('D ') || trimmedStatus.startsWith(' D');

    let diff = '';
    if (isUntracked) {
      const filePath = path.join(resolvedProjectPath, file);
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        diff = `Directory: ${file}\n(Cannot show diff for directories)`;
      } else {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const lines = fileContent.split('\n');
        diff = `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`;
      }
    } else if (isDeleted) {
      const { stdout: fileContent } = await runGit(resolvedProjectPath, ['show', `HEAD:${file}`]);
      const lines = fileContent.split('\n');
      diff = `--- a/${file}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${lines.map((line) => `-${line}`).join('\n')}`;
    } else {
      const { stdout: unstagedDiff } = await runGit(resolvedProjectPath, ['diff', '--', file]);
      if (unstagedDiff) {
        diff = stripDiffHeaders(unstagedDiff);
      } else {
        const { stdout: stagedDiff } = await runGit(resolvedProjectPath, ['diff', '--cached', '--', file]);
        diff = stripDiffHeaders(stagedDiff);
      }
    }

    return res.json({ diff });
  } catch (error) {
    console.error('Git diff error:', error);
    return res.json({ error: error.message });
  }
});

// Get file content with diff information for the editor.
router.get('/file-with-diff', async (req, res) => {
  const { project, file, projectPath } = req.query;

  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { stdout: statusOutput } = await runGit(resolvedProjectPath, ['status', '--porcelain', '--', file]);
    const trimmedStatus = statusOutput.trim();
    const isUntracked = trimmedStatus.startsWith('??');
    const isDeleted = trimmedStatus.startsWith('D ') || trimmedStatus.startsWith(' D');

    let currentContent = '';
    let oldContent = '';

    if (isDeleted) {
      const { stdout } = await runGit(resolvedProjectPath, ['show', `HEAD:${file}`]);
      oldContent = stdout;
      currentContent = stdout;
    } else {
      const filePath = path.join(resolvedProjectPath, file);
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        return res.status(400).json({ error: 'Cannot show diff for directories' });
      }

      currentContent = await fs.readFile(filePath, 'utf-8');

      if (!isUntracked) {
        try {
          const { stdout } = await runGit(resolvedProjectPath, ['show', `HEAD:${file}`]);
          oldContent = stdout;
        } catch {
          oldContent = '';
        }
      }
    }

    return res.json({
      currentContent,
      oldContent,
      isDeleted,
      isUntracked,
    });
  } catch (error) {
    console.error('Git file-with-diff error:', error);
    return res.json({ error: error.message });
  }
});

// Create the first commit in a repository without history.
router.post('/initial-commit', async (req, res) => {
  const { project, projectPath } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    try {
      await runGit(resolvedProjectPath, ['rev-parse', 'HEAD']);
      return res.status(400).json({ error: 'Repository already has commits. Use regular commit instead.' });
    } catch {
      // Repositories without HEAD are expected here.
    }

    await runGit(resolvedProjectPath, ['add', '.']);
    const { stdout } = await runGit(resolvedProjectPath, ['commit', '-m', 'Initial commit']);

    return res.json({ success: true, output: stdout, operation: 'initial commit' });
  } catch (error) {
    console.error('Git initial commit error:', error);
    return sendOperationError(res, 'initial commit', error);
  }
});

// Commit selected files.
router.post('/commit', async (req, res) => {
  const { project, message, files, projectPath } = req.body;

  if (!project || !message || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name, commit message, and files are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    for (const file of files) {
      await runGit(resolvedProjectPath, ['add', '--', file]);
    }

    const { stdout } = await runGit(resolvedProjectPath, ['commit', '-m', message]);
    return res.json({ success: true, output: stdout, operation: 'commit' });
  } catch (error) {
    console.error('Git commit error:', error);
    return sendOperationError(res, 'commit', error);
  }
});

// Get local and remote branch lists for the panel.
router.get('/branches', async (req, res) => {
  const { project, projectPath } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    return res.json(await getBranchSnapshot(resolvedProjectPath));
  } catch (error) {
    console.error('Git branches error:', error);
    return res.json({ error: error.message });
  }
});

// Checkout an existing branch or create a tracking branch from a remote ref.
router.post('/checkout', async (req, res) => {
  const { project, branch, startPoint, projectPath } = req.body;

  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    if (startPoint) {
      const { stdout: localOutput } = await runGit(resolvedProjectPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
      const existingBranches = new Set(localOutput.split('\n').map((item) => item.trim()).filter(Boolean));
      if (!existingBranches.has(branch)) {
        const { stdout } = await runGit(resolvedProjectPath, ['checkout', '-b', branch, startPoint]);
        return res.json({ success: true, output: stdout, operation: 'switch branch' });
      }
    }

    const { stdout } = await runGit(resolvedProjectPath, ['checkout', branch]);
    return res.json({ success: true, output: stdout, operation: 'switch branch' });
  } catch (error) {
    console.error('Git checkout error:', error);
    return sendOperationError(res, 'switch branch', error);
  }
});

// Create and switch to a new branch.
router.post('/create-branch', async (req, res) => {
  const { project, branch, projectPath } = req.body;

  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch name are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { stdout } = await runGit(resolvedProjectPath, ['checkout', '-b', branch]);
    return res.json({ success: true, output: stdout, operation: 'create branch' });
  } catch (error) {
    console.error('Git create branch error:', error);
    return sendOperationError(res, 'create branch', error);
  }
});

// Delete a local branch while guarding the current branch.
router.post('/delete-branch', async (req, res) => {
  const { project, branch, projectPath } = req.body;

  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { branch: currentBranch } = await getCurrentBranchInfo(resolvedProjectPath);
    if (currentBranch === branch) {
      return res.status(400).json({
        operation: 'delete branch',
        error: 'delete branch failed',
        details: 'The current branch cannot be deleted. Switch to another branch first.',
      });
    }

    const { stdout } = await runGit(resolvedProjectPath, ['branch', '-d', branch]);
    return res.json({ success: true, output: stdout, operation: 'delete branch' });
  } catch (error) {
    console.error('Git delete branch error:', error);
    return sendOperationError(res, 'delete branch', error);
  }
});

// Get recent commits.
router.get('/commits', async (req, res) => {
  const { project, limit = 10, projectPath } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);
    const parsedLimit = Number.parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 10;

    const { stdout } = await runGit(resolvedProjectPath, [
      'log',
      '--pretty=format:%H|%an|%ae|%ad|%s',
      '--date=relative',
      '-n',
      String(safeLimit),
    ]);

    const commits = stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [hash, author, email, date, ...messageParts] = line.split('|');
        return {
          hash,
          author,
          email,
          date,
          message: messageParts.join('|'),
        };
      });

    for (const commit of commits) {
      try {
        const { stdout: stats } = await runGit(resolvedProjectPath, ['show', '--stat', "--format=''", commit.hash]);
        commit.stats = stats.trim().split('\n').pop();
      } catch {
        commit.stats = '';
      }
    }

    return res.json({ commits });
  } catch (error) {
    console.error('Git commits error:', error);
    return res.json({ error: error.message });
  }
});

// Get the full diff for a specific commit.
router.get('/commit-diff', async (req, res) => {
  const { project, commit, projectPath } = req.query;

  if (!project || !commit) {
    return res.status(400).json({ error: 'Project name and commit hash are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    const { stdout } = await runGit(resolvedProjectPath, ['show', String(commit)]);
    return res.json({ diff: stdout });
  } catch (error) {
    console.error('Git commit diff error:', error);
    return res.json({ error: error.message });
  }
});

// Generate a commit message based on selected file diffs.
router.post('/generate-commit-message', async (req, res) => {
  const { project, files, provider = 'claude', projectPath } = req.body;

  if (!project || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name and files are required' });
  }

  if (!['claude', 'codex'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be "claude" or "codex"' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    let diffContext = '';

    for (const file of files) {
      try {
        const { stdout } = await runGit(resolvedProjectPath, ['diff', 'HEAD', '--', file]);
        if (stdout) {
          diffContext += `\n--- ${file} ---\n${stdout}`;
        }
      } catch (error) {
        console.error(`Error getting diff for ${file}:`, error);
      }
    }

    if (!diffContext.trim()) {
      for (const file of files) {
        try {
          const filePath = path.join(resolvedProjectPath, file);
          const stats = await fs.stat(filePath);
          if (!stats.isDirectory()) {
            const content = await fs.readFile(filePath, 'utf-8');
            diffContext += `\n--- ${file} (new file) ---\n${content.substring(0, 1000)}\n`;
          } else {
            diffContext += `\n--- ${file} (new directory) ---\n`;
          }
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
        }
      }
    }

    const message = await generateCommitMessageWithAI(files, diffContext, provider, resolvedProjectPath);
    return res.json({ message });
  } catch (error) {
    console.error('Generate commit message error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Generate a commit message using the configured AI provider.
 *
 * @param {Array<string>} files
 * @param {string} diffContext
 * @param {'claude' | 'codex'} provider
 * @param {string} projectPath
 * @returns {Promise<string>}
 */
async function generateCommitMessageWithAI(files, diffContext, provider, projectPath) {
  const prompt = `Generate a conventional commit message for these changes.

REQUIREMENTS:
- Format: type(scope): subject
- Include body explaining what changed and why
- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Subject under 50 chars, body wrapped at 72 chars
- Focus on user-facing changes, not implementation details
- Consider what's being added AND removed
- Return ONLY the commit message (no markdown, explanations, or code blocks)

FILES CHANGED:
${files.map((file) => `- ${file}`).join('\n')}

DIFFS:
${diffContext.substring(0, 4000)}

Generate the commit message:`;

  try {
    let responseText = '';
    const writer = {
      send: (data) => {
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          if (parsed.type === 'claude-response' && parsed.data) {
            const message = parsed.data.message || parsed.data;
            if (message.content && Array.isArray(message.content)) {
              for (const item of message.content) {
                if (item.type === 'text' && item.text) {
                  responseText += item.text;
                }
              }
            }
          } else if (
            parsed.type === 'codex-response' &&
            parsed.data?.type === 'item' &&
            parsed.data?.itemType === 'agent_message' &&
            typeof parsed.data?.message?.content === 'string'
          ) {
            responseText += parsed.data.message.content;
          } else if (parsed.type === 'text' && parsed.text) {
            responseText += parsed.text;
          }
        } catch (parseError) {
          console.error('Error parsing writer data:', parseError);
        }
      },
      setSessionId: () => {},
    };

    if (provider === 'claude') {
      await queryClaudeSDK(prompt, {
        cwd: projectPath,
        permissionMode: 'bypassPermissions',
      }, writer);
    } else {
      await queryCodex(prompt, {
        cwd: projectPath,
        projectPath,
        permissionMode: 'bypassPermissions',
      }, writer);
    }

    const cleanedMessage = cleanCommitMessage(responseText);
    return cleanedMessage || 'chore: update files';
  } catch (error) {
    console.error('Error generating commit message with AI:', error);
    return `chore: update ${files.length} file${files.length !== 1 ? 's' : ''}`;
  }
}

/**
 * Remove markdown and extra framing from an AI-generated commit message.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanCommitMessage(text) {
  if (!text || !text.trim()) {
    return '';
  }

  let cleaned = text.trim();
  cleaned = cleaned.replace(/```[a-z]*\n/g, '');
  cleaned = cleaned.replace(/```/g, '');
  cleaned = cleaned.replace(/^#+\s*/gm, '');
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  const conventionalCommitMatch = cleaned.match(/(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+?\))?:.+/s);
  if (conventionalCommitMatch) {
    cleaned = cleaned.substring(cleaned.indexOf(conventionalCommitMatch[0]));
  }

  return cleaned.trim();
}

// Get remote status (ahead/behind commits with smart remote detection).
router.get('/remote-status', async (req, res) => {
  const { project, projectPath } = req.query;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { branch } = await getCurrentBranchInfo(resolvedProjectPath);
    const upstream = await getUpstreamInfo(resolvedProjectPath, branch);

    if (!upstream) {
      const remoteName = await getPreferredRemoteName(resolvedProjectPath);
      return res.json({
        hasRemote: Boolean(remoteName),
        hasUpstream: false,
        branch,
        remoteName,
        message: 'No remote tracking branch configured',
      });
    }

    const { stdout: countOutput } = await runGit(resolvedProjectPath, ['rev-list', '--count', '--left-right', `${upstream.trackingBranch}...HEAD`]);
    const [behind, ahead] = countOutput.trim().split('\t').map((value) => Number.parseInt(value, 10) || 0);

    return res.json({
      hasRemote: true,
      hasUpstream: true,
      branch,
      remoteBranch: upstream.trackingBranch,
      remoteName: upstream.remoteName,
      ahead,
      behind,
      isUpToDate: ahead === 0 && behind === 0,
    });
  } catch (error) {
    console.error('Git remote status error:', error);
    return res.json({ error: error.message });
  }
});

// Fetch from the preferred remote.
router.post('/fetch', async (req, res) => {
  const { project, projectPath } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { branch } = await getCurrentBranchInfo(resolvedProjectPath);
    const upstream = await getUpstreamInfo(resolvedProjectPath, branch);
    const remoteName = upstream?.remoteName || await getPreferredRemoteName(resolvedProjectPath);
    if (!remoteName) {
      return res.status(400).json({
        operation: 'fetch',
        error: 'fetch failed',
        details: 'No remote repository is configured for this project.',
      });
    }

    const { stdout, stderr } = await runGit(resolvedProjectPath, ['fetch', remoteName]);
    return res.json({
      success: true,
      operation: 'fetch',
      output: stdout || stderr || 'Fetch completed successfully',
      remoteName,
    });
  } catch (error) {
    console.error('Git fetch error:', error);
    return sendOperationError(res, 'fetch', error);
  }
});

// Pull from the current branch upstream.
router.post('/pull', async (req, res) => {
  const { project, projectPath } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { branch } = await getCurrentBranchInfo(resolvedProjectPath);
    const upstream = await getUpstreamInfo(resolvedProjectPath, branch);
    const remoteName = upstream?.remoteName || await getPreferredRemoteName(resolvedProjectPath);
    const remoteBranch = upstream?.remoteBranch || branch;

    if (!remoteName) {
      return res.status(400).json({
        operation: 'pull',
        error: 'pull failed',
        details: 'No remote repository is configured for this project.',
      });
    }

    const { stdout, stderr } = await runGit(resolvedProjectPath, ['pull', remoteName, remoteBranch]);
    return res.json({
      success: true,
      operation: 'pull',
      output: stdout || stderr || 'Pull completed successfully',
      remoteName,
      remoteBranch,
    });
  } catch (error) {
    console.error('Git pull error:', error);
    return sendOperationError(res, 'pull', error);
  }
});

// Push commits to the current branch upstream.
router.post('/push', async (req, res) => {
  const { project, projectPath } = req.body;

  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { branch } = await getCurrentBranchInfo(resolvedProjectPath);
    const upstream = await getUpstreamInfo(resolvedProjectPath, branch);
    const remoteName = upstream?.remoteName || await getPreferredRemoteName(resolvedProjectPath);
    const remoteBranch = upstream?.remoteBranch || branch;

    if (!remoteName) {
      return res.status(400).json({
        operation: 'push',
        error: 'push failed',
        details: 'No remote repository is configured for this project.',
      });
    }

    const args = upstream ? ['push', remoteName, remoteBranch] : ['push', '--set-upstream', remoteName, branch];
    const { stdout, stderr } = await runGit(resolvedProjectPath, args);
    return res.json({
      success: true,
      operation: 'push',
      output: stdout || stderr || 'Push completed successfully',
      remoteName,
      remoteBranch,
    });
  } catch (error) {
    console.error('Git push error:', error);
    return sendOperationError(res, 'push', error);
  }
});

// Publish the current branch and set its upstream.
router.post('/publish', async (req, res) => {
  const { project, branch, projectPath } = req.body;

  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { branch: currentBranch } = await getCurrentBranchInfo(resolvedProjectPath);
    if (currentBranch !== branch) {
      return res.status(400).json({
        operation: 'publish',
        error: 'publish failed',
        details: `Branch mismatch. Current branch is ${currentBranch}, but requested ${branch}.`,
      });
    }

    const remoteName = await getPreferredRemoteName(resolvedProjectPath);
    if (!remoteName) {
      return res.status(400).json({
        operation: 'publish',
        error: 'publish failed',
        details: 'No remote repository is configured for this project.',
      });
    }

    const { stdout, stderr } = await runGit(resolvedProjectPath, ['push', '--set-upstream', remoteName, branch]);
    return res.json({
      success: true,
      operation: 'publish',
      output: stdout || stderr || 'Branch published successfully',
      remoteName,
      branch,
    });
  } catch (error) {
    console.error('Git publish error:', error);
    return sendOperationError(res, 'publish', error);
  }
});

// Discard changes for a specific file.
router.post('/discard', async (req, res) => {
  const { project, file, projectPath } = req.body;

  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { stdout: statusOutput } = await runGit(resolvedProjectPath, ['status', '--porcelain', '--', file]);
    const trimmedStatus = statusOutput.trim();
    if (!trimmedStatus) {
      return res.status(400).json({ error: 'No changes to discard for this file' });
    }

    const indexStatus = trimmedStatus[0];
    const worktreeStatus = trimmedStatus[1];

    if (indexStatus === '?' && worktreeStatus === '?') {
      const filePath = path.join(resolvedProjectPath, file);
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(filePath);
      }
      return res.json({ success: true, operation: 'discard', output: `Deleted untracked path ${file}` });
    }

    if (indexStatus === 'A' && worktreeStatus === ' ') {
      await runGit(resolvedProjectPath, ['reset', 'HEAD', '--', file]);
      return res.json({ success: true, operation: 'discard', output: `Unstaged ${file}` });
    }

    if (indexStatus !== ' ') {
      await runGit(resolvedProjectPath, ['restore', '--staged', '--worktree', '--source=HEAD', '--', file]);
    } else {
      await runGit(resolvedProjectPath, ['restore', '--worktree', '--', file]);
    }

    return res.json({ success: true, operation: 'discard', output: `Changes discarded for ${file}` });
  } catch (error) {
    console.error('Git discard error:', error);
    return sendOperationError(res, 'discard', error);
  }
});

// Delete an untracked file or directory.
router.post('/delete-untracked', async (req, res) => {
  const { project, file, projectPath } = req.body;

  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const resolvedProjectPath = await getActualProjectPath(project, projectPath);
    await validateGitRepository(resolvedProjectPath);

    const { stdout: statusOutput } = await runGit(resolvedProjectPath, ['status', '--porcelain', '--', file]);
    const trimmedStatus = statusOutput.trim();
    if (!trimmedStatus) {
      return res.status(400).json({ error: 'File is not untracked or does not exist' });
    }

    if (!trimmedStatus.startsWith('??')) {
      return res.status(400).json({ error: 'File is not untracked. Use discard for tracked files.' });
    }

    const filePath = path.join(resolvedProjectPath, file);
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true });
      return res.json({ success: true, operation: 'delete untracked file', output: `Deleted ${file}` });
    }

    await fs.unlink(filePath);
    return res.json({ success: true, operation: 'delete untracked file', output: `Deleted ${file}` });
  } catch (error) {
    console.error('Git delete untracked error:', error);
    return sendOperationError(res, 'delete untracked file', error);
  }
});

export default router;
