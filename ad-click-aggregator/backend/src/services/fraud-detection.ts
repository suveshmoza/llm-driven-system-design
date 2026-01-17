/**
 * @fileoverview Fraud detection service for identifying invalid ad clicks.
 * Implements velocity-based detection (clicks per IP/user) and pattern matching.
 * Protects advertisers from click fraud and bots while allowing legitimate traffic.
 */

import type { ClickEvent, FraudDetectionResult } from '../types/index.js';
import { trackIpClicks, trackUserClicks } from './redis.js';

/** Maximum clicks per IP per minute before flagging as fraud */
const IP_CLICK_THRESHOLD = 100;

/** Maximum clicks per user per minute before flagging as fraud */
const USER_CLICK_THRESHOLD = 50;

/**
 * In-memory set of known fraudulent IP hashes.
 * In production, this would be backed by a database or external service.
 */
const KNOWN_FRAUDULENT_IPS = new Set<string>();

/**
 * In-memory set of known fraudulent user IDs.
 * In production, this would be backed by a database or external service.
 */
const KNOWN_FRAUDULENT_USERS = new Set<string>();

/**
 * Context for fraud checks including request metadata.
 */
export interface FraudCheckContext {
  ipHash?: string;
  userId?: string;
  deviceType?: string;
  country?: string;
  timestamp: Date;
}

/**
 * Analyzes a click event for potential fraud using multiple detection strategies.
 * Checks against known bad actors, velocity limits, and suspicious patterns.
 * Returns confidence score (0-1) indicating likelihood of fraud.
 *
 * @param click - The click event to analyze
 * @returns Detection result with fraud flag, reason, and confidence score
 */
export async function detectFraud(click: ClickEvent): Promise<FraudDetectionResult> {
  const reasons: string[] = [];
  let confidence = 0;

  // Check for known fraudulent IPs
  if (click.ip_hash && KNOWN_FRAUDULENT_IPS.has(click.ip_hash)) {
    reasons.push('known_fraudulent_ip');
    confidence = Math.max(confidence, 0.95);
  }

  // Check for known fraudulent users
  if (click.user_id && KNOWN_FRAUDULENT_USERS.has(click.user_id)) {
    reasons.push('known_fraudulent_user');
    confidence = Math.max(confidence, 0.95);
  }

  // Check click velocity per IP
  if (click.ip_hash) {
    const ipClickCount = await trackIpClicks(click.ip_hash);
    if (ipClickCount > IP_CLICK_THRESHOLD) {
      reasons.push(`ip_click_flood:${ipClickCount}`);
      confidence = Math.max(confidence, Math.min(0.9, 0.5 + (ipClickCount - IP_CLICK_THRESHOLD) * 0.01));
    }
  }

  // Check click velocity per user
  if (click.user_id) {
    const userClickCount = await trackUserClicks(click.user_id);
    if (userClickCount > USER_CLICK_THRESHOLD) {
      reasons.push(`user_click_flood:${userClickCount}`);
      confidence = Math.max(confidence, Math.min(0.9, 0.5 + (userClickCount - USER_CLICK_THRESHOLD) * 0.02));
    }
  }

  // Check for suspicious patterns (simplified version)
  // In production, this would involve ML models
  if (isSuspiciousPattern(click)) {
    reasons.push('suspicious_pattern');
    confidence = Math.max(confidence, 0.6);
  }

  return {
    is_fraudulent: reasons.length > 0 && confidence > 0.5,
    reason: reasons.length > 0 ? reasons.join(', ') : undefined,
    confidence,
  };
}

/**
 * Identifies suspicious click patterns that may indicate bot activity.
 * Checks for timing anomalies and missing device fingerprint data.
 * In production, this would integrate with ML models.
 *
 * @param click - The click event to analyze
 * @returns True if suspicious patterns detected, false otherwise
 */
function isSuspiciousPattern(click: ClickEvent): boolean {
  // Check for suspicious timing patterns (e.g., exactly on the second)
  const ms = click.timestamp.getMilliseconds();
  if (ms === 0 || ms === 500) {
    return true;
  }

  // Check for missing expected fields (bots often have incomplete data)
  if (!click.device_type && !click.os && !click.browser) {
    return true;
  }

  return false;
}

/**
 * Adds an IP hash to the known fraudulent list.
 * All future clicks from this IP will be flagged with high confidence.
 *
 * @param ipHash - Hashed IP address to flag
 */
export function flagFraudulentIp(ipHash: string): void {
  KNOWN_FRAUDULENT_IPS.add(ipHash);
}

/**
 * Adds a user ID to the known fraudulent list.
 * All future clicks from this user will be flagged with high confidence.
 *
 * @param userId - User identifier to flag
 */
export function flagFraudulentUser(userId: string): void {
  KNOWN_FRAUDULENT_USERS.add(userId);
}

/**
 * Checks if an IP hash is in the known fraudulent list.
 *
 * @param ipHash - Hashed IP address to check
 * @returns True if IP is flagged as fraudulent
 */
export function isIpFlagged(ipHash: string): boolean {
  return KNOWN_FRAUDULENT_IPS.has(ipHash);
}

/**
 * Checks if a user ID is in the known fraudulent list.
 *
 * @param userId - User identifier to check
 * @returns True if user is flagged as fraudulent
 */
export function isUserFlagged(userId: string): boolean {
  return KNOWN_FRAUDULENT_USERS.has(userId);
}
