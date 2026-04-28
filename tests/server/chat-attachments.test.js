/**
 * PURPOSE: Verify chat attachments are persisted under ~/ccflow-uploads with
 * folder-relative paths preserved, and that provider prompt notes expose paths.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { appendAttachmentNote, persistChatUploads } from '../../server/chat-attachments.js';

/**
 * Create a temporary source file that simulates multer's staged upload output.
 */
async function createStagedUpload(filename, content) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccflow-chat-upload-'));
  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, content, 'utf8');
  return {
    filePath,
    cleanup: async () => fs.rm(tempDir, { recursive: true, force: true }),
  };
}

test('persistChatUploads keeps nested relative paths under the chat upload root', async () => {
  const first = await createStagedUpload('alpha.txt', 'alpha');
  const second = await createStagedUpload('beta.txt', 'beta');

  let persistedRootPath = null;
  try {
    const result = await persistChatUploads([
      {
        path: first.filePath,
        originalname: 'alpha.txt',
        size: 5,
        mimetype: 'text/plain',
      },
      {
        path: second.filePath,
        originalname: 'beta.txt',
        size: 4,
        mimetype: 'text/plain',
      },
    ], {
      relativePaths: ['folder/alpha.txt', 'folder/nested/beta.txt'],
      userId: 'test-user',
    });

    persistedRootPath = result.rootPath;

    assert.equal(result.attachments.length, 2);
    assert.match(result.attachments[0].relativePath, /^folder\/[a-f0-9]{20}\.txt$/);
    assert.match(result.attachments[1].relativePath, /^folder\/nested\/[a-f0-9]{20}\.txt$/);
    assert.equal(result.attachments[0].originalName, 'alpha.txt');
    assert.equal(result.attachments[1].originalName, 'beta.txt');
    assert.match(result.rootPath, /ccflow-uploads/);
    assert.equal(await fs.readFile(result.attachments[1].absolutePath, 'utf8'), 'beta');
  } finally {
    await first.cleanup();
    await second.cleanup();
    if (persistedRootPath) {
      await fs.rm(persistedRootPath, { recursive: true, force: true });
    }
  }
});

test('persistChatUploads does not overwrite same-named files within one batch', async () => {
  const first = await createStagedUpload('image.png', 'first-image');
  const second = await createStagedUpload('image.png', 'second-image');

  let persistedRootPath = null;
  try {
    const result = await persistChatUploads([
      {
        path: first.filePath,
        originalname: 'image.png',
        size: 11,
        mimetype: 'image/png',
      },
      {
        path: second.filePath,
        originalname: 'image.png',
        size: 12,
        mimetype: 'image/png',
      },
    ], {
      relativePaths: ['screenshots/image.png', 'screenshots/image.png'],
      userId: 'test-user',
    });

    persistedRootPath = result.rootPath;

    assert.equal(result.attachments.length, 2);
    assert.notEqual(result.attachments[0].absolutePath, result.attachments[1].absolutePath);
    assert.notEqual(result.attachments[0].relativePath, result.attachments[1].relativePath);
    assert.equal(result.attachments[0].originalName, 'image.png');
    assert.equal(result.attachments[1].originalName, 'image.png');
    assert.equal(await fs.readFile(result.attachments[0].absolutePath, 'utf8'), 'first-image');
    assert.equal(await fs.readFile(result.attachments[1].absolutePath, 'utf8'), 'second-image');
  } finally {
    await first.cleanup();
    await second.cleanup();
    if (persistedRootPath) {
      await fs.rm(persistedRootPath, { recursive: true, force: true });
    }
  }
});

test('appendAttachmentNote adds persisted file paths to the agent prompt', () => {
  const prompt = appendAttachmentNote('请分析上传内容', [
    {
      name: 'report.csv',
      relativePath: 'samples/report.csv',
      absolutePath: '/home/test/ccflow-uploads/u1/report.csv',
      mimeType: 'text/csv',
      size: 128,
    },
  ]);

  assert.match(prompt, /请分析上传内容/);
  assert.match(prompt, /\[User uploaded files for this message\]/);
  assert.match(prompt, /samples\/report\.csv/);
  assert.match(prompt, /\/home\/test\/ccflow-uploads\/u1\/report\.csv/);
});
