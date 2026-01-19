/**
 * Payment module internal types and interfaces.
 * Re-exports relevant types from the main types module and defines
 * internal types used across payment submodules.
 */

import type { PoolClient } from 'pg';
import type {
  Transaction,
  TransactionStatus,
  CreatePaymentRequest,
  CreatePaymentResponse,
  TransactionListParams,
  LedgerEntry,
} from '../../types/index.js';

// Re-export for convenience
export type {
  Transaction,
  TransactionStatus,
  CreatePaymentRequest,
  CreatePaymentResponse,
  TransactionListParams,
  LedgerEntry,
};

/**
 * Client information for audit logging.
 */
export interface ClientInfo {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Result of fee calculation.
 */
export interface FeeCalculation {
  feeAmount: number;
  netAmount: number;
}

/**
 * Internal payment context passed between submodules.
 */
export interface PaymentContext {
  transactionId: string;
  merchantId: string;
  merchantAccountId: string;
  request: CreatePaymentRequest;
  feeAmount: number;
  netAmount: number;
  clientInfo?: ClientInfo;
}

/**
 * Result from processor authorization.
 */
export interface AuthorizationResult {
  authorized: boolean;
  processorRef?: string;
  declineReason?: string;
}

/**
 * Configuration for fee calculation.
 */
export interface FeeConfig {
  /** Percentage fee charged on each transaction (e.g., 2.9 = 2.9%) */
  feePercent: number;
  /** Fixed fee in cents added to each transaction (e.g., 30 = $0.30) */
  feeFixed: number;
}

// Re-export PoolClient for transaction handling
export type { PoolClient };
