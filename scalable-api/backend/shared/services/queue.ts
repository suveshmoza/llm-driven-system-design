import amqplib, { type Channel, type ConsumeMessage, type ChannelModel } from 'amqplib';
import config from '../config/index.js';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

// Queue names
export const QUEUES = {
  ASYNC_TASKS: 'async-tasks',
  NOTIFICATIONS: 'notifications',
  AUDIT_LOG: 'audit-log',
};

/**
 * Connect to RabbitMQ and set up queues
 */
export async function connect(): Promise<{ connection: ChannelModel; channel: Channel }> {
  if (connection && channel) {
    return { connection, channel };
  }

  try {
    const url = config.rabbitmq?.url || 'amqp://guest:guest@localhost:5672';
    connection = await amqplib.connect(url);
    channel = await connection.createChannel();

    // Set up queues with durability for persistence
    for (const queueName of Object.values(QUEUES)) {
      await channel.assertQueue(queueName, {
        durable: true, // Survives broker restart
        arguments: {
          'x-message-ttl': 86400000, // 24 hour TTL
          'x-max-length': 100000, // Max 100k messages
        },
      });
    }

    console.log('Connected to RabbitMQ');

    connection.on('error', (err: Error) => {
      console.error('RabbitMQ connection error:', err.message);
    });

    connection.on('close', () => {
      console.log('RabbitMQ connection closed');
      connection = null;
      channel = null;
    });

    return { connection, channel };
  } catch (error) {
    console.error('Failed to connect to RabbitMQ:', (error as Error).message);
    throw error;
  }
}

/**
 * Get or create channel
 */
export async function getChannel(): Promise<Channel> {
  if (!channel) {
    await connect();
  }
  return channel!;
}

/**
 * Publish a message to a queue
 */
async function publish(queue: string, message: unknown): Promise<boolean> {
  const ch = await getChannel();
  const content = Buffer.from(JSON.stringify(message));

  return ch.sendToQueue(queue, content, {
    persistent: true, // Message survives broker restart
    contentType: 'application/json',
    timestamp: Date.now(),
  });
}

/**
 * Generate unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface TaskOptions {
  priority?: string;
  maxRetries?: number;
  id?: string;
  type?: string;
  payload?: unknown;
  retryCount?: number;
}

/**
 * Publish an async task for background processing
 * @param type - Task type (e.g., 'email', 'report', 'cleanup')
 * @param payload - Task-specific data
 * @param options - Optional metadata
 */
export async function publishTask(type: string, payload: unknown, options: TaskOptions = {}): Promise<string> {
  const message = {
    id: options.id || generateId('task'),
    type,
    payload,
    priority: options.priority || 'normal',
    createdAt: new Date().toISOString(),
    retryCount: options.retryCount ?? 0,
    maxRetries: options.maxRetries || 3,
  };

  await publish(QUEUES.ASYNC_TASKS, message);
  return message.id;
}

interface NotificationOptions {
  channel?: string;
  priority?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Publish a notification to be delivered to a user
 * @param userId - Target user ID
 * @param message - Notification message
 * @param options - Optional metadata (channel, priority, etc.)
 */
export async function publishNotification(userId: string, message: string, options: NotificationOptions = {}): Promise<string> {
  const notification = {
    id: generateId('notif'),
    userId,
    message,
    channel: options.channel || 'in-app', // in-app, email, push, sms
    priority: options.priority || 'normal',
    createdAt: new Date().toISOString(),
    metadata: options.metadata || {},
  };

  await publish(QUEUES.NOTIFICATIONS, notification);
  return notification.id;
}

/**
 * Publish an audit event for compliance and security logging
 * @param action - Action performed (e.g., 'user.login', 'resource.create')
 * @param userId - User who performed the action (null for system actions)
 * @param details - Additional context about the action
 */
export async function publishAuditEvent(action: string, userId: string | null, details: Record<string, unknown> = {}): Promise<string> {
  const event = {
    id: generateId('audit'),
    action,
    userId,
    details,
    timestamp: new Date().toISOString(),
    instanceId: config.instanceId,
  };

  await publish(QUEUES.AUDIT_LOG, event);
  return event.id;
}

interface ConsumeOptions {
  prefetch?: number;
}

/**
 * Consume messages from a queue
 * @param queue - Queue name
 * @param handler - Message handler function
 * @param options - Consumer options
 */
export async function consume<T>(
  queue: string,
  handler: (content: T, msg: ConsumeMessage) => Promise<void>,
  options: ConsumeOptions = {}
): Promise<{ consumerTag: string }> {
  const ch = await getChannel();

  // Prefetch limit for fair dispatch
  await ch.prefetch(options.prefetch || 10);

  return ch.consume(
    queue,
    async (msg) => {
      if (!msg) return;

      try {
        const content = JSON.parse(msg.content.toString()) as T;
        await handler(content, msg);
        ch.ack(msg);
      } catch (error) {
        console.error(`Error processing message from ${queue}:`, (error as Error).message);

        // Check if we should requeue or dead-letter
        const requeue = !msg.fields.redelivered;
        ch.nack(msg, false, requeue);
      }
    },
    { noAck: false }
  );
}

interface QueueStats {
  [queueName: string]: {
    messageCount: number;
    consumerCount: number;
  };
}

/**
 * Check RabbitMQ connection health
 */
export async function checkHealth(): Promise<{ connected: boolean; queues?: QueueStats; error?: string }> {
  try {
    const ch = await getChannel();
    // Check queue stats
    const stats: QueueStats = {};
    for (const queueName of Object.values(QUEUES)) {
      const queueInfo = await ch.checkQueue(queueName);
      stats[queueName] = {
        messageCount: queueInfo.messageCount,
        consumerCount: queueInfo.consumerCount,
      };
    }
    return { connected: true, queues: stats };
  } catch (error) {
    return { connected: false, error: (error as Error).message };
  }
}

/**
 * Close RabbitMQ connection
 */
export async function close(): Promise<void> {
  if (channel) {
    await channel.close();
    channel = null;
  }
  if (connection) {
    await connection.close();
    connection = null;
  }
  console.log('RabbitMQ connection closed');
}

export default {
  connect,
  getChannel,
  publishTask,
  publishNotification,
  publishAuditEvent,
  consume,
  checkHealth,
  close,
  QUEUES,
};
