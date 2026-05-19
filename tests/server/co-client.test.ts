// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify co doctor normalization and provider send gating used before
 * cbw writes co request files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  assertCoProviderAvailable,
  isCoProviderAvailable,
  normalizeCoProviders,
  runCoDoctor,
} from '../../server/co-client.ts';

/**
 * Create one executable fake co binary in a temporary PATH directory.
 */
async function writeFakeCommand(binDir, name, body) {
  const filePath = path.join(binDir, name);
  await fs.writeFile(filePath, body, { mode: 0o755 });
  return filePath;
}

test('co doctor boolean provider schema ignores removed OpenCode provider', () => {
  const normalized = normalizeCoProviders({
    codex: true,
    opencode: true,
  });

  assert.deepEqual(normalized, {
    codex: { available: true },
    pi: { available: false },
  });
  assert.equal(isCoProviderAvailable({ providers: { opencode: true } }, 'opencode'), false);
});

test('removed OpenCode provider false fails before callers write pending requests', () => {
  const previousPath = process.env.PATH;
  process.env.PATH = '/tmp/cbw-provider-false';
  try {
    assert.equal(isCoProviderAvailable({ providers: { opencode: false } }, 'opencode'), false);
    assert.throws(
      () => assertCoProviderAvailable({ error: 'doctor says unavailable', providers: { opencode: false } }, 'opencode'),
      /co provider "opencode" is unavailable: doctor says unavailable; PATH=\/tmp\/cbw-provider-false/,
    );
  } finally {
    process.env.PATH = previousPath;
  }
});

test('Pi provider normalization includes pi in PROVIDERS set', () => {
  const normalized = normalizeCoProviders({
    pi: true,
  });

  assert.equal(normalized.pi.available, true);
  assert.equal(isCoProviderAvailable({ providers: { pi: true } }, 'pi'), true);
});

test('Pi provider unavailable blocks send gate', () => {
  assert.equal(isCoProviderAvailable({ providers: { pi: false } }, 'pi'), false);
  assert.equal(isCoProviderAvailable({ providers: {} }, 'pi'), false);
  assert.throws(
    () => assertCoProviderAvailable({ error: 'pi not found', providers: { pi: false } }, 'pi'),
    /co provider "pi" is unavailable/,
  );
});

test('co doctor failures include subcommand and PATH for invalid JSON and nonzero exits', async () => {
  const previousPath = process.env.PATH;
  const invalidBinDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbw-co-invalid-json-'));
  await writeFakeCommand(invalidBinDir, 'co', '#!/bin/sh\nif [ "$1" = "doctor" ]; then echo not-json; exit 0; fi\nexit 1\n');
  process.env.PATH = invalidBinDir;
  try {
    const invalidStatus = await runCoDoctor({ timeoutMs: 200 });
    assert.equal(invalidStatus.ok, false);
    assert.match(invalidStatus.error, /co doctor --json failed/);
    assert.match(invalidStatus.error, /invalid JSON/);
    assert.match(invalidStatus.error, /PATH=/);
  } finally {
    process.env.PATH = previousPath;
  }

  const brokenBinDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbw-co-nonzero-'));
  await writeFakeCommand(brokenBinDir, 'co', '#!/bin/sh\nif [ "$1" = "doctor" ]; then echo doctor-broken >&2; exit 4; fi\nexit 1\n');
  process.env.PATH = brokenBinDir;
  try {
    const brokenStatus = await runCoDoctor({ timeoutMs: 200 });
    assert.equal(brokenStatus.ok, false);
    assert.match(brokenStatus.error, /co doctor --json failed/);
    assert.match(brokenStatus.error, /doctor-broken/);
    assert.match(brokenStatus.error, /PATH=/);
  } finally {
    process.env.PATH = previousPath;
  }
});
