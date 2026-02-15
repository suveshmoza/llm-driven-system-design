import { useState, useEffect } from 'react';
import { projectsApi } from '../services/api';

interface ConnectionStatusProps {
  projectId: string;
}

/** Displays the database connection status for a project with a colored indicator. */
export function ConnectionStatus({ projectId }: ConnectionStatusProps) {
  const [status, setStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const check = async () => {
      setStatus('checking');
      try {
        const result = await projectsApi.testConnection(projectId);
        if (result.success) {
          setStatus('connected');
        } else {
          setStatus('error');
          setErrorMsg(result.error || 'Connection failed');
        }
      } catch {
        setStatus('error');
        setErrorMsg('Failed to test connection');
      }
    };
    check();
  }, [projectId]);

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${
        status === 'connected' ? 'bg-supabase-success' :
        status === 'error' ? 'bg-supabase-danger' :
        'bg-supabase-warning animate-pulse'
      }`} />
      <span className="text-sm text-supabase-secondary" title={errorMsg}>
        {status === 'connected' ? 'Connected' :
         status === 'error' ? 'Disconnected' :
         'Checking...'}
      </span>
    </div>
  );
}
