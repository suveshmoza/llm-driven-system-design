import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useMediaStore } from '../stores/mediaStore';
import { wsClient } from '../services/websocket';
import * as api from '../services/api';
import { MeetingLobby } from '../components/MeetingLobby';
import { VideoGrid } from '../components/VideoGrid';
import { ControlBar } from '../components/ControlBar';
import { ChatPanel } from '../components/ChatPanel';
import { ParticipantList } from '../components/ParticipantList';
import { BreakoutRooms } from '../components/BreakoutRooms';
import type { Participant, ChatMessage, Meeting } from '../types';

export const Route = createFileRoute('/meeting/$code')({
  component: MeetingPage,
});

function MeetingPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    meeting,
    setMeeting,
    isInMeeting,
    setIsInMeeting,
    setParticipants,
    addParticipant,
    removeParticipant,
    updateParticipant,
    addChatMessage,
    isChatOpen,
    isParticipantListOpen,
    isBreakoutOpen,
    reset: resetMeeting,
  } = useMeetingStore();
  const { reset: resetMedia } = useMediaStore();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [meetingTitle, setMeetingTitle] = useState('');

  // Load meeting info
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || user.username);

    api.getMeetingByCode(code).then(({ meeting: m }) => {
      const meetingData: Meeting = {
        id: m.id as string,
        meetingCode: (m.meeting_code as string) || '',
        title: (m.title as string) || 'Meeting',
        hostId: (m.host_id as string) || '',
        scheduledStart: (m.scheduled_start as string) || null,
        scheduledEnd: (m.scheduled_end as string) || null,
        actualStart: (m.actual_start as string) || null,
        actualEnd: (m.actual_end as string) || null,
        status: (m.status as Meeting['status']) || 'scheduled',
        settings: (m.settings as Meeting['settings']) || { waitingRoom: false, muteOnEntry: false, allowScreenShare: true, maxParticipants: 100 },
        createdAt: (m.created_at as string) || '',
      };
      setMeeting(meetingData);
      setMeetingTitle(meetingData.title);
      setLoading(false);
    }).catch(() => {
      setError('Meeting not found');
      setLoading(false);
    });

    return () => {
      // Clean up on unmount
      if (wsClient.isConnected) {
        wsClient.leaveMeeting();
        wsClient.disconnect();
      }
      resetMeeting();
      resetMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user]);

  // Set up WebSocket event handlers
  const setupWsHandlers = useCallback(() => {
    wsClient.on('joined', (msg) => {
      const participants: Participant[] = (msg.participants as Array<Record<string, unknown>>).map((p) => ({
        id: '',
        userId: p.userId as string,
        displayName: p.displayName as string,
        role: (p.role as Participant['role']) || 'participant',
        isMuted: (p.isMuted as boolean) || false,
        isVideoOn: p.isVideoOn !== false,
        isScreenSharing: (p.isScreenSharing as boolean) || false,
        isHandRaised: (p.isHandRaised as boolean) || false,
      }));
      setParticipants(participants);
      setIsInMeeting(true);
      setJoining(false);
    });

    wsClient.on('participant-joined', (msg) => {
      const p: Participant = {
        id: '',
        userId: msg.userId as string,
        displayName: msg.displayName as string,
        role: (msg.role as Participant['role']) || 'participant',
        isMuted: false,
        isVideoOn: true,
        isScreenSharing: false,
        isHandRaised: false,
      };
      addParticipant(p);
    });

    wsClient.on('participant-left', (msg) => {
      removeParticipant(msg.userId as string);
    });

    wsClient.on('participant-update', (msg) => {
      const updates: Partial<Participant> = {};
      if (msg.isMuted !== undefined) updates.isMuted = msg.isMuted as boolean;
      if (msg.isVideoOn !== undefined) updates.isVideoOn = msg.isVideoOn as boolean;
      if (msg.isScreenSharing !== undefined) updates.isScreenSharing = msg.isScreenSharing as boolean;
      if (msg.isHandRaised !== undefined) updates.isHandRaised = msg.isHandRaised as boolean;
      updateParticipant(msg.userId as string, updates);
    });

    wsClient.on('chat-message', (msg) => {
      const chatMsg: ChatMessage = {
        id: (msg.id as string) || crypto.randomUUID(),
        senderId: msg.senderId as string,
        senderName: msg.senderName as string,
        content: msg.content as string,
        recipientId: (msg.recipientId as string) || null,
        createdAt: (msg.createdAt as string) || new Date().toISOString(),
      };
      addChatMessage(chatMsg);
    });

    wsClient.on('new-producer', (_msg) => {
      // In production, we'd create a consumer for this producer
      // In simulation, we just acknowledge
    });

    wsClient.on('producer-closed', (_msg) => {
      // Clean up consumer
    });

    wsClient.on('error', (msg) => {
      console.error('WebSocket error:', msg.message);
    });

    wsClient.on('left', () => {
      setIsInMeeting(false);
    });
  }, [setParticipants, setIsInMeeting, addParticipant, removeParticipant, updateParticipant, addChatMessage]);

  const handleJoin = async () => {
    if (!user || !displayName.trim()) return;
    setJoining(true);

    try {
      // Connect WebSocket
      await wsClient.connect(user.id, user.username);
      setupWsHandlers();

      // Join meeting
      wsClient.joinMeeting(code, displayName.trim());
    } catch (err) {
      console.error('Failed to join meeting:', err);
      setError('Failed to connect to meeting');
      setJoining(false);
    }
  };

  const handleLeave = () => {
    wsClient.leaveMeeting();
    wsClient.disconnect();
    resetMeeting();
    resetMedia();
    navigate({ to: '/' });
  };

  const handleCreateBreakoutRooms = async (rooms: { name: string }[]) => {
    if (!meeting) return;
    try {
      await api.createBreakoutRooms(meeting.id, rooms);
    } catch (err) {
      console.error('Failed to create breakout rooms:', err);
    }
  };

  const handleActivateBreakout = async () => {
    if (!meeting) return;
    try {
      await api.activateBreakoutRooms(meeting.id);
    } catch (err) {
      console.error('Failed to activate breakout rooms:', err);
    }
  };

  const handleCloseBreakout = async () => {
    if (!meeting) return;
    try {
      await api.closeBreakoutRooms(meeting.id);
    } catch (err) {
      console.error('Failed to close breakout rooms:', err);
    }
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-zoom-primary">Loading meeting...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-4">
        <div className="text-zoom-red text-lg">{error}</div>
        <button
          onClick={() => navigate({ to: '/' })}
          className="bg-zoom-primary hover:bg-zoom-hover text-white px-6 py-2 rounded-lg"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Show lobby if not in meeting
  if (!isInMeeting) {
    return (
      <MeetingLobby
        meetingTitle={meetingTitle}
        meetingCode={code}
        displayName={displayName}
        onDisplayNameChange={setDisplayName}
        onJoin={handleJoin}
        loading={joining}
      />
    );
  }

  // In-meeting view
  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 overflow-hidden">
        {/* Main video area */}
        <div className="flex-1 min-w-0">
          <VideoGrid />
        </div>

        {/* Side panels */}
        {isChatOpen && <ChatPanel />}
        {isParticipantListOpen && <ParticipantList />}
        {isBreakoutOpen && meeting && (
          <BreakoutRooms
            meetingId={meeting.id}
            onCreateRooms={handleCreateBreakoutRooms}
            onActivate={handleActivateBreakout}
            onClose={handleCloseBreakout}
          />
        )}
      </div>

      {/* Control bar */}
      <ControlBar onLeave={handleLeave} />
    </div>
  );
}
