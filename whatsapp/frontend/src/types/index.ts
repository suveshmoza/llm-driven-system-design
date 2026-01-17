/**
 * Frontend type definitions for the WhatsApp messaging application.
 * These types mirror backend types but with string dates for JSON serialization.
 */

/**
 * Represents a user in the messaging system.
 */
export interface User {
  id: string;
  username: string;
  display_name: string;
  profile_picture_url?: string;
  created_at: string;
  presence?: PresenceInfo;
}

/**
 * User online/offline status and last seen timestamp.
 */
export interface PresenceInfo {
  status: 'online' | 'offline';
  last_seen: number;
}

/**
 * Represents a conversation (1:1 chat or group).
 */
export interface Conversation {
  id: string;
  name?: string;
  is_group: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
  participants?: ConversationParticipant[];
  last_message?: Message;
  unread_count?: number;
}

/**
 * Represents a user's participation in a conversation.
 */
export interface ConversationParticipant {
  id: string;
  user_id: string;
  role: 'admin' | 'member';
  user?: User;
}

/**
 * Message delivery status including frontend-specific 'sending' and 'failed' states.
 */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Represents a chat message in a conversation.
 */
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  content_type: 'text' | 'image' | 'video' | 'file';
  media_url?: string;
  created_at: string;
  status?: MessageStatus;
  sender?: User;
  clientMessageId?: string;
}

/**
 * Base WebSocket message structure for all WS communications.
 */
export interface WSMessage {
  type: string;
  payload: unknown;
  clientMessageId?: string;
}

/**
 * Server acknowledgment when a message is successfully stored.
 */
export interface WSMessageAck {
  type: 'message_ack';
  payload: {
    clientMessageId: string;
    messageId: string;
    status: string;
    createdAt: string;
  };
}

/**
 * Notification that a message was delivered or read.
 */
export interface WSDeliveryReceipt {
  type: 'delivery_receipt' | 'read_receipt';
  payload: {
    messageId: string;
    messageIds?: string[];
    recipientId: string;
    status: 'delivered' | 'read';
    timestamp: string;
  };
}

/**
 * Typing indicator event from another user.
 */
export interface WSTypingEvent {
  type: 'typing' | 'stop_typing';
  payload: {
    conversationId: string;
    userId: string;
  };
}

/**
 * User presence change notification.
 */
export interface WSPresenceEvent {
  type: 'presence';
  payload: {
    userId: string;
    status: 'online' | 'offline';
    timestamp: number;
  };
}

/**
 * Incoming message from the WebSocket server.
 */
export interface WSIncomingMessage {
  type: 'message';
  payload: Message & {
    conversation?: {
      id: string;
      name?: string;
      is_group: boolean;
    };
  };
}
