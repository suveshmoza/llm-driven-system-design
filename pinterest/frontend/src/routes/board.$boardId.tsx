import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import * as api from '../services/api';
import MasonryGrid from '../components/MasonryGrid';
import type { Board, Pin } from '../types';

export const Route = createFileRoute('/board/$boardId')({
  component: BoardPage,
});

function BoardPage() {
  const { boardId } = Route.useParams();
  const [board, setBoard] = useState<Board | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getBoard(boardId), api.getBoardPins(boardId)])
      .then(([boardRes, pinsRes]) => {
        setBoard(boardRes.board);
        setPins(pinsRes.pins);
      })
      .catch(() => setBoard(null))
      .finally(() => setLoading(false));
  }, [boardId]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-pinterest-red rounded-full animate-spin" />
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h2 className="text-2xl font-bold mb-2">Board not found</h2>
        <Link to="/" className="text-pinterest-red font-semibold hover:underline mt-4">
          Go home
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Board header */}
      <div className="text-center py-8 px-4">
        <h1 className="text-3xl font-bold">{board.name}</h1>
        {board.description && (
          <p className="text-text-secondary mt-2 max-w-md mx-auto">{board.description}</p>
        )}
        {board.username && (
          <Link
            to="/profile/$username"
            params={{ username: board.username }}
            className="inline-flex items-center gap-2 mt-3 text-sm text-text-secondary hover:text-text-primary"
          >
            <span className="font-semibold">{board.displayName || board.username}</span>
          </Link>
        )}
        <p className="text-text-secondary text-sm mt-2">
          {board.pinCount} {board.pinCount === 1 ? 'Pin' : 'Pins'}
          {board.isPrivate && ' (Private)'}
        </p>
      </div>

      {/* Pins grid */}
      <MasonryGrid pins={pins} />
    </div>
  );
}
