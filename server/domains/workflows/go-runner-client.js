/**
 * PURPOSE: Adapt ccflow workflow APIs to the external Go runner without
 * parsing provider JSONL or reimplementing runner state transitions.
 */
import path from 'path';
import { promises as fs } from 'fs';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const RUNS_ROOT = path.join('.ccflow', 'runs');

/**
 * Execute mc with JSON output and parse the response payload.
 */
async function runMcJson(args, projectPath) {
  const { stdout } = await execFileAsync('mc', args, {
    cwd: projectPath,
    timeout: 10000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return JSON.parse(stdout || '{}');
}

/**
 * Wait briefly for the runner to publish the sealed state file for a run id.
 */
async function waitForRunStateFile(projectPath, runId) {
  const statePath = path.join(projectPath, RUNS_ROOT, runId, 'state.json');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fs.access(statePath);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    }
  }
  throw new Error(`Go runner did not publish state.json for run ${runId}`);
}

/**
 * Start a long-running mc process and resolve after it exposes its run id.
 */
async function spawnMcRun(args, projectPath) {
  const child = spawn('mc', args, {
    cwd: projectPath,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let settled = false;
  let finishPromise = null;

  return new Promise((resolve, reject) => {
    const terminateChild = () => {
      /**
       * Stop a runner that failed before ccflow could persistently bind its run id.
       */
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGTERM');
      }
    };

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      terminateChild();
      reject(new Error(`Go runner did not expose runId before startup timeout: ${stderr.trim()}`));
    }, 10000);

    const finish = async (payload) => {
      if (settled) {
        return finishPromise;
      }
      if (!finishPromise) {
        finishPromise = (async () => {
          const runId = String(payload?.runId || payload?.run_id || '').trim();
          await waitForRunStateFile(projectPath, runId);
          settled = true;
          clearTimeout(timeout);
          resolve({ ...payload, pid: child.pid });
        })();
      }
      return finishPromise;
    };

    const tryResolveFromStdout = async () => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        return;
      }
      const firstJsonLine = trimmed.split(/\r?\n/).find((line) => line.trim().startsWith('{'));
      if (!firstJsonLine) {
        return;
      }
      const payload = JSON.parse(firstJsonLine);
      const runId = String(payload?.runId || payload?.run_id || '').trim();
      if (runId) {
        await finish(payload);
      }
    };

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      tryResolveFromStdout().catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          terminateChild();
          reject(error);
        }
      });
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on('exit', async (code) => {
      if (settled) {
        return;
      }
      if (finishPromise) {
        try {
          await finishPromise;
        } catch (error) {
          settled = true;
          clearTimeout(timeout);
          terminateChild();
          reject(error);
        }
        return;
      }
      try {
        await tryResolveFromStdout();
      } catch (error) {
        settled = true;
        clearTimeout(timeout);
        terminateChild();
        reject(error);
        return;
      }
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Go runner exited before returning runId with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Start a new Go-backed run for an active OpenSpec change.
 */
export async function startGoWorkflowRun(projectPath, changeName) {
  return spawnMcRun(['run', '--change', changeName, '--json'], projectPath);
}

/**
 * Resume an existing Go-backed run.
 */
export async function resumeGoWorkflowRun(projectPath, runId) {
  return spawnMcRun(['resume', '--run-id', runId, '--json'], projectPath);
}

/**
 * Query a Go-backed run through the runner contract.
 */
export async function getGoWorkflowRunStatus(projectPath, runId) {
  return runMcJson(['status', '--run-id', runId, '--json'], projectPath);
}

/**
 * Abort an existing Go-backed run.
 */
export async function abortGoWorkflowRun(projectPath, runId) {
  return runMcJson(['abort', '--run-id', runId, '--json'], projectPath);
}

/**
 * Read sealed runner state directly from the stable state.json path.
 */
export async function readGoWorkflowState(projectPath, runId) {
  if (!projectPath || !runId) {
    return null;
  }
  const statePath = path.join(projectPath, RUNS_ROOT, runId, 'state.json');
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Convert a runner-provided relative path to a slash-separated project path.
 */
export function normalizeRunnerPath(value) {
  return String(value || '').split(path.sep).join('/');
}
