import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

export function JoinByCode() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toLowerCase().replace(/\s+/g, '-');
    if (cleanCode) {
      navigate({ to: '/meeting/$code', params: { code: cleanCode } });
    }
  };

  return (
    <form onSubmit={handleJoin} className="flex gap-3">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Enter meeting code (e.g., abc-defg-hij)"
        className="flex-1 bg-zoom-surface border border-zoom-card rounded-lg px-4 py-2.5 text-zoom-text placeholder-zoom-secondary focus:outline-none focus:border-zoom-primary transition-colors"
      />
      <button
        type="submit"
        disabled={!code.trim()}
        className="bg-zoom-primary hover:bg-zoom-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
      >
        Join
      </button>
    </form>
  );
}
