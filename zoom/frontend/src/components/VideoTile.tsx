import { getInitials } from '../utils/format';

interface VideoTileProps {
  displayName: string;
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  isHandRaised: boolean;
  isLocal?: boolean;
  isSpeaking?: boolean;
  stream?: MediaStream | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export function VideoTile({
  displayName,
  isMuted,
  isVideoOn,
  isScreenSharing: _isScreenSharing,
  isHandRaised,
  isLocal,
  stream,
  videoRef,
}: VideoTileProps) {
  return (
    <div className="relative bg-zoom-card rounded-lg overflow-hidden w-full h-full min-h-[120px]">
      {isVideoOn && stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted={isLocal}
          playsInline
          className={`w-full h-full object-cover ${isLocal ? 'transform scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-zoom-surface">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-zoom-primary flex items-center justify-center text-xl md:text-2xl font-bold text-white">
            {getInitials(displayName)}
          </div>
        </div>
      )}

      {/* Bottom bar with name and status */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex items-end justify-between">
        <div className="flex items-center gap-1.5">
          {isMuted && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF1744">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            </svg>
          )}
          <span className="text-xs text-white font-medium truncate max-w-[120px]">
            {displayName}
            {isLocal && ' (You)'}
          </span>
        </div>
      </div>

      {/* Hand raised indicator */}
      {isHandRaised && <HandRaiseIndicator />}
    </div>
  );
}

function HandRaiseIndicator() {
  return (
    <div className="absolute top-2 right-2 bg-yellow-500 rounded-full w-8 h-8 flex items-center justify-center animate-bounce">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
        <path d="M21 7c0-1.38-1.12-2.5-2.5-2.5-.17 0-.34.02-.5.05V4c0-1.38-1.12-2.5-2.5-2.5-.23 0-.46.03-.67.09C14.46.66 13.56 0 12.5 0c-1.23 0-2.25.89-2.46 2.06C9.87 2.02 9.69 2 9.5 2 8.12 2 7 3.12 7 4.5v5.89c-.34-.31-.76-.51-1.22-.51-.73 0-1.38.45-1.64 1.12l-1.89 4.77C2.09 16.26 2 16.76 2 17.27V20c0 2.21 1.79 4 4 4h9c1.71 0 3.23-1.07 3.82-2.67l2.98-8.04C21.93 13.05 22 12.78 22 12.5V9c0-1.38-1.12-2.5-2.5-2.5-.17 0-.34.02-.5.05V7z" />
      </svg>
    </div>
  );
}
