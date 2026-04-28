import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoidGVzdHVzZXIiLCJpYXQiOjE3NzczNTQ2NjJ9.wzxC9D3rs5rWUprUtG9ZQhwS407igQuEeAByFnu0pNk';
const PROJECT_DIR = path.join(process.cwd(), '.ccflow');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Connecting to ws://localhost:4001/ws...');
  
  const ws = new WebSocket(`ws://localhost:4001/ws?token=${TOKEN}`);
  let sessionId = null;
  let messageCount = 0;
  
  return new Promise((resolve) => {
    ws.on('open', () => {
      console.log('Connected!');
      
      const clientRequestId = `test-${Date.now()}`;
      const msg = {
        type: 'claude-command',
        clientRequestId,
        command: 'Say exactly "ok" and nothing else.',
        options: {
          projectPath: process.cwd(),
          cwd: process.cwd(),
          projectName: process.cwd().replace(/^\//, '').replace(/\//g, '-'),
          sessionId: null,
          clientRequestId,
          resume: false,
          toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true },
          permissionMode: 'bypassPermissions',
          model: 'kimi-k2.6',
          thinkingMode: 'medium',
          attachments: []
        }
      };
      
      console.log('Sending claude-command with thinkingMode=medium');
      ws.send(JSON.stringify(msg));
    });
    
    ws.on('message', (data) => {
      messageCount++;
      const text = data.toString();
      try {
        const obj = JSON.parse(text);
        const type = obj.type || obj.event;
        if (type === 'session-created') {
          sessionId = obj.sessionId;
          console.log('Session created:', sessionId);
        }
        console.log(`MSG #${messageCount}:`, type, obj.sessionId || '');
        
        if (type === 'claude-complete' || type === 'claude-error') {
          console.log('Session ended');
          setTimeout(() => {
            ws.close();
            checkJsonl();
            resolve();
          }, 2000);
        }
      } catch {
        console.log(`MSG #${messageCount}:`, text.substring(0, 200));
      }
    });
    
    ws.on('error', (err) => console.error('ERR:', err.message));
    ws.on('close', (code, reason) => {
      console.log('CLOSED:', code, reason.toString());
    });
    
    // 超时检查
    setTimeout(() => {
      console.log('Timeout, checking jsonl...');
      ws.terminate();
      checkJsonl();
      resolve();
    }, 60000);
  });
  
  function checkJsonl() {
    console.log('\n=== Checking JSONL files ===');
    const files = fs.readdirSync(PROJECT_DIR).filter(f => f.endsWith('.jsonl'));
    console.log('Found jsonl files:', files.length);
    
    for (const file of files) {
      const p = path.join(PROJECT_DIR, file);
      const stat = fs.statSync(p);
      const age = (Date.now() - stat.mtimeMs) / 1000;
      if (age < 180) {
        console.log(`\n--- ${file} (${age.toFixed(0)}s ago) ---`);
        const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
        console.log('Lines:', lines.length);
        
        // 找 effort/thinking 相关
        let found = false;
        for (let i = 0; i < lines.length; i++) {
          try {
            const obj = JSON.parse(lines[i]);
            if (obj.effort !== undefined || obj.thinkingMode !== undefined || 
                obj.options?.effort !== undefined || obj.options?.thinkingMode !== undefined) {
              found = true;
              console.log(`Line ${i+1}:`, JSON.stringify({
                type: obj.type,
                effort: obj.effort,
                thinkingMode: obj.thinkingMode,
                optionsEffort: obj.options?.effort,
                optionsThinkingMode: obj.options?.thinkingMode
              }));
            }
          } catch {}
        }
        if (!found) {
          console.log('No effort/thinking fields found');
          const first = JSON.parse(lines[0]);
          console.log('First line keys:', Object.keys(first).join(', '));
        }
      }
    }
  }
}

main().catch(console.error);
