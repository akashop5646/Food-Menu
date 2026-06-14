import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { parse as parseCookie } from 'cookie';

let wss = null;

export function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    // H4 fix: Authenticate WebSocket connections via cookie token
    try {
      const cookieHeader = req.headers.cookie;
      if (!cookieHeader) {
        ws.close(1008, 'Authentication required');
        return;
      }

      const cookies = parseCookie(cookieHeader);
      const token = cookies.token;
      if (!token) {
        ws.close(1008, 'Authentication required');
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      ws.userId = decoded.id;
      ws.userRole = decoded.role;

      console.log(`🔌 Authenticated WebSocket client: ${decoded.email} (${decoded.role})`);
    } catch (err) {
      console.warn('🔌 WebSocket auth failed:', err.message);
      ws.close(1008, 'Invalid or expired token');
      return;
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

export function broadcast(type, payload) {
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
