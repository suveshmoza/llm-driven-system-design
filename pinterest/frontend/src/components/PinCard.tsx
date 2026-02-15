import { useState, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import type { Pin } from '../types';

interface PinCardProps {
  pin: Pin;
  onSave?: (pinId: string) => void;
}

/** Renders a pin card with image, dominant color placeholder, save button, and metadata overlay. */
export default function PinCard({ pin, onSave }: PinCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const aspectRatio = pin.aspectRatio || 1;
  const paddingBottom = `${aspectRatio * 100}%`;

  const handleSave = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onSave?.(pin.id);
    },
    [pin.id, onSave],
  );

  return (
    <div
      className="pin-card group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Link to="/pin/$pinId" params={{ pinId: pin.id }}>
        {/* Image with aspect ratio placeholder */}
        <div
          className="relative w-full rounded-2xl overflow-hidden"
          style={{
            paddingBottom,
            backgroundColor: pin.dominantColor || '#e8e8e8',
          }}
        >
          <img
            src={pin.imageUrl}
            alt={pin.title || 'Pin'}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
          />

          {/* Hover overlay */}
          {isHovered && (
            <div className="absolute inset-0 bg-black/40 flex flex-col justify-between p-3 transition-opacity">
              {/* Save button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  className="save-btn text-sm px-4 py-2"
                >
                  {pin.isSaved ? 'Saved' : 'Save'}
                </button>
              </div>

              {/* Bottom info */}
              <div className="flex items-center justify-between">
                {pin.linkUrl && (
                  <div className="flex items-center gap-1 bg-white/90 rounded-full px-3 py-1 text-xs font-semibold text-text-primary truncate max-w-[60%]">
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="truncate">{new URL(pin.linkUrl).hostname}</span>
                  </div>
                )}
                <button className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Pin info below image */}
        <div className="px-1 py-2">
          {pin.title && (
            <h3 className="text-sm font-semibold text-text-primary line-clamp-2">
              {pin.title}
            </h3>
          )}
          <div className="flex items-center gap-2 mt-1">
            <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden">
              {pin.avatarUrl ? (
                <img src={pin.avatarUrl} alt={pin.username} className="w-full h-full object-cover" />
              ) : (
                pin.username[0].toUpperCase()
              )}
            </div>
            <span className="text-xs text-text-secondary truncate">{pin.displayName}</span>
          </div>
        </div>
      </Link>
    </div>
  );
}
