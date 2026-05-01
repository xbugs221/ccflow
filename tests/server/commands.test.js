import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  BUILTIN_ALIAS_NAMESPACE,
  builtinAliasBaseDir,
  isCommandPathAllowed,
  scanCommandsDirectory,
} from '../../server/routes/commands.js';

test('built-in aliases are scanned as slash commands', async () => {
  const commands = await scanCommandsDirectory(
    builtinAliasBaseDir,
    builtinAliasBaseDir,
    BUILTIN_ALIAS_NAMESPACE,
  );

  const names = commands.map((command) => command.name).sort();

  assert.deepEqual(names, [
    '/analysis',
    '/apply',
    '/archive',
    '/explore',
    '/fix',
    '/git-clean',
    '/git-review',
    '/git-summary',
    '/propose',
  ]);
  assert.ok(commands.every((command) => command.namespace === BUILTIN_ALIAS_NAMESPACE));
  assert.ok(commands.every((command) => command.description));
});

test('command paths are restricted to command directories', () => {
  assert.equal(
    isCommandPathAllowed(path.join(builtinAliasBaseDir, 'propose.md')),
    true,
  );
  assert.equal(isCommandPathAllowed(path.resolve('package.json')), false);
});
