import { useState, useEffect } from 'react';
import * as api from '../services/api';
import type { PageVersion } from '../types';
import { formatFullDate } from '../utils/format';
import { useAuthStore } from '../stores/authStore';

interface VersionListProps {
  pageId: string;
  currentVersion: number;
}

/** Renders a timeline of page versions with restore-to-previous capability. */
export default function VersionList({ pageId, currentVersion }: VersionListProps) {
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  useEffect(() => {
    setLoading(true);
    api.getVersionHistory(pageId).then(({ versions: v }) => {
      setVersions(v);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [pageId]);

  const handleRestore = async (versionNumber: number) => {
    if (!confirm(`Restore version ${versionNumber}? This will create a new version with the old content.`)) {
      return;
    }

    try {
      await api.restoreVersion(pageId, versionNumber);
      // Reload versions
      const { versions: v } = await api.getVersionHistory(pageId);
      setVersions(v);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restore version');
    }
  };

  if (loading) {
    return <div className="text-confluence-text-subtle text-sm">Loading version history...</div>;
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-confluence-text mb-4">
        Version History ({versions.length} version{versions.length !== 1 ? 's' : ''})
      </h3>

      <div className="space-y-0">
        {versions.map((version, index) => (
          <div
            key={version.id}
            className={`flex items-start gap-4 p-4 border-b border-confluence-border ${
              index === 0 ? 'bg-confluence-info bg-opacity-30' : ''
            }`}
          >
            {/* Timeline dot */}
            <div className="flex flex-col items-center shrink-0 mt-1">
              <div
                className={`w-3 h-3 rounded-full ${
                  index === 0 ? 'bg-confluence-primary' : 'bg-confluence-text-muted'
                }`}
              />
              {index < versions.length - 1 && (
                <div className="w-0.5 h-8 bg-confluence-border mt-1" />
              )}
            </div>

            {/* Version info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-confluence-text">
                  v{version.version_number}
                </span>
                {index === 0 && (
                  <span className="text-xs px-2 py-0.5 bg-confluence-primary text-white rounded">
                    Current
                  </span>
                )}
              </div>
              <p className="text-sm text-confluence-text-subtle">
                {version.change_message || 'No change description'}
              </p>
              <div className="text-xs text-confluence-text-muted mt-1">
                {version.author_username} - {formatFullDate(version.created_at)}
              </div>
            </div>

            {/* Restore button */}
            {user && version.version_number !== currentVersion && (
              <button
                onClick={() => handleRestore(version.version_number)}
                className="text-xs px-3 py-1 text-confluence-primary border border-confluence-primary rounded hover:bg-confluence-info transition-colors shrink-0"
              >
                Restore
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
