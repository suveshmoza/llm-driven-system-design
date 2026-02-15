import amqplib, { Channel, Connection } from 'amqplib';
import { config } from '../config/index.js';
import { logger } from './logger.js';

let connection: Connection | null = null;
let channel: Channel | null = null;

export async function connectQueue(): Promise<Channel | null> {
  try {
    connection = await amqplib.connect(config.rabbitmq.url);
    channel = await connection.createChannel();

    await channel.assertQueue(config.rabbitmq.pageIndexQueue, {
      durable: true,
    });

    logger.info('Connected to RabbitMQ');
    return channel;
  } catch (err) {
    logger.warn({ err }, 'RabbitMQ connection failed - search indexing will be skipped');
    return null;
  }
}

export async function publishToQueue(queue: string, message: unknown): Promise<void> {
  if (!channel) {
    logger.warn('RabbitMQ channel not available, skipping message publish');
    return;
  }

  try {
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to publish message to RabbitMQ');
  }
}

export function getChannel(): Channel | null {
  return channel;
}

export async function closeQueue(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch (err) {
    logger.error({ err }, 'Error closing RabbitMQ connection');
  }
}
