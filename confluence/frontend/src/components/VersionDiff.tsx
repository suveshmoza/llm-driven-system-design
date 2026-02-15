import { useState, useEffect } from 'react';
import * as api from '../services/api';
import type { PageVersion, DiffResult } from '../types';

interface VersionDiffProps {
  pageId: string;
  currentVersion: number;
}

/** Displays a side-by-side diff between two selected page versions. */
export default function VersionDiff({ pageId, currentVersion }: VersionDiffProps) {
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [fromVersion, setFromVersion] = useState<number>(Math.max(1, currentVersion - 1));
  const [toVersion, setToVersion] = useState<number>(currentVersion);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getVersionHistory(pageId).then(({ versions: v }) => {
      setVersions(v);
      if (v.length >= 2) {
        setFromVersion(v[1].version_number);
        setToVersion(v[0].version_number);
      }
    });
  }, [pageId]);

  useEffect(() => {
    if (fromVersion && toVersion && fromVersion !== toVersion) {
      setLoading(true);
      api.getVersionDiff(pageId, fromVersion, toVersion).then(({ diff: d }) => {
        setDiff(d);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [pageId, fromVersion, toVersion]);

  if (versions.length < 2) {
    return (
      <div className="text-confluence-text-subtle text-sm">
        Need at least 2 versions to compare. Current page only has {versions.length} version(s).
      </div>
    );
  }

  return (
    <div>
      {/* Version selectors */}
      <div className="flex items-center gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-confluence-text-subtle mb-1">
            From version
          </label>
          <select
            value={fromVersion}
            onChange={(e) => setFromVersion(parseInt(e.target.value))}
            className="px-3 py-1.5 text-sm border border-confluence-border rounded focus:outline-none focus:ring-2 focus:ring-confluence-primary"
          >
            {versions.map((v) => (
              <option key={v.version_number} value={v.version_number}>
                v{v.version_number} - {v.change_message || 'No message'}
              </option>
            ))}
          </select>
        </div>

        <div className="text-confluence-text-muted mt-4">vs</div>

        <div>
          <label className="block text-xs font-medium text-confluence-text-subtle mb-1">
            To version
          </label>
          <select
            value={toVersion}
            onChange={(e) => setToVersion(parseInt(e.target.value))}
            className="px-3 py-1.5 text-sm border border-confluence-border rounded focus:outline-none focus:ring-2 focus:ring-confluence-primary"
          >
            {versions.map((v) => (
              <option key={v.version_number} value={v.version_number}>
                v{v.version_number} - {v.change_message || 'No message'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Diff display */}
      {loading ? (
        <div className="text-confluence-text-subtle text-sm">Computing diff...</div>
      ) : diff ? (
        <div className="border border-confluence-border rounded-lg overflow-hidden">
          {diff.titleChanged && (
            <div className="px-4 py-2 bg-confluence-sidebar border-b border-confluence-border text-sm">
              <span className="font-medium">Title changed:</span>{' '}
              <span className="diff-removed line-through px-1">{diff.fromTitle}</span>{' '}
              <span className="diff-added px-1">{diff.toTitle}</span>
            </div>
          )}

          <div className="font-mono text-sm">
            {diff.changes.map((change, i) => {
              const lines = change.value.split('\n').filter((l) => l.length > 0 || i < diff.changes.length - 1);

              return lines.map((line, j) => (
                <div
                  key={`${i}-${j}`}
                  className={`px-4 py-0.5 ${
                    change.added
                      ? 'diff-added'
                      : change.removed
                        ? 'diff-removed'
                        : 'bg-white'
                  }`}
                >
                  <span className="select-none inline-block w-6 text-confluence-text-muted text-right mr-3">
                    {change.added ? '+' : change.removed ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                </div>
              ));
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
