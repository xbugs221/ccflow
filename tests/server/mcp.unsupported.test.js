/**
 * PURPOSE: Verify legacy Claude MCP REST endpoints are explicitly unsupported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import mcpRoutes from '../../server/routes/mcp.js';

async function request(pathname, method = 'GET') {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('legacy Claude MCP CLI endpoints return unsupported', async () => {
  const response = await request('/api/mcp/cli/list');

  assert.equal(response.status, 410);
  assert.equal(response.body.error, 'Claude MCP endpoints are no longer supported');
});

test('legacy Claude MCP config read endpoint returns unsupported', async () => {
  const response = await request('/api/mcp/config/read');

  assert.equal(response.status, 410);
  assert.equal(response.body.error, 'Claude MCP endpoints are no longer supported');
});
