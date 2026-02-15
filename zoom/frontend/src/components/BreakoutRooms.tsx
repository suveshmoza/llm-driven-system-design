import { useState } from 'react';

interface BreakoutRoomsProps {
  meetingId: string;
  onCreateRooms: (rooms: { name: string }[]) => void;
  onActivate: () => void;
  onClose: () => void;
}

export function BreakoutRooms({ meetingId: _meetingId, onCreateRooms, onActivate, onClose }: BreakoutRoomsProps) {
  const [roomCount, setRoomCount] = useState(2);
  const [rooms, setRooms] = useState<{ name: string }[]>([]);
  const [created, setCreated] = useState(false);

  const handleCreate = () => {
    const newRooms = Array.from({ length: roomCount }, (_, i) => ({
      name: `Breakout Room ${i + 1}`,
    }));
    setRooms(newRooms);
    onCreateRooms(newRooms);
    setCreated(true);
  };

  return (
    <div className="w-72 bg-zoom-surface border-l border-zoom-card flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zoom-card">
        <h2 className="text-sm font-semibold text-zoom-text">Breakout Rooms</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!created ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-zoom-secondary mb-1">Number of rooms</label>
              <input
                type="number"
                value={roomCount}
                onChange={(e) => setRoomCount(Math.max(2, parseInt(e.target.value) || 2))}
                min={2}
                max={20}
                className="w-20 bg-zoom-card border border-zoom-card rounded px-3 py-2 text-sm text-zoom-text focus:outline-none focus:border-zoom-primary"
              />
            </div>
            <button
              onClick={handleCreate}
              className="w-full bg-zoom-primary hover:bg-zoom-hover text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Create Rooms
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {rooms.map((room, i) => (
              <div key={i} className="bg-zoom-card rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zoom-text font-medium">{room.name}</span>
                  <span className="text-xs text-zoom-secondary">0 participants</span>
                </div>
              </div>
            ))}

            <div className="flex gap-2 mt-4">
              <button
                onClick={onActivate}
                className="flex-1 bg-zoom-green hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Open All
              </button>
              <button
                onClick={() => {
                  onClose();
                  setCreated(false);
                  setRooms([]);
                }}
                className="flex-1 bg-zoom-red hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Close All
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
