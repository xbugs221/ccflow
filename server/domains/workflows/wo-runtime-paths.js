/**
 * PURPOSE: Resolve wo user-state runtime paths so ccflow reads the same sealed
 * run state files that the external runner publishes for each repository.
 */
import crypto from 'crypto';
import os from 'os';
import path from 'path';

/**
 * Normalize a project path before deriving the wo repository key.
 */
export function resolveWoProjectPath(projectPath) {
  return path.resolve(String(projectPath || '') || '.');
}

/**
 * Convert a repository basename into the sanitized prefix used by wo.
 */
export function sanitizeWoRepoBasename(projectPath) {
  const basename = path.basename(resolveWoProjectPath(projectPath)).toLowerCase();
  return basename.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
}

/**
 * Derive the wo repository key for a project path.
 */
export function resolveWoRepoKey(projectPath) {
  const absoluteProjectPath = resolveWoProjectPath(projectPath);
  const hash = crypto.createHash('sha1').update(absoluteProjectPath).digest('hex').slice(0, 10);
  return `${sanitizeWoRepoBasename(absoluteProjectPath)}-${hash}`;
}

/**
 * Resolve the root directory where wo stores repository-scoped runtime state.
 */
export function resolveWoStateRoot(env = process.env) {
  if (env.XDG_STATE_HOME) {
    return path.join(env.XDG_STATE_HOME, 'wo');
  }
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'wo');
  }
  return path.join(os.homedir(), '.local', 'state', 'wo');
}

/**
 * Resolve the runs directory for a project in the wo user-state tree.
 */
export function resolveWoRunsRoot(projectPath, env = process.env) {
  return path.join(resolveWoStateRoot(env), 'repos', resolveWoRepoKey(projectPath), 'runs');
}

/**
 * Resolve one run directory for a project.
 */
export function resolveWoRunDir(projectPath, runId, env = process.env) {
  return path.join(resolveWoRunsRoot(projectPath, env), String(runId || ''));
}

/**
 * Resolve the sealed state file path for one wo run.
 */
export function resolveWoRunStatePath(projectPath, runId, env = process.env) {
  return path.join(resolveWoRunDir(projectPath, runId, env), 'state.json');
}

/**
 * Resolve the batches directory for a project in the wo user-state tree.
 */
export function resolveWoBatchesRoot(projectPath, env = process.env) {
  return path.join(resolveWoStateRoot(env), 'repos', resolveWoRepoKey(projectPath), 'batches');
}

/**
 * Resolve one batch state file path.
 */
export function resolveWoBatchStatePath(projectPath, batchId, env = process.env) {
  return path.join(resolveWoBatchesRoot(projectPath, env), String(batchId || ''), 'state.json');
}

/**
 * Render state paths compactly in diagnostics when they live under the state root.
 */
export function formatWoStatePathForDiagnostics(statePath, env = process.env) {
  const stateRoot = resolveWoStateRoot(env);
  const relative = path.relative(stateRoot, statePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return path.join('${XDG_STATE_HOME:-~/.local/state}', 'wo', relative).replace(/\\/g, '/');
  }
  return String(statePath || '').replace(/\\/g, '/');
}
