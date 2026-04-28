import WebSocket from 'ws';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoidGVzdHVzZXIiLCJpYXQiOjE3NzczNTQ2NjJ9.wzxC9D3rs5rWUprUtG9ZQhwS407igQuEeAByFnu0pNk';

const ws = new WebSocket('ws://localhost:4001/ws?token=' + TOKEN);

ws.on('open', () => {
  console.log('WS connected');
  const req = {
    type: 'claude-command',
    clientRequestId: 'test-' + Date.now(),
    command: 'Say ok',
    options: {
      projectPath: process.cwd(),
      cwd: process.cwd(),
      projectName: process.cwd().replace(/^\//, '').replace(/\//g, '-'),
      sessionId: null,
      clientRequestId: 'test-' + Date.now(),
      resume: false,
      toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true },
      permissionMode: 'bypassPermissions',
      model: 'kimi-k2.6',
      thinkingMode: 'medium',
      attachments: []
    }
  };
  ws.send(JSON.stringify(req));
  console.log('Sent:', req.type, 'thinkingMode=', req.options.thinkingMode);
});

ws.on('message', (d) => {
  const text = d.toString();
  try {
    const obj = JSON.parse(text);
    console.log('MSG:', obj.type || obj.event, obj.sessionId || '');
  } catch {
    console.log('MSG:', text.substring(0, 200));
  }
});

ws.on('error', (e) => console.error('ERR:', e.message));
ws.on('close', (c, r) => console.log('CLOSE:', c, r.toString()));

setTimeout(() => { console.log('Timeout'); ws.terminate(); }, 15000);
