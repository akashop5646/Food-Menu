const rawApiUrl = import.meta.env.VITE_API_URL || '';
export const API_BASE = rawApiUrl.endsWith('/') ? rawApiUrl.slice(0, -1) : rawApiUrl;

let wsUrlDerived = '';
if (API_BASE) {
  try {
    const parsedUrl = new URL(API_BASE);
    const protocol = parsedUrl.protocol === 'https:' ? 'wss' : 'ws';
    wsUrlDerived = `${protocol}://${parsedUrl.host}`;
  } catch (e) {
    console.error('Invalid VITE_API_URL format for WebSocket derivation:', e);
  }
}

export const getWebSocketUrl = () => {
  if (wsUrlDerived) {
    return wsUrlDerived;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  let wsUrl = `${protocol}://${window.location.host}`;
  if (window.location.port === '3000') {
    wsUrl = `${protocol}://${window.location.hostname}:5000`;
  }
  return wsUrl;
};
