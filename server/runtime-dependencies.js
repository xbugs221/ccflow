/**
 * PURPOSE: Resolve and validate external Go CLIs required by the ccflow
 * workflow control plane before the web server starts.
 */
import { execFileSync, spawnSync } from 'child_process';
import { resolveExecutablePath } from './executable-resolver.js';

const REQUIRED_COMMANDS = ['oz', 'wo'];
const RUNNER_CONTRACT_COMMAND = ['contract', '--json'];
const REQUIRED_RUNNER_CAPABILITIES = ['list-changes', 'run', 'resume', 'status', 'abort'];

/**
 * Build one actionable runtime dependency failure summary.
 */
function formatCommandFailure(commandName, args, detail = '') {
  const subcommand = [commandName, ...args].join(' ');
  return [
    `${subcommand} failed`,
    detail ? `detail: ${detail}` : '',
    `PATH=${process.env.PATH || ''}`,
  ].filter(Boolean).join('; ');
}

/**
 * Execute a lightweight version command without throwing raw child-process
 * errors into startup logs.
 */
function readCommandVersion(commandName, commandPath) {
  const result = spawnSync(commandPath || commandName, ['--version'], { encoding: 'utf8' });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const detail = result.error ? result.error.message : output || `exit ${result.status}`;
  return {
    ok: result.status === 0,
    output,
    error: result.status === 0 ? '' : formatCommandFailure(commandName, ['--version'], detail),
  };
}

/**
 * Check that the Go runner exposes the non-interactive commands required by
 * the web adapter.
 */
function checkRunnerContract(commandPath) {
  const result = spawnSync(commandPath || 'wo', RUNNER_CONTRACT_COMMAND, { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      required: [`wo ${RUNNER_CONTRACT_COMMAND.join(' ')}`],
      missing: [`wo ${RUNNER_CONTRACT_COMMAND.join(' ')}`],
      error: formatCommandFailure('wo', RUNNER_CONTRACT_COMMAND, result.error ? result.error.message : output || `exit ${result.status}`),
    };
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      ok: false,
      required: [`wo ${RUNNER_CONTRACT_COMMAND.join(' ')}`],
      missing: ['valid JSON contract output'],
      error: formatCommandFailure('wo', RUNNER_CONTRACT_COMMAND, `invalid JSON: ${error.message}`),
    };
  }
  const capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities.map((item) => String(item))
    : [];
  const missing = REQUIRED_RUNNER_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
  if (payload.json !== true) {
    missing.push('json=true');
  }
  return {
    ok: missing.length === 0,
    required: [`wo ${RUNNER_CONTRACT_COMMAND.join(' ')}`],
    missing,
    capabilities,
    version: payload.version || '',
    error: missing.length === 0 ? '' : formatCommandFailure('wo', RUNNER_CONTRACT_COMMAND, `missing ${missing.join(', ')}`),
  };
}

/**
 * Resolve all required workflow binaries and fail fast with actionable context.
 */
export function checkRequiredRuntimeDependencies() {
  const diagnostics = getRuntimeDependencyDiagnostics();
  const missing = Object.entries(diagnostics.commands)
    .filter(([, command]) => !command.command_path)
    .map(([name]) => name);
  const incompatible = [];
  if (diagnostics.commands.oz.command_path && !diagnostics.commands.oz.version.ok) {
    incompatible.push('oz --version');
  }
  if (diagnostics.commands.wo.command_path && !diagnostics.commands.wo.contract.ok) {
    incompatible.push(`wo contract: ${diagnostics.commands.wo.contract.missing.join(', ')}`);
  }
  if (missing.length > 0 || incompatible.length > 0) {
    throw new Error([
      'Missing or incompatible required workflow binaries.',
      missing.length > 0 ? `Missing from PATH: ${missing.join(', ')}` : '',
      incompatible.length > 0 ? `Incompatible: ${incompatible.join('; ')}` : '',
      'Install oz and wo manually, then ensure the service process PATH can see them.',
      `PATH=${process.env.PATH || ''}`,
    ].filter(Boolean).join(' '));
  }
  return diagnostics;
}

/**
 * Build diagnostics for settings and startup logs without exposing path
 * override controls.
 */
export function getRuntimeDependencyDiagnostics() {
  const commands = {};
  for (const commandName of REQUIRED_COMMANDS) {
    const commandPath = resolveExecutablePath(commandName);
    commands[commandName] = {
      name: commandName,
      command_path: commandPath,
      path: commandPath,
      version: commandPath ? readCommandVersion(commandName, commandPath) : { ok: false, output: '', error: `${commandName} not found in PATH: ${process.env.PATH || ''}` },
    };
  }
  commands.wo.contract = commands.wo.command_path
    ? checkRunnerContract(commands.wo.command_path)
    : { ok: false, required: [`wo ${RUNNER_CONTRACT_COMMAND.join(' ')}`], missing: ['wo'], error: `wo not found in PATH: ${process.env.PATH || ''}` };
  return {
    ok: REQUIRED_COMMANDS.every((commandName) => Boolean(commands[commandName].command_path))
      && commands.oz.version.ok
      && commands.wo.contract.ok,
    commands,
    path: process.env.PATH || '',
  };
}

/**
 * Run a required binary and parse its JSON stdout contract.
 */
export function runJsonCommand(commandName, args, options = {}) {
  const stdout = execFileSync(commandName, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 1024 * 1024 * 4,
  });
  return JSON.parse(stdout || '{}');
}
