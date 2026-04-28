/**
 * PURPOSE: Provide shell websocket URL helpers and low-level message parsing.
 */
import { IS_PLATFORM } from '../../../constants/config';
import type { ShellIncomingMessage, ShellOutgoingMessage } from '../types/types';

function isLoopbackBrowserHost(): boolean {
  const hostname = window.location.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function getShellWebSocketUrl(): string | null {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/shell`;
  }

  const token = localStorage.getItem('auth-token');
  if (!token && isLoopbackBrowserHost()) {
    return `${protocol}//${window.location.host}/shell`;
  }

  if (!token) {
    console.error('No authentication token found for Shell WebSocket connection');
    return null;
  }

  return `${protocol}//${window.location.host}/shell?token=${encodeURIComponent(token)}`;
}

export function parseShellMessage(payload: string): ShellIncomingMessage | null {
  try {
    return JSON.parse(payload) as ShellIncomingMessage;
  } catch {
    return null;
  }
}

export function sendSocketMessage(ws: WebSocket | null, message: ShellOutgoingMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return;
  }

  console.warn('[Shell] Dropped socket message because websocket is not open:', message.type, ws?.readyState);
}
