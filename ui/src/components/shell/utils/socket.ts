import { IS_PLATFORM } from '../../../constants/config';
import { appWebSocketUrl } from '../../../utils/api';
import type { ShellIncomingMessage, ShellOutgoingMessage } from '../types/types';

export function getShellWebSocketUrl(): string | null {
  const token = localStorage.getItem('auth-token');

  if (IS_PLATFORM || !token) {
    return appWebSocketUrl('/shell');
  }

  return appWebSocketUrl(`/shell?token=${encodeURIComponent(token)}`);
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
  }
}
