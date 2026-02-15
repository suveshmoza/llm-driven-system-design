import { Kafka, Producer, Consumer, logLevel } from 'kafkajs';
import { config } from '../config/index.js';

const kafka = new Kafka({
  clientId: config.kafka.clientId,
  brokers: config.kafka.brokers,
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 100,
    retries: 5,
  },
});

let producer: Producer | null = null;
let consumer: Consumer | null = null;

/** Returns the singleton Kafka producer, connecting on first call. */
export async function getProducer(): Promise<Producer> {
  if (!producer) {
    producer = kafka.producer();
    await producer.connect();
  }
  return producer;
}

/** Returns the singleton Kafka consumer for the given group, connecting on first call. */
export async function getConsumer(groupId: string): Promise<Consumer> {
  if (!consumer) {
    consumer = kafka.consumer({ groupId });
    await consumer.connect();
  }
  return consumer;
}

/**
 * Publishes a JSON message to a Kafka topic.
 * @param topic - Kafka topic name.
 * @param key - Message key for partitioning.
 * @param value - Message payload as a plain object.
 */
export async function publishMessage(
  topic: string,
  key: string,
  value: Record<string, unknown>
): Promise<void> {
  try {
    const prod = await getProducer();
    await prod.send({
      topic,
      messages: [
        {
          key,
          value: JSON.stringify(value),
        },
      ],
    });
  } catch (error) {
    console.error('Failed to publish Kafka message:', error);
  }
}

/** Gracefully disconnects the Kafka producer and consumer. */
export async function disconnectKafka(): Promise<void> {
  if (producer) await producer.disconnect();
  if (consumer) await consumer.disconnect();
}

export { kafka };
