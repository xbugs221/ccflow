/**
 * E2E test: verify thinking mode is persisted to jsonl
 * Connects via WebSocket to /ws, sends claude-command with thinkingMode
 */
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'ws://localhost:4001/ws';
const PROJECT_DIR = process.cwd();
const CCFLOW_DIR = path.join(PROJECT_DIR, '.ccflow');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForJsonl(sessionId, timeout = 60000) {
  const jsonlPath = path.join(CCFLOW_DIR, `${sessionId}.jsonl`);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(jsonlPath)) {
      return jsonlPath;
    }
    await sleep(500);
  }
  return null;
}

async function runTest() {
  console.log('=== E2E Thinking Mode Test ===\n');

  // 1. Connect WebSocket (no token needed for localhost)
  console.log('Connecting to WebSocket:', BASE_URL);
  const ws = new WebSocket(BASE_URL);

  let sessionId = null;
  let responseComplete = false;
  let claudeError = null;

  // Set up message handler BEFORE waiting for open
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'session-created') {
      sessionId = msg.sessionId;
      console.log('Session created:', sessionId);
    }
    if (msg.type === 'claude-complete') {
      responseComplete = true;
      console.log('Response complete');
    }
    if (msg.type === 'claude-error') {
      claudeError = msg.error;
      responseComplete = true;
      console.error('Claude error:', msg.error);
    }
    if (msg.type === 'claude-response') {
      // Log the response text
      const text = msg.data?.text || msg.data?.content || '';
      if (text) {
        console.log('Response text:', text.slice(0, 100));
      }
    }
  });

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('WebSocket connected');
      resolve();
    });
    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
      reject(err);
    });
  });

  // 2. Send message with thinkingMode = 'medium'
  const testCommand = 'Say exactly "test-medium" and nothing else.';
  console.log('\n--- Test 1: MEDIUM thinking mode ---');
  console.log('Sending:', testCommand);

  ws.send(JSON.stringify({
    type: 'claude-command',
    command: testCommand,
    options: {
      projectPath: PROJECT_DIR,
      projectName: process.cwd().replace(/^\//, '').replace(/\//g, '-'),
      thinkingMode: 'medium',
      clientRequestId: `test-medium-${Date.now()}`
    }
  }));

  // Wait for completion
  console.log('Waiting for response (up to 60s)...');
  const startWait = Date.now();
  while (!responseComplete && Date.now() - startWait < 60000) {
    await sleep(500);
  }

  if (!responseComplete) {
    console.error('Timeout waiting for response');
  }

  // 3. Check jsonl for effort field
  if (sessionId) {
    console.log('\n--- Checking jsonl for effort field ---');
    const jsonlPath = await waitForJsonl(sessionId, 30000);
    if (jsonlPath) {
      console.log('JSONL file:', jsonlPath);
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.trim().split('\n');
      console.log('Total lines:', lines.length);

      let foundEffort = false;
      for (let i = 0; i < lines.length; i++) {
        try {
          const obj = JSON.parse(lines[i]);
          if (obj.effort !== undefined) {
            foundEffort = true;
            console.log(`Line ${i + 1}: effort = "${obj.effort}"`);
          }
          if (obj.options && obj.options.effort !== undefined) {
            foundEffort = true;
            console.log(`Line ${i + 1}: options.effort = "${obj.options.effort}"`);
          }
          if (obj.thinkingMode !== undefined) {
            console.log(`Line ${i + 1}: thinkingMode = "${obj.thinkingMode}"`);
          }
        } catch {}
      }

      if (!foundEffort) {
        console.log('No effort field found in jsonl');
        if (lines.length > 0) {
          console.log('First line keys:', Object.keys(JSON.parse(lines[0])).join(', '));
        }
      }
    } else {
      console.log('No jsonl file found for session:', sessionId);
    }
  } else {
    console.log('No session ID captured');
  }

  if (claudeError) {
    console.log('\nSkipping HIGH test due to error');
    ws.close();
    console.log('\n=== TEST COMPLETE ===');
    console.log('JSONL file path:', sessionId ? path.join(CCFLOW_DIR, `${sessionId}.jsonl`) : 'N/A');
    return;
  }

  // 4. Test HIGH mode
  console.log('\n--- Test 2: HIGH thinking mode ---');
  responseComplete = false;
  const prevSessionId = sessionId;

  ws.send(JSON.stringify({
    type: 'claude-command',
    command: 'Say exactly "test-high" and nothing else.',
    options: {
      projectPath: PROJECT_DIR,
      projectName: process.cwd().replace(/^\//, '').replace(/\//g, '-'),
      thinkingMode: 'high',
      sessionId: prevSessionId,
      clientRequestId: `test-high-${Date.now()}`
    }
  }));

  const startWait2 = Date.now();
  while (!responseComplete && Date.now() - startWait2 < 60000) {
    await sleep(500);
  }

  if (prevSessionId) {
    const jsonlPath = path.join(CCFLOW_DIR, `${prevSessionId}.jsonl`);
    if (fs.existsSync(jsonlPath)) {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.trim().split('\n');
      console.log('\nTotal lines after HIGH:', lines.length);

      for (let i = 0; i < lines.length; i++) {
        try {
          const obj = JSON.parse(lines[i]);
          if (obj.effort !== undefined) {
            console.log(`Line ${i + 1}: effort = "${obj.effort}"`);
          }
        } catch {}
      }
    }
  }

  ws.close();
  console.log('\n=== TEST COMPLETE ===');
  console.log('JSONL file path:', sessionId ? path.join(CCFLOW_DIR, `${sessionId}.jsonl`) : 'N/A');
}

runTest().catch(console.error);
