import type { ExcalidrawElement, Cursor } from '../types';

export type WsMessageHandler = (message: WsMessage) => void;

export interface WsMessage {
  type: string;
  drawingId?: string;
  userId?: string;
  username?: string;
  elementId?: string;
  elementData?: ExcalidrawElement;
  elements?: ExcalidrawElement[];
  x?: number;
  y?: number;
  color?: string;
  message?: string;
}

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, WsMessageHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private drawingId: string | null = null;
  private userId: string | null = null;
  private username: string | null = null;
  private assignedColor: string = '#6965db';

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    this.ws = new WebSocket(`${protocol}//${host}/ws`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;

      // Re-join room if we were in one
      if (this.drawingId && this.userId) {
        this.joinRoom(this.drawingId, this.userId, this.username || 'Anonymous');
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WsMessage;

        if (message.type === 'connected' && message.color) {
          this.assignedColor = message.color;
        }

        const handlers = this.handlers.get(message.type) || [];
        for (const handler of handlers) {
          handler(message);
        }

        // Also fire catch-all handlers
        const allHandlers = this.handlers.get('*') || [];
        for (const handler of allHandlers) {
          handler(message);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), delay);
      }
    };

    this.ws.onerror = () => {
      // Error handling is done in onclose
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  on(type: string, handler: WsMessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  off(type: string, handler: WsMessageHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    }
  }

  joinRoom(drawingId: string, userId: string, username: string): void {
    this.drawingId = drawingId;
    this.userId = userId;
    this.username = username;

    this.send({
      type: 'join-room',
      drawingId,
      userId,
      username,
    });
  }

  leaveRoom(): void {
    if (this.drawingId) {
      this.send({ type: 'leave-room' });
      this.drawingId = null;
    }
  }

  sendShapeAdd(element: ExcalidrawElement): void {
    this.send({
      type: 'shape-add',
      elementData: element,
    });
  }

  sendShapeUpdate(element: ExcalidrawElement): void {
    this.send({
      type: 'shape-update',
      elementData: element,
    });
  }

  sendShapeDelete(elementId: string): void {
    this.send({
      type: 'shape-delete',
      elementId,
    });
  }

  sendShapeMove(element: ExcalidrawElement): void {
    this.send({
      type: 'shape-move',
      elementData: element,
    });
  }

  sendCursorMove(x: number, y: number): void {
    this.send({
      type: 'cursor-move',
      x,
      y,
    });
  }

  sendElementsSync(elements: ExcalidrawElement[]): void {
    this.send({
      type: 'elements-sync',
      elements,
    });
  }

  getColor(): string {
    return this.assignedColor;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const wsClient = new WebSocketClient();
export default wsClient;
