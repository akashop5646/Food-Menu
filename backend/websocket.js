import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { parse as parseCookie } from 'cookie';

let wss = null;

export function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    // ponytail: fallback to unauthenticated connection when cross-origin cookies are blocked
    let authenticated = false;
    try {
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        const cookies = parseCookie(cookieHeader);
        const token = cookies.token;
        if (token) {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          ws.userId = decoded.id;
          ws.userRole = decoded.role;
          authenticated = true;
          console.log(`🔌 Authenticated WebSocket client: ${decoded.email} (${decoded.role})`);
        }
      }
    } catch (err) {
      console.warn('🔌 WebSocket auth verification failed, continuing as unauthenticated:', err.message);
    }

    if (!authenticated) {
      console.log('🔌 Unauthenticated WebSocket client connected (read-only notifications)');
    }

    ws.on('error', (error) => {
      console.error('WebSocket client error:', error);
    });

    ws.on('close', () => {
      console.log('🔌 Dashboard WebSocket client disconnected');
    });
  });

  console.log('🚀 WebSocket server initialized successfully (with auth)');
  return wss;
}

let mockBroadcastFn = null;
export function setMockBroadcast(fn) {
  mockBroadcastFn = fn;
}

export function broadcast(type, payload) {
  if (mockBroadcastFn) {
    mockBroadcastFn(type, payload);
    return;
  }
  if (!wss) {
    console.warn('⚠️ WebSocket server not initialized yet');
    return;
  }

  const message = JSON.stringify({ type, payload });
  let count = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      count++;
    }
  });
}
