/**
 * PURPOSE: Validate live Claude model catalog discovery from configured APIs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { getClaudeModelCatalog } from '../../server/claude-models.js';

function createFetchResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('Claude catalog fetches Kimi-compatible models from configured API', async () => {
  /**
   * Provider-specific models must come from the model-list API response.
   */
  const requests = [];
  const catalog = await getClaudeModelCatalog({
    env: {},
    settings: {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/v1',
        ANTHROPIC_API_KEY: 'redacted',
      },
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, headers: options.headers });
      return createFetchResponse(200, {
        data: [
          { id: 'kimi-live-model', display_name: 'Kimi Live Model' },
          { id: 'kimi-second-model' },
        ],
      });
    },
  });

  assert.equal(requests[0].url, 'https://api.kimi.com/coding/v1/models');
  assert.equal(requests[0].headers.Authorization, 'Bearer redacted');
  assert.equal(catalog.source, 'provider-models-api');
  assert.equal(catalog.defaultModel, 'kimi-live-model');
  assert.deepEqual(catalog.models, [
    { value: 'kimi-live-model', label: 'Kimi Live Model' },
    { value: 'kimi-second-model', label: 'Kimi Second Model' },
  ]);
});

test('Claude catalog uses configured model only when provider returns it', async () => {
  /**
   * A configured model is not blindly injected into the available list.
   */
  const catalog = await getClaudeModelCatalog({
    env: {},
    settings: {
      env: {
        ANTHROPIC_BASE_URL: 'https://example.test/anthropic',
        ANTHROPIC_API_KEY: 'redacted',
        ANTHROPIC_MODEL: 'vendor-custom-model',
      },
    },
    fetchImpl: async () => createFetchResponse(200, {
      data: [
        { id: 'vendor-first-model' },
        { id: 'vendor-custom-model', name: 'Vendor Custom' },
      ],
    }),
  });

  assert.equal(catalog.defaultModel, 'vendor-custom-model');
  assert.deepEqual(catalog.models, [
    { value: 'vendor-first-model', label: 'Vendor First Model' },
    { value: 'vendor-custom-model', label: 'Vendor Custom' },
  ]);
});

test('Claude catalog does not invent models when model API is unavailable', async () => {
  /**
   * The frontend should not show hardcoded models as if they were available.
   */
  const catalog = await getClaudeModelCatalog({
    env: {},
    settings: {
      env: {
        ANTHROPIC_BASE_URL: 'https://example.test/anthropic',
        ANTHROPIC_API_KEY: 'redacted',
      },
    },
    fetchImpl: async () => createFetchResponse(500, { error: 'down' }),
  });

  assert.equal(catalog.defaultModel, '');
  assert.equal(catalog.source, 'provider-models-api-unavailable');
  assert.equal(catalog.fetchError, 'http-500');
  assert.deepEqual(catalog.models, []);
});
