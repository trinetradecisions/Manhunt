# Socket Event Contracts

All real-time communication between the client and server occurs via Socket.IO using strictly typed payloads.

---

## Client to Server Events (`C2S`)

### 1. `room:join`
```typescript
{
  roomCode: string;
  playerId: string;
  nickname: string;
}
```

### 2. `room:update_config` (Host only)
```typescript
{
  gameMode?: 'CLASSIC_MANHUNT' | 'HIDE_AND_SEEK';
  durationSeconds?: number;
  playZone?: {
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
  };
  pingIntervalSeconds?: number;
  globalHeadStartSeconds?: number;
  individualHeadStarts?: Record<string, number>; // playerId -> seconds
  radioEnabled?: boolean;
}
```

### 3. `player:set_role` (Host only)
```typescript
{
  targetPlayerId: string;
  role: 'RUNNER' | 'CHASER' | 'REFEREE' | 'SPECTATOR';
}
```

### 4. `player:set_ready`
```typescript
{
  ready: boolean;
  gpsStatus: 'GRANTED' | 'DENIED' | 'PROMPT' | 'UNAVAILABLE';
}
```

### 5. `match:start` (Host only)
```typescript
{}
```

### 6. `location:update`
```typescript
{
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}
```

### 7. `catch:attempt` (Chaser only)
```typescript
{
  targetRunnerId: string;
  chaserLat: number;
  chaserLng: number;
  accuracy: number;
}
```

### 8. `catch:respond` (Runner only)
```typescript
{
  catchAttemptId: string;
  response: 'CONFIRM' | 'DISPUTE';
}
```

### 9. `catch:override` (Host or Referee only)
```typescript
{
  catchAttemptId: string;
  decision: 'CONFIRMED' | 'REJECTED';
}
```

### 10. `match:safety_pause` (Host or Referee only)
```typescript
{
  reason?: string;
}
```

### 11. `match:resume` (Host only)
```typescript
{}
```

### 12. `match:end` (Host only)
```typescript
{}
```

### 13. `radio:transmit`
```typescript
{
  audioUrl: string; // Internal temporary file reference
  durationMs: number;
}
```

---

## Server to Client Events (`S2C`)

### 1. `room:state`
Broadcast when any room configuration, member, or match state changes.
```typescript
{
  roomCode: string;
  hostId: string;
  gameState: 'LOBBY' | 'READY_CHECK' | 'COUNTDOWN' | 'RUNNER_HEADSTART' | 'ACTIVE' | 'SAFETY_PAUSED' | 'COMPLETED' | 'CANCELLED';
  config: GameConfig;
  members: PlayerMember[];
  match?: MatchSummary;
}
```

### 2. `location:batch_pings` (Role filtered)
Sent to chasers and referees according to configured ping interval.
```typescript
{
  pings: Array<{
    playerId: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    ageSeconds: number;
  }>;
}
```

### 3. `catch:pending`
Sent to target runner, chaser, and referee when a catch is requested.
```typescript
{
  catchAttemptId: string;
  chaserId: string;
  chaserNickname: string;
  targetRunnerId: string;
  distanceMeters: number;
  expiresAt: number;
}
```

### 4. `catch:resolved`
Broadcast to all players when a catch is finalized.
```typescript
{
  catchAttemptId: string;
  runnerId: string;
  runnerNickname: string;
  status: 'CAUGHT' | 'DISPUTED' | 'DISMISSED';
  resolvedBy: string;
}
```

### 5. `radio:incoming`
Sent **strictly to teammates** of the transmitting player.
```typescript
{
  messageId: string;
  senderId: string;
  senderNickname: string;
  team: 'RUNNER' | 'CHASER';
  audioUrl: string;
  durationMs: number;
  timestamp: number;
}
```

### 6. `match:alert`
High-priority broadcast for safety pauses, boundary violations, or victory.
```typescript
{
  type: 'SAFETY_PAUSE' | 'BOUNDARY_WARNING' | 'VICTORY' | 'INFO';
  title: string;
  message: string;
  timestamp: number;
}
```
