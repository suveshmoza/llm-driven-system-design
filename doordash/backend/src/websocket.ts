import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

// Store WebSocket connections by user and type
const connections: Map<string, Set<WebSocket>> = new Map();

interface WebSocketMessage {
  type: string;
  channel?: string;
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');

    const subscriptions: Set<string> = new Set();

    ws.on('message', (data: Buffer) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'subscribe':
            // Subscribe to updates for a specific entity
            // e.g., { type: 'subscribe', channel: 'order:123' }
            // or { type: 'subscribe', channel: 'driver_location:456' }
            if (message.channel) {
              subscriptions.add(message.channel);
              if (!connections.has(message.channel)) {
                connections.set(message.channel, new Set());
              }
              connections.get(message.channel)!.add(ws);
              console.log(`Subscribed to ${message.channel}`);
            }
            break;

          case 'unsubscribe':
            if (message.channel && connections.has(message.channel)) {
              subscriptions.delete(message.channel);
              connections.get(message.channel)!.delete(ws);
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            console.log('Unknown message type:', message.type);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      // Clean up subscriptions
      for (const channel of subscriptions) {
        if (connections.has(channel)) {
          connections.get(channel)!.delete(ws);
          if (connections.get(channel)!.size === 0) {
            connections.delete(channel);
          }
        }
      }
      console.log('WebSocket client disconnected');
    });

    ws.on('error', (err: Error) => {
      console.error('WebSocket error:', err);
    });
  });

  return wss;
}

// Broadcast a message to all subscribers of a channel
export function broadcast(channel: string, message: unknown): void {
  if (connections.has(channel)) {
    const messageStr = JSON.stringify(message);
    for (const ws of connections.get(channel)!) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    }
  }
}

// Broadcast to multiple channels
export function broadcastToChannels(channels: string[], message: unknown): void {
  for (const channel of channels) {
    broadcast(channel, message);
  }
}

export default { setupWebSocket, broadcast, broadcastToChannels };
