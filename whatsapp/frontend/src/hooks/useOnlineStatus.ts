import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to track browser online/offline status.
 * Returns the current online status and a method to check connectivity.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);

  const handleOnline = useCallback(() => {
    setIsOnline(true);
    if (!navigator.onLine) {
      setWasOffline(true);
    }
  }, []);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
    setWasOffline(true);
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  /**
   * Actively check if we can reach the server.
   * Useful when navigator.onLine may be unreliable.
   */
  const checkConnectivity = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-store',
      });
      const online = response.ok;
      setIsOnline(online);
      return online;
    } catch {
      setIsOnline(false);
      return false;
    }
  }, []);

  /**
   * Clear the wasOffline flag after showing a reconnection message.
   */
  const clearWasOffline = useCallback(() => {
    setWasOffline(false);
  }, []);

  return {
    isOnline,
    wasOffline,
    checkConnectivity,
    clearWasOffline,
  };
}
