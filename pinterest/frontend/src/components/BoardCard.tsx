import { Link } from '@tanstack/react-router';
import type { Board } from '../types';

interface BoardCardProps {
  board: Board;
}

export default function BoardCard({ board }: BoardCardProps) {
  return (
    <Link
      to="/board/$boardId"
      params={{ boardId: board.id }}
      className="block group"
    >
      <div className="rounded-2xl overflow-hidden bg-gray-100 aspect-[4/3] flex items-center justify-center relative">
        {board.coverImageUrl ? (
          <img
            src={board.coverImageUrl}
            alt={board.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        )}
      </div>
      <div className="mt-2 px-1">
        <h3 className="font-bold text-base truncate">{board.name}</h3>
        <p className="text-text-secondary text-xs">
          {board.pinCount} {board.pinCount === 1 ? 'Pin' : 'Pins'}
        </p>
      </div>
    </Link>
  );
}
