/**
 * PURPOSE: Verify cbw startup diagnostics depend only on the external Go
 * CLI JSON/version contract visible through PATH.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import {
  checkRequiredRuntimeDependencies,
  getRuntimeDependencyDiagnostics,
} from '../../server/runtime-dependencies.js';
import {
  assertCoProviderAvailable,
  isCoProviderAvailable,
  runCoDoctor,
} from '../../server/co-client.js';

/**
 * Create one executable fake CLI in a temporary PATH directory.
 */
async function writeFakeCommand(binDir, name, body) {
  const filePath = path.join(binDir, name);
  await fs.writeFile(filePath, body, { mode: 0o755 });
  return filePath;
}

test('runtime diagnostics report fake oz, wo and co from PATH', async () => {
  const previousPath = process.env.PATH;
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbw-runtime-bin-'));
  const coHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cbw-runtime-co-home-'));
  await writeFakeCommand(binDir, 'oz', '#!/bin/sh\nif [ "$1" = "--version" ]; then echo oz-test; exit 0; fi\necho "{}"\n');
  await writeFakeCommand(binDir, 'wo', [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo wo-test; exit 0; fi',
    'if [ "$1" = "contract" ]; then echo \'{"version":"wo-test","json":true,"capabilities":["list-changes","run","resume","status","abort"]}\'; exit 0; fi',
    'echo "{}"',
  ].join('\n'));
  await writeFakeCommand(binDir, 'co', [
    '#!/bin/sh',
    'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
    '  printf \'{"ok":true,"contract":"co-request-v1","version":"co-test","home":"%s","providers":{"codex":true,"opencode":true}}\\n\' "$CCFLOW_CO_HOME"',
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  process.env.CCFLOW_CO_HOME = coHome;
  try {
    const diagnostics = checkRequiredRuntimeDependencies();
    const coStatus = await runCoDoctor();
    assert.equal(diagnostics.ok, true);
    assert.equal(diagnostics.commands.oz.command_path, path.join(binDir, 'oz'));
    assert.equal(diagnostics.commands.wo.command_path, path.join(binDir, 'wo'));
    assert.equal(coStatus.command_path, path.join(binDir, 'co'));
    assert.equal(coStatus.home, coHome);
    assert.match(diagnostics.commands.oz.version.output, /oz-test/);
    assert.equal(diagnostics.commands.wo.contract.ok, true);
    assert.equal(isCoProviderAvailable(coStatus, 'opencode'), true);
  } finally {
    process.env.PATH = previousPath;
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
  }
});

test('runtime diagnostics fail when wo lacks JSON workflow contract', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbw-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', '#!/bin/sh\nif [ "$1" = "--version" ]; then echo oz-test; exit 0; fi\necho "{}"\n');
  await writeFakeCommand(binDir, 'wo', [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo wo-test; exit 0; fi',
    'if [ "$1" = "contract" ]; then echo \'{"version":"wo-test","json":true,"capabilities":["list-changes","run","status"]}\'; exit 0; fi',
    'echo "{}"',
  ].join('\n'));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.commands.wo.contract.ok, false);
    assert.deepEqual(diagnostics.commands.wo.contract.missing, ['resume', 'abort']);
    assert.throws(() => checkRequiredRuntimeDependencies(), /wo contract/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics fail clearly when required CLIs are missing', () => {
  const previousPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.commands.oz.command_path, '');
    assert.match(diagnostics.commands.oz.version.error, /PATH/);
    assert.throws(() => checkRequiredRuntimeDependencies(), /Missing from PATH: oz, wo/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('OpenCode provider false fails before pending request write is allowed', () => {
  const previousPath = process.env.PATH;
  process.env.PATH = '/tmp/cbw-test-path';
  try {
    const status = {
      ok: true,
      contract: 'co-request-v1',
      providers: {
        codex: true,
        opencode: false,
      },
      error: 'doctor reported unavailable provider',
    };

    assert.equal(isCoProviderAvailable(status, 'opencode'), false);
    assert.throws(
      () => assertCoProviderAvailable(status, 'opencode'),
      /co provider "opencode" is unavailable: doctor reported unavailable provider; PATH=\/tmp\/cbw-test-path/,
    );
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics include command, subcommand and PATH in failure summaries', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbw-runtime-failure-bin-'));
  await writeFakeCommand(binDir, 'oz', '#!/bin/sh\nif [ "$1" = "--version" ]; then echo oz-broken >&2; exit 2; fi\nexit 1\n');
  await writeFakeCommand(binDir, 'wo', [
    '#!/bin/sh',
    'if [ "$1" = "contract" ]; then echo contract-broken >&2; exit 3; fi',
    'if [ "$1" = "--version" ]; then echo wo-test; exit 0; fi',
    'exit 1',
  ].join('\n'));
  process.env.PATH = binDir;
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.match(diagnostics.commands.oz.version.error, /oz --version failed/);
    assert.match(diagnostics.commands.oz.version.error, /oz-broken/);
    assert.match(diagnostics.commands.oz.version.error, /PATH=/);
    assert.match(diagnostics.commands.wo.contract.error, /wo contract --json failed/);
    assert.match(diagnostics.commands.wo.contract.error, /contract-broken/);
    assert.match(diagnostics.commands.wo.contract.error, /PATH=/);
  } finally {
    process.env.PATH = previousPath;
  }
});
