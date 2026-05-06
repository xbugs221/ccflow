/**
 * PURPOSE: Keep all OpenSpec CLI access behind the Go opsx JSON contract.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Execute opsx with JSON output and parse the response payload.
 */
async function runOpsxJson(args, projectPath) {
  const { stdout } = await execFileAsync('opsx', args, {
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
  const payload = await runOpsxJson(['list', '--json'], projectPath);
  return Array.isArray(payload?.changes)
    ? payload.changes.map((change) => String(change?.name || change?.id || change || '').trim()).filter(Boolean)
    : [];
}

/**
 * Read one change status through opsx.
 */
export async function getOpenSpecStatus(projectPath, changeName) {
  return runOpsxJson(['status', changeName, '--json'], projectPath);
}

/**
 * Read apply instructions through opsx instead of hard-coded artifact paths.
 */
export async function getOpenSpecApplyInstructions(projectPath, changeName) {
  return runOpsxJson(['instructions', 'apply', '--change', changeName, '--json'], projectPath);
}

/**
 * Validate OpenSpec artifacts through opsx.
 */
export async function validateOpenSpec(projectPath, itemName = '') {
  const args = itemName ? ['validate', itemName, '--json'] : ['validate', '--json'];
  return runOpsxJson(args, projectPath);
}

/**
 * Archive one completed OpenSpec change through opsx.
 */
export async function archiveOpenSpecChange(projectPath, changeName) {
  return runOpsxJson(['archive', changeName, '--yes', '--json'], projectPath);
}
