/**
 * PURPOSE: Keep all OpenSpec CLI access behind the Go ox JSON contract.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Execute ox with JSON output and parse the response payload.
 */
async function runOxJson(args, projectPath) {
  const { stdout } = await execFileAsync('ox', args, {
    cwd: projectPath,
    timeout: 10000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return JSON.parse(stdout || '{}');
}

/**
 * List active OpenSpec changes from docs/changes.
 */
export async function listOpenSpecChanges(projectPath) {
  const payload = await runOxJson(['list', '--json'], projectPath);
  return Array.isArray(payload?.changes)
    ? payload.changes.map((change) => String(change?.name || change?.id || change || '').trim()).filter(Boolean)
    : [];
}

/**
 * Read one change status through ox.
 */
export async function getOpenSpecStatus(projectPath, changeName) {
  return runOxJson(['status', changeName, '--json'], projectPath);
}

/**
 * Read apply instructions through ox instead of hard-coded artifact paths.
 */
export async function getOpenSpecApplyInstructions(projectPath, changeName) {
  return runOxJson(['instructions', 'apply', '--change', changeName, '--json'], projectPath);
}

/**
 * Validate OpenSpec artifacts through ox.
 */
export async function validateOpenSpec(projectPath, itemName = '') {
  const args = itemName ? ['validate', itemName, '--json'] : ['validate', '--json'];
  return runOxJson(args, projectPath);
}

/**
 * Archive one completed OpenSpec change through ox.
 */
export async function archiveOpenSpecChange(projectPath, changeName) {
  return runOxJson(['archive', changeName, '--yes', '--json'], projectPath);
}
