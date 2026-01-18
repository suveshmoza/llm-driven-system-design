import amqplib from 'amqplib';
import config from '../config/index.js';

let connection = null;
let channel = null;

// Queue names
export const QUEUES = {
  ASYNC_TASKS: 'async-tasks',
  NOTIFICATIONS: 'notifications',
  AUDIT_LOG: 'audit-log',
};

/**
 * Connect to RabbitMQ and set up queues
 */
export async function connect() {
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

    connection.on('error', (err) => {
      console.error('RabbitMQ connection error:', err.message);
    });

    connection.on('close', () => {
      console.log('RabbitMQ connection closed');
      connection = null;
      channel = null;
    });

    return { connection, channel };
  } catch (error) {
    console.error('Failed to connect to RabbitMQ:', error.message);
    throw error;
  }
}

/**
 * Get or create channel
 */
export async function getChannel() {
  if (!channel) {
    await connect();
  }
  return channel;
}

/**
 * Publish a message to a queue
 */
async function publish(queue, message) {
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
function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Publish an async task for background processing
 * @param {string} type - Task type (e.g., 'email', 'report', 'cleanup')
 * @param {object} payload - Task-specific data
 * @param {object} options - Optional metadata
 */
export async function publishTask(type, payload, options = {}) {
  const message = {
    id: generateId('task'),
    type,
    payload,
    priority: options.priority || 'normal',
    createdAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries: options.maxRetries || 3,
  };

  await publish(QUEUES.ASYNC_TASKS, message);
  return message.id;
}

/**
 * Publish a notification to be delivered to a user
 * @param {string} userId - Target user ID
 * @param {string} message - Notification message
 * @param {object} options - Optional metadata (channel, priority, etc.)
 */
export async function publishNotification(userId, message, options = {}) {
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
 * @param {string} action - Action performed (e.g., 'user.login', 'resource.create')
 * @param {string} userId - User who performed the action (null for system actions)
 * @param {object} details - Additional context about the action
 */
export async function publishAuditEvent(action, userId, details = {}) {
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

/**
 * Consume messages from a queue
 * @param {string} queue - Queue name
 * @param {function} handler - Message handler function
 * @param {object} options - Consumer options
 */
export async function consume(queue, handler, options = {}) {
  const ch = await getChannel();

  // Prefetch limit for fair dispatch
  await ch.prefetch(options.prefetch || 10);

  return ch.consume(
    queue,
    async (msg) => {
      if (!msg) return;

      try {
        const content = JSON.parse(msg.content.toString());
        await handler(content, msg);
        ch.ack(msg);
      } catch (error) {
        console.error(`Error processing message from ${queue}:`, error.message);

        // Check if we should requeue or dead-letter
        const requeue = !msg.fields.redelivered;
        ch.nack(msg, false, requeue);
      }
    },
    { noAck: false }
  );
}

/**
 * Check RabbitMQ connection health
 */
export async function checkHealth() {
  try {
    const ch = await getChannel();
    // Check queue stats
    const stats = {};
    for (const queueName of Object.values(QUEUES)) {
      const queueInfo = await ch.checkQueue(queueName);
      stats[queueName] = {
        messageCount: queueInfo.messageCount,
        consumerCount: queueInfo.consumerCount,
      };
    }
    return { connected: true, queues: stats };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

/**
 * Close RabbitMQ connection
 */
export async function close() {
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
