/**
 * PURPOSE: Verify legacy Claude history readers are no longer active project sources.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { getSessionMessages } from '../../server/projects.ts';

test('legacy Claude session history reader is unsupported', async () => {
  await assert.rejects(
    () => getSessionMessages('legacy-project', 'legacy-session'),
    /Claude session history is no longer supported/,
  );
});
