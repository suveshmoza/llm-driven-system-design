import type { Board } from '../types';
import BoardCard from './BoardCard';

interface BoardGridProps {
  boards: Board[];
}

export default function BoardGrid({ boards }: BoardGridProps) {
  if (boards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-text-secondary">No boards yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 px-4">
      {boards.map((board) => (
        <BoardCard key={board.id} board={board} />
      ))}
    </div>
  );
}
