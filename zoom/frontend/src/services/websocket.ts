type MessageHandler = (message: Record<string, unknown>) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private userId: string | null = null;
  private username: string | null = null;

  connect(userId: string, username: string): Promise<void> {
    this.userId = userId;
    this.username = username;

    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const host = window.location.host;
      const url = `${protocol}://${host}/ws?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        reject(err);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.dispatch(message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.dispatch({ type: 'connection-closed', code: event.code, reason: event.reason });

        if (event.code !== 4001 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.attemptReconnect();
        }
      };
    });
  }

  private attemptReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (this.userId && this.username) {
        this.connect(this.userId, this.username).catch((err) => {
          console.error('Reconnection failed:', err);
        });
      }
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.userId = null;
    this.username = null;
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnect
  }

  send(message: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, cannot send:', message);
    }
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  off(type: string, handler: MessageHandler) {
    const handlers = this.handlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private dispatch(message: Record<string, unknown>) {
    const type = message.type as string;
    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        handler(message);
      }
    }

    // Also dispatch to '*' handlers (catch-all)
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(message);
      }
    }
  }

  // Signaling methods
  joinMeeting(meetingCode: string, displayName: string) {
    this.send({ type: 'join-meeting', meetingCode, displayName });
  }

  leaveMeeting() {
    this.send({ type: 'leave-meeting' });
  }

  produce(kind: 'audio' | 'video' | 'screen', rtpParameters?: unknown) {
    this.send({ type: 'produce', kind, rtpParameters: rtpParameters || {} });
  }

  consume(producerId: string) {
    this.send({ type: 'consume', producerId });
  }

  closeProducer(producerId: string) {
    this.send({ type: 'producer-close', producerId });
  }

  toggleMute(muted: boolean) {
    this.send({ type: 'toggle-mute', muted });
  }

  toggleVideo(videoOn: boolean) {
    this.send({ type: 'toggle-video', videoOn });
  }

  startScreenShare() {
    this.send({ type: 'start-screen-share' });
  }

  stopScreenShare() {
    this.send({ type: 'stop-screen-share' });
  }

  raiseHand(raised: boolean) {
    this.send({ type: 'raise-hand', raised });
  }

  sendChatMessage(content: string, recipientId?: string) {
    this.send({ type: 'chat-message', content, recipientId });
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

/** Singleton WebSocket client for real-time meeting signaling and chat. */
export const wsClient = new WebSocketClient();
