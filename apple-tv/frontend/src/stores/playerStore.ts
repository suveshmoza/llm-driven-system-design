import { create } from 'zustand';
import type { Content, EncodedVariant } from '../types';
import { streamingApi, watchProgressApi } from '../services/api';

/**
 * Video player state interface for managing playback controls and settings.
 * Handles video playback, quality selection, audio/subtitle tracks, and progress persistence.
 */
interface PlayerState {
  /** Currently loaded content being played */
  content: Content | null;
  /** HLS manifest URL for adaptive streaming */
  manifestUrl: string | null;
  /** Whether video is currently playing */
  isPlaying: boolean;
  /** Current playback position in seconds */
  currentTime: number;
  /** Total duration of content in seconds */
  duration: number;
  /** Volume level (0-1) */
  volume: number;
  /** Whether audio is muted */
  isMuted: boolean;
  /** Whether player is in fullscreen mode */
  isFullscreen: boolean;
  /** Currently selected video quality variant */
  selectedVariant: EncodedVariant | null;
  /** Currently selected audio track ID */
  selectedAudioTrack: string | null;
  /** Currently selected subtitle track ID (null for off) */
  selectedSubtitle: string | null;
  /** Loading state for content initialization */
  isLoading: boolean;
  /** Error message from playback failures */
  error: string | null;

  /** Loads content and playback info, restores saved progress */
  loadContent: (contentId: string) => Promise<void>;
  /** Starts playback */
  play: () => void;
  /** Pauses playback */
  pause: () => void;
  /** Toggles play/pause state */
  togglePlay: () => void;
  /** Seeks to a specific time in seconds */
  seek: (time: number) => void;
  /** Sets volume level (0-1) */
  setVolume: (volume: number) => void;
  /** Toggles audio mute state */
  toggleMute: () => void;
  /** Sets fullscreen mode */
  setFullscreen: (fullscreen: boolean) => void;
  /** Updates current playback time */
  updateTime: (time: number) => void;
  /** Sets content duration */
  setDuration: (duration: number) => void;
  /** Selects a video quality variant */
  selectVariant: (variant: EncodedVariant) => void;
  /** Selects an audio track */
  selectAudioTrack: (trackId: string) => void;
  /** Selects a subtitle track (null to disable) */
  selectSubtitle: (subtitleId: string | null) => void;
  /** Persists current progress to server */
  saveProgress: () => Promise<void>;
  /** Resets player state for new content */
  reset: () => void;
}

/**
 * Video player store using Zustand for managing playback state.
 * Handles adaptive bitrate streaming controls and progress persistence.
 *
 * Key features:
 * - Resume playback from saved position
 * - Quality selection for different network conditions
 * - Audio track and subtitle selection
 * - Periodic progress saving for cross-device sync
 */
export const usePlayerStore = create<PlayerState>()((set, get) => ({
  content: null,
  manifestUrl: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  isFullscreen: false,
  selectedVariant: null,
  selectedAudioTrack: null,
  selectedSubtitle: null,
  isLoading: false,
  error: null,

  loadContent: async (contentId: string) => {
    set({ isLoading: true, error: null });
    try {
      const playbackInfo = await streamingApi.getPlaybackInfo(contentId);

      // Get saved progress
      const progress = await watchProgressApi.getContentProgress(contentId);

      set({
        content: playbackInfo.content,
        manifestUrl: playbackInfo.manifestUrl,
        currentTime: progress.position || 0,
        duration: playbackInfo.content.duration,
        isLoading: false,
      });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),

  seek: (time: number) => {
    const { duration } = get();
    const clampedTime = Math.max(0, Math.min(time, duration));
    set({ currentTime: clampedTime });
  },

  setVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ volume: clampedVolume, isMuted: clampedVolume === 0 });
  },

  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

  setFullscreen: (fullscreen: boolean) => set({ isFullscreen: fullscreen }),

  updateTime: (time: number) => set({ currentTime: time }),

  setDuration: (duration: number) => set({ duration }),

  selectVariant: (variant: EncodedVariant) => set({ selectedVariant: variant }),

  selectAudioTrack: (trackId: string) => set({ selectedAudioTrack: trackId }),

  selectSubtitle: (subtitleId: string | null) => set({ selectedSubtitle: subtitleId }),

  saveProgress: async () => {
    const { content, currentTime, duration } = get();
    if (content && currentTime > 0) {
      try {
        await watchProgressApi.updateProgress(content.id, Math.floor(currentTime), duration);
      } catch (error) {
        console.error('Failed to save progress:', error);
      }
    }
  },

  reset: () =>
    set({
      content: null,
      manifestUrl: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      selectedVariant: null,
      selectedAudioTrack: null,
      selectedSubtitle: null,
      isLoading: false,
      error: null,
    }),
}));
