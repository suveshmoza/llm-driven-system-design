import { useState, useEffect, useCallback } from 'react';
import type { MediaDeviceOption } from '../types';
import { useMediaStore } from '../stores/mediaStore';

export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceOption[]>([]);
  const {
    localStream,
    setLocalStream,
    isMuted,
    setIsMuted,
    isVideoOn,
    setIsVideoOn,
    selectedCamera,
    setSelectedCamera,
    selectedMic,
    setSelectedMic,
  } = useMediaStore();

  const enumerateDevices = useCallback(async () => {
    try {
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      const filtered = mediaDevices
        .filter((d) => d.kind === 'audioinput' || d.kind === 'videoinput' || d.kind === 'audiooutput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `${d.kind} (${d.deviceId.substring(0, 5)}...)`,
          kind: d.kind as MediaDeviceOption['kind'],
        }));
      setDevices(filtered);
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }, []);

  const getUserMedia = useCallback(
    async (videoDeviceId?: string, audioDeviceId?: string) => {
      try {
        // Stop existing tracks
        if (localStream) {
          localStream.getTracks().forEach((track) => track.stop());
        }

        const constraints: MediaStreamConstraints = {
          video: videoDeviceId
            ? { deviceId: { exact: videoDeviceId } }
            : true,
          audio: audioDeviceId
            ? { deviceId: { exact: audioDeviceId } }
            : true,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setLocalStream(stream);

        // Apply current mute/video state
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !isMuted;
        });
        stream.getVideoTracks().forEach((track) => {
          track.enabled = isVideoOn;
        });

        // Re-enumerate to get proper labels
        await enumerateDevices();

        return stream;
      } catch (err) {
        console.error('Failed to get user media:', err);
        return null;
      }
    },
    [localStream, isMuted, isVideoOn, setLocalStream, enumerateDevices]
  );

  const toggleMute = useCallback(() => {
    if (localStream) {
      const newMuted = !isMuted;
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !newMuted;
      });
      setIsMuted(newMuted);
      return newMuted;
    }
    return isMuted;
  }, [localStream, isMuted, setIsMuted]);

  const toggleVideo = useCallback(() => {
    if (localStream) {
      const newVideoOn = !isVideoOn;
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = newVideoOn;
      });
      setIsVideoOn(newVideoOn);
      return newVideoOn;
    }
    return isVideoOn;
  }, [localStream, isVideoOn, setIsVideoOn]);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      setSelectedCamera(deviceId);
      await getUserMedia(deviceId, selectedMic || undefined);
    },
    [setSelectedCamera, getUserMedia, selectedMic]
  );

  const selectMic = useCallback(
    async (deviceId: string) => {
      setSelectedMic(deviceId);
      await getUserMedia(selectedCamera || undefined, deviceId);
    },
    [setSelectedMic, getUserMedia, selectedCamera]
  );

  // Listen for device changes
  useEffect(() => {
    navigator.mediaDevices?.addEventListener('devicechange', enumerateDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', enumerateDevices);
    };
  }, [enumerateDevices]);

  return {
    devices,
    localStream,
    isMuted,
    isVideoOn,
    selectedCamera,
    selectedMic,
    enumerateDevices,
    getUserMedia,
    toggleMute,
    toggleVideo,
    selectCamera,
    selectMic,
  };
}
