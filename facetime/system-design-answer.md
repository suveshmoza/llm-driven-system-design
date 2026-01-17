# FaceTime - System Design Interview Answer

## Opening Statement (1 minute)

"I'll design FaceTime, Apple's real-time video calling system with end-to-end encryption. The key challenges are achieving low latency for real-time communication, handling NAT traversal so devices behind firewalls can connect, and scaling group calls beyond what peer-to-peer mesh topology can support.

The core technical challenges are implementing WebRTC with STUN/TURN for NAT traversal, building an SFU (Selective Forwarding Unit) for group calls, and achieving end-to-end encryption while still allowing server-assisted routing."

## Requirements Clarification (3 minutes)

### Functional Requirements
- **Call**: 1:1 video and audio calls
- **Group**: Multi-party video calls (up to 32 people)
- **Ring**: Incoming calls ring on all user's devices
- **Handoff**: Transfer call between devices
- **Effects**: Background blur, portrait mode, reactions

### Non-Functional Requirements
- **Latency**: < 150ms end-to-end for video
- **Quality**: Up to 1080p video
- **Scale**: Millions of concurrent calls globally
- **Security**: End-to-end encryption for all calls

### Scale Estimates
- Hundreds of millions of Apple devices
- Millions of concurrent calls at peak
- Most calls are 1:1 (60%), rest are group
- Average call duration: 5-10 minutes

## High-Level Architecture (5 minutes)

```
+----------------------------------------------------------+
|                     Client Layer                           |
|        iPhone | iPad | Mac | Apple Watch | Apple TV        |
+----------------------------------------------------------+
                           |
          +----------------+----------------+
          v                v                v
+------------------+  +------------------+  +------------------+
| Signaling Server |  |   STUN Server    |  |   TURN Server    |
|                  |  |                  |  |                  |
| - Call setup     |  | - NAT mapping    |  | - Media relay    |
| - Presence       |  | - ICE candidates |  | - Fallback       |
| - Ringing        |  |                  |  |                  |
+------------------+  +------------------+  +------------------+
                           |
                           v
+----------------------------------------------------------+
|                   Peer-to-Peer Media                       |
|            (Direct connection when possible)               |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|                   SFU (Group Calls)                        |
|          (Selective Forwarding Unit for 3+ parties)        |
+----------------------------------------------------------+
```

### Core Components
1. **Signaling Server** - Call setup, SDP exchange, presence
2. **STUN Server** - Discovers public IP for NAT traversal
3. **TURN Server** - Media relay when direct connection fails
4. **SFU** - Forwards media streams in group calls
5. **E2E Encryption** - SRTP with per-call key exchange

## Deep Dive: Call Signaling and Setup (8 minutes)

### Signaling Flow

```javascript
class SignalingService {
  async initiateCall(callerId, calleeIds, callType) {
    const callId = uuid()

    // Create call session
    const call = {
      id: callId,
      initiator: callerId,
      participants: calleeIds,
      type: callType,  // 'video' or 'audio'
      state: 'ringing',
      createdAt: Date.now()
    }

    await this.storeCall(call)

    // Ring all callee devices
    for (const calleeId of calleeIds) {
      const devices = await this.getUserDevices(calleeId)

      for (const device of devices) {
        // Push notification for device wake-up
        await this.pushService.send(device.pushToken, {
          type: 'incoming_call',
          callId,
          caller: await this.getUserInfo(callerId),
          callType
        })

        // WebSocket for connected devices
        if (device.connected) {
          this.sendToDevice(device.id, {
            type: 'ring',
            callId,
            caller: callerId,
            callType
          })
        }
      }
    }

    // Ring timeout (30 seconds)
    setTimeout(() => this.handleRingTimeout(callId), 30000)

    return { callId }
  }

  async answerCall(callId, deviceId, sdpAnswer) {
    const call = await this.getCall(callId)
    if (call.state !== 'ringing') {
      throw new Error('Call is not ringing')
    }

    // Stop ringing on all other devices
    await this.stopRinging(call.participants)

    // Update call state
    await this.updateCall(callId, {
      state: 'connected',
      answeredBy: deviceId,
      connectedAt: Date.now()
    })

    // Send answer to caller
    const callerDevice = await this.getActiveDevice(call.initiator)
    this.sendToDevice(callerDevice.id, {
      type: 'call_answered',
      callId,
      answer: sdpAnswer
    })
  }
}
```

### WebRTC Offer/Answer Exchange

```javascript
class WebRTCManager {
  async createOffer(callId, mediaConstraints) {
    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.apple.com:3478' },
        {
          urls: 'turn:turn.apple.com:3478',
          username: await this.getTurnCredentials(),
          credential: await this.getTurnPassword()
        }
      ]
    })

    // Add local media tracks
    const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints)
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream)
    }

    // Create and set local description
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    // Gather ICE candidates
    await this.gatherICECandidates(pc)

    // Send offer through signaling
    await this.signaling.sendOffer(callId, offer)

    return pc
  }

  async handleAnswer(pc, answer) {
    await pc.setRemoteDescription(answer)
  }

  async gatherICECandidates(pc) {
    return new Promise((resolve) => {
      const candidates = []

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidates.push(event.candidate)
          // Trickle ICE - send immediately
          this.signaling.sendICECandidate(event.candidate)
        } else {
          // Gathering complete
          resolve(candidates)
        }
      }
    })
  }
}
```

### NAT Traversal (ICE)

```javascript
class ICEManager {
  async checkConnectivity(pc, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('ICE connection timeout'))
      }, timeout)

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState

        if (state === 'connected' || state === 'completed') {
          clearTimeout(timer)
          resolve({ connected: true, type: this.getConnectionType(pc) })
        }

        if (state === 'failed') {
          clearTimeout(timer)
          reject(new Error('ICE connection failed'))
        }
      }
    })
  }

  async getConnectionType(pc) {
    const stats = await pc.getStats()

    for (const [, report] of stats) {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        const localCandidate = stats.get(report.localCandidateId)

        if (localCandidate.candidateType === 'host') {
          return 'direct'  // Local network or public IP
        } else if (localCandidate.candidateType === 'srflx') {
          return 'stun'  // NAT traversal via STUN
        } else if (localCandidate.candidateType === 'relay') {
          return 'turn'  // Relayed via TURN server
        }
      }
    }
    return 'unknown'
  }
}
```

## Deep Dive: Group Calls with SFU (7 minutes)

### Why SFU over Mesh?

In mesh topology, each participant sends their stream to every other participant:
- 4 participants = 12 streams (n * (n-1))
- 10 participants = 90 streams

With SFU, each participant sends one stream to server, receives n-1 streams:
- 4 participants = 4 upload + 12 download = much lighter on clients
- Server handles the fan-out

### SFU Architecture

```javascript
class SFU {
  constructor() {
    this.rooms = new Map()  // roomId -> Room
  }

  async joinRoom(roomId, userId, offer) {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Room(roomId)
      this.rooms.set(roomId, room)
    }

    // Create peer connection for this participant
    const pc = new RTCPeerConnection()

    // Handle incoming tracks from this participant
    pc.ontrack = (event) => {
      // Forward to all other participants
      room.forwardTrack(userId, event.track, event.streams[0])
    }

    // Add transceivers for receiving from others
    for (const [otherId, participant] of room.participants) {
      for (const track of participant.tracks) {
        pc.addTrack(track)
      }
    }

    // Process offer
    await pc.setRemoteDescription(offer)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    // Store participant
    room.participants.set(userId, {
      pc,
      tracks: [],
      userId
    })

    return { answer, participants: Array.from(room.participants.keys()) }
  }
}

class Room {
  constructor(roomId) {
    this.id = roomId
    this.participants = new Map()
    this.dominantSpeaker = null
  }

  forwardTrack(fromUserId, track, stream) {
    // Store track for new joiners
    const participant = this.participants.get(fromUserId)
    participant.tracks.push(track)

    // Forward to all other participants
    for (const [userId, p] of this.participants) {
      if (userId !== fromUserId) {
        p.pc.addTrack(track, stream)
        this.renegotiate(p.pc)
      }
    }
  }

  async renegotiate(pc) {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    // Send offer to client for renegotiation
  }
}
```

### Dominant Speaker Detection

In group calls, highlight who's speaking:

```javascript
class DominantSpeakerDetector {
  constructor(room) {
    this.room = room
    this.audioLevels = new Map()  // userId -> recentLevels[]
    this.smoothingWindow = 5
  }

  async detect() {
    for (const [userId, participant] of this.room.participants) {
      const stats = await participant.pc.getStats()

      for (const report of stats.values()) {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          const level = report.audioLevel || 0
          this.updateLevel(userId, level)
        }
      }
    }

    // Find user with highest average level
    let maxAvg = 0
    let dominant = null

    for (const [userId, levels] of this.audioLevels) {
      const avg = levels.reduce((a, b) => a + b, 0) / levels.length
      if (avg > maxAvg && avg > 0.01) {  // Threshold to ignore silence
        maxAvg = avg
        dominant = userId
      }
    }

    if (dominant !== this.room.dominantSpeaker) {
      this.room.dominantSpeaker = dominant
      this.notifyParticipants(dominant)
    }
  }

  updateLevel(userId, level) {
    if (!this.audioLevels.has(userId)) {
      this.audioLevels.set(userId, [])
    }

    const levels = this.audioLevels.get(userId)
    levels.push(level)

    if (levels.length > this.smoothingWindow) {
      levels.shift()
    }
  }
}
```

## Deep Dive: End-to-End Encryption (5 minutes)

### Key Exchange (ECDH)

```javascript
class E2EEncryption {
  async setupEncryption() {
    // Generate ephemeral key pair for this call
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    )

    // Export public key to share with peer
    const publicKeyBytes = await crypto.subtle.exportKey(
      'raw',
      keyPair.publicKey
    )

    return { keyPair, publicKey: publicKeyBytes }
  }

  async deriveSessionKey(privateKey, remotePublicKey) {
    // Import remote public key
    const importedKey = await crypto.subtle.importKey(
      'raw',
      remotePublicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    )

    // Derive shared secret
    const sharedSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: importedKey },
      privateKey,
      256
    )

    // Derive AES key from shared secret
    const sessionKey = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )

    return sessionKey
  }
}
```

### SRTP Encryption

WebRTC uses SRTP (Secure Real-time Transport Protocol) for media encryption:

```javascript
class SRTPHandler {
  async encryptPacket(packet, sessionKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sessionKey,
      packet.payload
    )

    return {
      header: packet.header,
      iv,
      payload: new Uint8Array(encrypted)
    }
  }

  async decryptPacket(encryptedPacket, sessionKey) {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: encryptedPacket.iv },
      sessionKey,
      encryptedPacket.payload
    )

    return {
      header: encryptedPacket.header,
      payload: new Uint8Array(decrypted)
    }
  }
}
```

### Perfect Forward Secrecy

Each call uses a new ephemeral key pair:
- Even if long-term keys are compromised later, past calls remain private
- Keys are never stored after call ends

## Trade-offs and Alternatives (5 minutes)

### 1. SFU vs MCU

**Chose: SFU (Selective Forwarding Unit)**
- Pro: Lower server CPU (no transcoding)
- Pro: Lower latency (no processing delay)
- Pro: Better video quality (no re-encoding)
- Con: Higher client bandwidth (multiple streams)
- Alternative: MCU (mixes all into one stream, higher server cost)

### 2. Direct P2P vs Always Relay

**Chose: Prefer P2P with TURN fallback**
- Pro: Lower latency when possible
- Pro: Reduced server bandwidth costs
- Con: NAT traversal complexity
- Alternative: Always relay through TURN (simpler but higher latency and cost)

### 3. VP8/VP9 vs H.264

**Chose: VP8/VP9 with H.264 fallback**
- Pro: Royalty-free (VP8/VP9)
- Pro: Hardware support (H.264)
- Con: Need to support multiple codecs
- Alternative: H.264 only (universal hardware but licensing)

### 4. Persistent Connections vs On-Demand

**Chose: Persistent WebSocket for signaling**
- Pro: Instant call notifications
- Pro: Quick call setup
- Con: More server resources
- Alternative: Push notification + on-demand connect (slower setup)

### Database Schema

```sql
-- Active Calls
CREATE TABLE calls (
  id UUID PRIMARY KEY,
  initiator_id UUID NOT NULL,
  call_type VARCHAR(20) NOT NULL,  -- video, audio, group
  state VARCHAR(20) NOT NULL,       -- ringing, connected, ended
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Call Participants
CREATE TABLE call_participants (
  call_id UUID REFERENCES calls(id),
  user_id UUID NOT NULL,
  device_id UUID NOT NULL,
  state VARCHAR(20),  -- ringing, connected, left
  joined_at TIMESTAMP,
  left_at TIMESTAMP,
  PRIMARY KEY (call_id, user_id, device_id)
);

-- User Devices (for multi-device ring)
CREATE TABLE user_devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  device_type VARCHAR(50),
  push_token VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  last_seen TIMESTAMP
);

CREATE INDEX idx_devices_user ON user_devices(user_id) WHERE is_active;
```

## Closing Summary (1 minute)

"FaceTime is built around three key components:

1. **WebRTC with NAT traversal** - Using STUN to discover public IPs and TURN as a fallback relay, we can establish connections between devices behind firewalls. ICE (Interactive Connectivity Establishment) tries multiple paths and uses the best one.

2. **SFU for group calls** - Rather than mesh topology where bandwidth grows quadratically, the SFU receives one stream per participant and selectively forwards to others. This makes group calls scale to 32 participants.

3. **End-to-end encryption** - Ephemeral ECDH key exchange ensures each call has unique session keys, providing perfect forward secrecy. Even the SFU cannot decrypt media content.

The main trade-off is SFU vs MCU. SFU has lower latency and doesn't re-encode video, but requires more client bandwidth. For a service prioritizing quality and low latency, SFU is the right choice."
