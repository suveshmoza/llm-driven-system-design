import { useState, useEffect, useCallback } from 'react';

/**
 * Return type for the useCountdown hook.
 */
interface CountdownResult {
  /** Number of full days remaining */
  days: number;
  /** Hours remaining (0-23) */
  hours: number;
  /** Minutes remaining (0-59) */
  minutes: number;
  /** Seconds remaining (0-59) */
  seconds: number;
  /** Total seconds until expiration */
  totalSeconds: number;
  /** True if the countdown has reached zero */
  isExpired: boolean;
  /** Human-readable formatted string (e.g., "2d 5h", "45m 30s") */
  formatted: string;
}

/**
 * React hook for countdown timer functionality.
 *
 * This hook is essential for auction UX, providing real-time countdown
 * to auction end times. It updates every second and provides both
 * individual time components and a formatted display string.
 *
 * Used by CountdownTimer component and AuctionCard to show time remaining.
 *
 * @param endTime - ISO date string for when the countdown should reach zero
 * @returns CountdownResult with time components and formatted display
 *
 * @example
 * ```tsx
 * const { hours, minutes, seconds, isExpired, formatted } = useCountdown(auction.end_time);
 *
 * if (isExpired) {
 *   return <span>Auction ended</span>;
 * }
 * return <span>{formatted}</span>;
 * ```
 */
export function useCountdown(endTime: string): CountdownResult {
  /**
   * Calculates the remaining time until the end time.
   * Returns all time components and a formatted string.
   */
  const calculateTimeLeft = useCallback(() => {
    const now = new Date().getTime();
    const end = new Date(endTime).getTime();
    const difference = end - now;

    if (difference <= 0) {
      return {
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        totalSeconds: 0,
        isExpired: true,
        formatted: 'Ended',
      };
    }

    const days = Math.floor(difference / (1000 * 60 * 60 * 24));
    const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((difference % (1000 * 60)) / 1000);
    const totalSeconds = Math.floor(difference / 1000);

    let formatted = '';
    if (days > 0) {
      formatted = `${days}d ${hours}h`;
    } else if (hours > 0) {
      formatted = `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      formatted = `${minutes}m ${seconds}s`;
    } else {
      formatted = `${seconds}s`;
    }

    return {
      days,
      hours,
      minutes,
      seconds,
      totalSeconds,
      isExpired: false,
      formatted,
    };
  }, [endTime]);

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateTimeLeft]);

  return timeLeft;
}
