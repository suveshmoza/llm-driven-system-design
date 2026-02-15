import { useRef, useEffect } from 'react';
import { VideoTile } from './VideoTile';
import { useAuthStore } from '../stores/authStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useMediaStore } from '../stores/mediaStore';

function getGridClasses(count: number): string {
  if (count <= 1) return 'grid-cols-1 grid-rows-1';
  if (count === 2) return 'grid-cols-2 grid-rows-1';
  if (count <= 4) return 'grid-cols-2 grid-rows-2';
  if (count <= 6) return 'grid-cols-3 grid-rows-2';
  if (count <= 9) return 'grid-cols-3 grid-rows-3';
  if (count <= 16) return 'grid-cols-4 grid-rows-4';
  return 'grid-cols-5 auto-rows-fr overflow-y-auto';
}

export function VideoGrid() {
  const { user } = useAuthStore();
  const { participants, screenSharingUserId } = useMeetingStore();
  const { localStream, isMuted, isVideoOn, isHandRaised } = useMediaStore();
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const screenSharer = screenSharingUserId
    ? participants.find((p) => p.userId === screenSharingUserId)
    : null;

  if (screenSharer) {
    return (
      <div className="flex h-full gap-2 p-2">
        {/* Main screen share area */}
        <div className="flex-1 min-w-0">
          <ScreenShareView displayName={screenSharer.displayName} />
        </div>

        {/* Participant strip */}
        <div className="w-48 flex flex-col gap-2 overflow-y-auto">
          {/* Local user */}
          <div className="aspect-video">
            <VideoTile
              displayName={user?.displayName || 'You'}
              isMuted={isMuted}
              isVideoOn={isVideoOn}
              isScreenSharing={false}
              isHandRaised={isHandRaised}
              isLocal
              stream={localStream}
              videoRef={localVideoRef}
            />
          </div>
          {/* Remote participants */}
          {participants
            .filter((p) => p.userId !== user?.id)
            .map((p) => (
              <div key={p.userId} className="aspect-video">
                <VideoTile
                  displayName={p.displayName}
                  isMuted={p.isMuted}
                  isVideoOn={p.isVideoOn}
                  isScreenSharing={p.isScreenSharing}
                  isHandRaised={p.isHandRaised}
                  stream={p.stream}
                />
              </div>
            ))}
        </div>
      </div>
    );
  }

  // Gallery view
  const totalTiles = participants.length;
  const gridClasses = getGridClasses(totalTiles);

  return (
    <div className={`grid ${gridClasses} gap-2 p-2 h-full w-full`}>
      {/* Local user tile */}
      {user && (
        <div className="relative">
          <VideoTile
            displayName={user.displayName || 'You'}
            isMuted={isMuted}
            isVideoOn={isVideoOn}
            isScreenSharing={false}
            isHandRaised={isHandRaised}
            isLocal
            stream={localStream}
            videoRef={localVideoRef}
          />
        </div>
      )}

      {/* Remote participant tiles */}
      {participants
        .filter((p) => p.userId !== user?.id)
        .map((p) => (
          <div key={p.userId} className="relative">
            <VideoTile
              displayName={p.displayName}
              isMuted={p.isMuted}
              isVideoOn={p.isVideoOn}
              isScreenSharing={p.isScreenSharing}
              isHandRaised={p.isHandRaised}
              stream={p.stream}
            />
          </div>
        ))}
    </div>
  );
}

function ScreenShareView({ displayName }: { displayName: string }) {
  return (
    <div className="w-full h-full bg-zoom-surface rounded-lg flex items-center justify-center relative">
      <div className="text-center">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="#2D8CFF" className="mx-auto mb-4">
          <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
        </svg>
        <p className="text-zoom-text text-lg font-medium">{displayName} is sharing their screen</p>
        <p className="text-zoom-secondary text-sm mt-1">Screen content would appear here in production</p>
      </div>
    </div>
  );
}
