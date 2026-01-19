/**
 * Signaling Handler - Forwards WebRTC signaling messages.
 *
 * Handles:
 * - SDP offer forwarding
 * - SDP answer forwarding
 * - ICE candidate forwarding with deduplication
 */

import { getCallState } from '../redis.js';
import type { WebSocketMessage } from '../../types/index.js';
import type { ConnectedClient } from './types.js';
import { logSignalingEvent } from '../../shared/logger.js';
import {
  checkICECandidateDedup,
  generateICECandidateHash,
} from '../../shared/idempotency.js';
import {
  sendToClient,
  getUserClientIds,
  getClient,
} from './connection-manager.js';

/**
 * Forwards WebRTC signaling messages between call participants.
 * Routes offer, answer, and ICE candidate messages to enable
 * peer-to-peer connection establishment.
 *
 * ICE candidates are deduplicated to handle network retries.
 *
 * @param client - The sender's connected client
 * @param message - The signaling message to forward
 */
export async function handleSignaling(
  client: ConnectedClient,
  message: WebSocketMessage
): Promise<void> {
  const { callId, type, data } = message;

  if (!callId) return;

  const callState = await getCallState(callId);
  if (!callState) return;

  // Deduplicate ICE candidates
  if (type === 'ice_candidate' && data) {
    const candidateData = data as { candidate?: string };
    if (candidateData.candidate) {
      const hash = generateICECandidateHash(callId, client.deviceId, candidateData.candidate);
      const isNew = await checkICECandidateDedup(callId, hash);
      if (!isNew) {
        // Duplicate candidate, skip forwarding
        return;
      }
    }
  }

  // Log signaling event
  logSignalingEvent(callId, type, client.userId);

  // Forward signaling message to other participants
  const participants = callState.participants as { userId: string; deviceId: string }[];

  for (const participant of participants) {
    if (participant.userId !== client.userId || participant.deviceId !== client.deviceId) {
      const participantClientIds = getUserClientIds(participant.userId);
      if (participantClientIds) {
        for (const participantClientId of participantClientIds) {
          const participantClient = getClient(participantClientId);
          if (participantClient && participantClient.deviceId === participant.deviceId) {
            sendToClient(participantClient.ws, {
              type,
              callId,
              userId: client.userId,
              data,
            });
          }
        }
      }
    }
  }
}
