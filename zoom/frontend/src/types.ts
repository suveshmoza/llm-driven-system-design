export interface Meeting {
  id: string;
  meetingCode: string;
  title: string;
  hostId: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: 'scheduled' | 'active' | 'ended' | 'cancelled';
  settings: MeetingSettings;
  createdAt: string;
}

export interface MeetingSettings {
  waitingRoom: boolean;
  muteOnEntry: boolean;
  allowScreenShare: boolean;
  maxParticipants: number;
}

export interface Participant {
  id: string;
  userId: string;
  displayName: string;
  role: 'host' | 'co-host' | 'participant';
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  isHandRaised: boolean;
  stream?: MediaStream;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  recipientId: string | null;
  createdAt: string;
}

export interface BreakoutRoom {
  id: string;
  name: string;
  isActive: boolean;
  participants: string[];
}

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'videoinput' | 'audiooutput';
}
