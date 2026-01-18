/**
 * Preferences route - discovery settings configuration.
 * Allows users to set their matching preferences.
 */
import { createFileRoute, Navigate, Link } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';
import { useState, useEffect } from 'react';
import { userApi } from '../services/api';
import type { UserPreferences } from '../types';
import {
  InterestedInSection,
  AgeRangeSection,
  DistanceSection,
  VisibilitySection,
} from '../components/preferences';

/**
 * Preferences page component.
 * Manages user discovery preferences including:
 * - Gender interests (who to show)
 * - Age range filters
 * - Maximum distance
 * - Profile visibility toggle
 * @returns Preferences form element
 */
function PreferencesPage() {
  const { isAuthenticated } = useAuthStore();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      loadPreferences();
    }
  }, [isAuthenticated]);

  const loadPreferences = async () => {
    try {
      const prefs = await userApi.getPreferences();
      setPreferences(prefs);
    } catch (error) {
      console.error('Failed to load preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!preferences) return;
    setIsSaving(true);
    try {
      await userApi.updatePreferences(preferences);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (updates: Partial<UserPreferences>) => {
    if (!preferences) return;
    setPreferences({ ...preferences, ...updates });
  };

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="w-8 h-8 border-4 border-gradient-start border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!preferences) {
    return <Navigate to="/profile" />;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm px-4 py-3 flex items-center">
        <Link to="/profile" className="mr-3">
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-xl font-bold flex-1">Discovery Preferences</h1>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="text-gradient-start font-medium"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </header>

      {/* Content */}
      <main className="p-4 space-y-4">
        <InterestedInSection preferences={preferences} onChange={handleChange} />
        <AgeRangeSection preferences={preferences} onChange={handleChange} />
        <DistanceSection preferences={preferences} onChange={handleChange} />
        <VisibilitySection preferences={preferences} onChange={handleChange} />
      </main>
    </div>
  );
}

export const Route = createFileRoute('/preferences')({
  component: PreferencesPage,
});
