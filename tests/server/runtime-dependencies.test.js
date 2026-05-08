/**
 * PURPOSE: Verify ccflow startup diagnostics depend only on the external Go
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

/**
 * Create one executable fake CLI in a temporary PATH directory.
 */
async function writeFakeCommand(binDir, name, body) {
  const filePath = path.join(binDir, name);
  await fs.writeFile(filePath, body, { mode: 0o755 });
  return filePath;
}

test('runtime diagnostics report fake oz and wo contract from PATH', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', '#!/bin/sh\nif [ "$1" = "--version" ]; then echo oz-test; exit 0; fi\necho "{}"\n');
  await writeFakeCommand(binDir, 'wo', [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo wo-test; exit 0; fi',
    'if [ "$1" = "contract" ]; then echo \'{"version":"wo-test","json":true,"capabilities":["list-changes","run","resume","status","abort"]}\'; exit 0; fi',
    'echo "{}"',
  ].join('\n'));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = checkRequiredRuntimeDependencies();
    assert.equal(diagnostics.ok, true);
    assert.match(diagnostics.commands.oz.path, /oz$/);
    assert.match(diagnostics.commands.oz.version.output, /oz-test/);
    assert.equal(diagnostics.commands.wo.contract.ok, true);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics fail when wo lacks JSON workflow contract', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-runtime-bin-'));
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
    assert.equal(diagnostics.commands.oz.path, '');
    assert.throws(() => checkRequiredRuntimeDependencies(), /Missing from PATH: oz, wo/);
  } finally {
    process.env.PATH = previousPath;
  }
});
