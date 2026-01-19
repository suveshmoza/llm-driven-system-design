import { circuitBreaker, handleAll, ConsecutiveBreaker, CircuitBreakerPolicy, CircuitState, FailureReason } from 'cockatiel';
import { createLogger } from './logger.js';
import { circuitBreakerState, circuitBreakerStateChanges } from './metrics.js';
import { Logger } from 'pino';

const log: Logger = createLogger('circuit-breaker');

// Circuit breaker states as numbers for Prometheus
const STATES: Record<CircuitState, number> = {
  [CircuitState.Closed]: 0,
  [CircuitState.Open]: 1,
  [CircuitState.HalfOpen]: 2,
  [CircuitState.Isolated]: 3,
};

// Map CircuitState enum to string names for logging
const STATE_NAMES: Record<CircuitState, string> = {
  [CircuitState.Closed]: 'closed',
  [CircuitState.Open]: 'open',
  [CircuitState.HalfOpen]: 'halfOpen',
  [CircuitState.Isolated]: 'isolated',
};

export interface CircuitBreakerOptions {
  consecutiveFailures?: number;
  halfOpenAfter?: number;
}

interface CircuitBreakerEntry {
  policy: CircuitBreakerPolicy;
  lastState: CircuitState;
  options: CircuitBreakerOptions;
}

// Store circuit breakers for each channel provider
const circuitBreakers: Map<string, CircuitBreakerEntry> = new Map();

/**
 * Create a circuit breaker for a delivery channel
 *
 * Configuration rationale:
 * - consecutiveFailures: 5 - Opens after 5 consecutive failures to prevent cascading issues
 * - halfOpenAfter: 30s - Wait 30 seconds before testing if service has recovered
 * - Half-open allows 3 test requests before fully closing
 */
export function createCircuitBreaker(
  channel: string,
  options: CircuitBreakerOptions = {}
): CircuitBreakerPolicy {
  const {
    consecutiveFailures = 5,
    halfOpenAfter = 30000, // 30 seconds
  } = options;

  // Use consecutive breaker strategy - opens after N consecutive failures
  const breaker = new ConsecutiveBreaker(consecutiveFailures);

  const policy = circuitBreaker(handleAll, {
    halfOpenAfter,
    breaker,
  });

  // Set initial state
  circuitBreakerState.labels(channel).set(STATES[CircuitState.Closed]);

  // Listen to state changes for logging and metrics
  policy.onStateChange((state: CircuitState) => {
    const previousState = circuitBreakers.get(channel)?.lastState ?? CircuitState.Closed;
    const newState = state;
    const previousStateName = STATE_NAMES[previousState];
    const newStateName = STATE_NAMES[newState];

    log.warn({
      channel,
      previousState: previousStateName,
      newState: newStateName,
      timestamp: new Date().toISOString(),
    }, `Circuit breaker state changed: ${previousStateName} -> ${newStateName}`);

    // Update Prometheus metrics
    circuitBreakerState.labels(channel).set(STATES[newState] ?? 0);
    circuitBreakerStateChanges.labels(channel, previousStateName, newStateName).inc();

    // Store last known state
    const entry = circuitBreakers.get(channel);
    if (entry) {
      entry.lastState = newState;
    }
  });

  // Listen to circuit break events
  policy.onBreak((result: FailureReason<unknown> | { isolated: true }) => {
    const errorMessage = 'error' in result ? result.error?.message : 'Unknown error';
    log.error({
      channel,
      error: errorMessage,
    }, `Circuit breaker opened for channel: ${channel}`);
  });

  // Listen to circuit reset events
  policy.onReset(() => {
    log.info({
      channel,
    }, `Circuit breaker closed for channel: ${channel}`);
  });

  // Listen to half-open events
  policy.onHalfOpen(() => {
    log.info({
      channel,
    }, `Circuit breaker half-open for channel: ${channel}`);
  });

  // Store the circuit breaker
  circuitBreakers.set(channel, {
    policy,
    lastState: CircuitState.Closed,
    options,
  });

  return policy;
}

/**
 * Get or create a circuit breaker for a channel
 */
export function getCircuitBreaker(channel: string): CircuitBreakerPolicy {
  if (!circuitBreakers.has(channel)) {
    return createCircuitBreaker(channel);
  }
  return circuitBreakers.get(channel)!.policy;
}

/**
 * Execute an operation with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  channel: string,
  operation: () => Promise<T>
): Promise<T> {
  const policy = getCircuitBreaker(channel);

  try {
    return await policy.execute(async () => {
      return await operation();
    });
  } catch (error) {
    // Check if it's a circuit breaker rejection
    if ((error as Error).name === 'BrokenCircuitError') {
      log.warn({
        channel,
      }, `Request rejected by circuit breaker for channel: ${channel}`);

      throw new CircuitBreakerOpenError(channel);
    }
    throw error;
  }
}

/**
 * Get the current state of a circuit breaker
 */
export function getCircuitBreakerState(channel: string): string {
  if (!circuitBreakers.has(channel)) {
    return 'closed';
  }
  return STATE_NAMES[circuitBreakers.get(channel)!.lastState];
}

/**
 * Get all circuit breaker states
 */
export function getAllCircuitBreakerStates(): Record<string, string> {
  const states: Record<string, string> = {};
  for (const [channel, cb] of circuitBreakers) {
    states[channel] = STATE_NAMES[cb.lastState];
  }
  return states;
}

/**
 * Custom error for circuit breaker open state
 */
export class CircuitBreakerOpenError extends Error {
  public channel: string;
  public retryable: boolean;

  constructor(channel: string) {
    super(`Circuit breaker is open for channel: ${channel}`);
    this.name = 'CircuitBreakerOpenError';
    this.channel = channel;
    this.retryable = true; // Can be retried later
  }
}

// Initialize circuit breakers for standard channels
export function initializeCircuitBreakers(): void {
  const channels = ['push', 'email', 'sms'];
  const configs: Record<string, CircuitBreakerOptions> = {
    push: { consecutiveFailures: 5, halfOpenAfter: 30000 },
    email: { consecutiveFailures: 3, halfOpenAfter: 60000 }, // Email provider more sensitive
    sms: { consecutiveFailures: 3, halfOpenAfter: 60000 },   // SMS provider more sensitive
  };

  for (const channel of channels) {
    createCircuitBreaker(channel, configs[channel]);
    log.info({ channel, config: configs[channel] }, `Initialized circuit breaker for ${channel}`);
  }
}

export default {
  createCircuitBreaker,
  getCircuitBreaker,
  withCircuitBreaker,
  getCircuitBreakerState,
  getAllCircuitBreakerStates,
  initializeCircuitBreakers,
  CircuitBreakerOpenError,
};
