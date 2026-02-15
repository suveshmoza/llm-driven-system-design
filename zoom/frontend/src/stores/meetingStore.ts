import { create } from 'zustand';
import type { Participant, ChatMessage, BreakoutRoom, Meeting } from '../types';

interface MeetingState {
  meeting: Meeting | null;
  participants: Participant[];
  chatMessages: ChatMessage[];
  breakoutRooms: BreakoutRoom[];
  isInMeeting: boolean;
  isChatOpen: boolean;
  isParticipantListOpen: boolean;
  isBreakoutOpen: boolean;
  screenSharingUserId: string | null;

  setMeeting: (meeting: Meeting | null) => void;
  setParticipants: (participants: Participant[]) => void;
  addParticipant: (participant: Participant) => void;
  removeParticipant: (userId: string) => void;
  updateParticipant: (userId: string, updates: Partial<Participant>) => void;
  addChatMessage: (message: ChatMessage) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  setBreakoutRooms: (rooms: BreakoutRoom[]) => void;
  setIsInMeeting: (val: boolean) => void;
  toggleChat: () => void;
  toggleParticipantList: () => void;
  toggleBreakout: () => void;
  setScreenSharingUserId: (userId: string | null) => void;
  reset: () => void;
}

const initialState = {
  meeting: null,
  participants: [],
  chatMessages: [],
  breakoutRooms: [],
  isInMeeting: false,
  isChatOpen: false,
  isParticipantListOpen: false,
  isBreakoutOpen: false,
  screenSharingUserId: null,
};

/** Meeting room state with participant list, chat messages, and breakout room management. */
export const useMeetingStore = create<MeetingState>((set) => ({
  ...initialState,

  setMeeting: (meeting) => set({ meeting }),

  setParticipants: (participants) => set({ participants }),

  addParticipant: (participant) =>
    set((state) => ({
      participants: [...state.participants.filter((p) => p.userId !== participant.userId), participant],
    })),

  removeParticipant: (userId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.userId !== userId),
      screenSharingUserId: state.screenSharingUserId === userId ? null : state.screenSharingUserId,
    })),

  updateParticipant: (userId, updates) =>
    set((state) => {
      const newParticipants = state.participants.map((p) =>
        p.userId === userId ? { ...p, ...updates } : p
      );
      let screenSharingUserId = state.screenSharingUserId;
      if (updates.isScreenSharing === true) {
        screenSharingUserId = userId;
      } else if (updates.isScreenSharing === false && screenSharingUserId === userId) {
        screenSharingUserId = null;
      }
      return { participants: newParticipants, screenSharingUserId };
    }),

  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message],
    })),

  setChatMessages: (messages) => set({ chatMessages: messages }),

  setBreakoutRooms: (rooms) => set({ breakoutRooms: rooms }),

  setIsInMeeting: (val) => set({ isInMeeting: val }),

  toggleChat: () => set((state) => ({ isChatOpen: !state.isChatOpen, isParticipantListOpen: false, isBreakoutOpen: false })),

  toggleParticipantList: () =>
    set((state) => ({ isParticipantListOpen: !state.isParticipantListOpen, isChatOpen: false, isBreakoutOpen: false })),

  toggleBreakout: () =>
    set((state) => ({ isBreakoutOpen: !state.isBreakoutOpen, isChatOpen: false, isParticipantListOpen: false })),

  setScreenSharingUserId: (userId) => set({ screenSharingUserId: userId }),

  reset: () => set(initialState),
}));
