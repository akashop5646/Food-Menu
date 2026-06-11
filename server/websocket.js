import { WebSocketServer, WebSocket } from 'ws';

let wss = null;

export function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('🔌 New dashboard WebSocket client connected');

    ws.on('error', (error) => {
      console.error('WebSocket client error:', error);
    });

    ws.on('close', () => {
      console.log('🔌 Dashboard WebSocket client disconnected');
    });
  });

  console.log('🚀 WebSocket server initialized successfully');
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
