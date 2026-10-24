export type PlayerRole = 'HOST' | 'RUNNER' | 'CHASER' | 'REFEREE' | 'SPECTATOR';
export type PlayerTeam = 'RUNNERS' | 'CHASERS' | 'NONE';

export type GameState =
  | 'LOBBY'
  | 'READY_CHECK'
  | 'COUNTDOWN'
  | 'RUNNER_HEADSTART'
  | 'ACTIVE'
  | 'SAFETY_PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export type GameMode = 'CLASSIC_MANHUNT' | 'HIDE_AND_SEEK';

export type GpsPermissionStatus = 'GRANTED' | 'DENIED' | 'PROMPT' | 'UNAVAILABLE';

export interface PlayZone {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

export interface PlayerLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export interface PlayerMember {
  id: string;
  socketId: string;
  nickname: string;
  role: PlayerRole;
  team: PlayerTeam;
  isReady: boolean;
  gpsStatus: GpsPermissionStatus;
  lastLocation?: PlayerLocation;
  isCaught?: boolean;
  caughtAt?: number;
  individualHeadStartSeconds?: number;
  catchCode?: string; // 4-digit code generated for runner
}

export interface GameConfig {
  gameMode: GameMode;
  durationSeconds: number; // default 900 (15 min)
  playZone: PlayZone;
  pingIntervalSeconds: number; // default 60s
  globalHeadStartSeconds: number; // default 120s (2 min)
  individualHeadStarts?: Record<string, number>; // playerId -> custom seconds
  radioEnabled: boolean;
  catchProximityThresholdMeters: number; // default 25m
}

export interface CatchAttempt {
  id: string;
  chaserId: string;
  chaserNickname: string;
  runnerId: string;
  runnerNickname: string;
  distanceMeters: number;
  timestamp: number;
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'DISMISSED';
  verificationType?: 'PROXIMITY_CONFIRMED' | 'CODE_VERIFIED' | 'REFEREE_OVERRIDE';
  resolvedBy?: string;
}

export interface RadioTransmission {
  id: string;
  senderId: string;
  senderNickname: string;
  team: PlayerTeam;
  audioUrl: string;
  durationMs: number;
  timestamp: number;
}

export interface MatchSummary {
  startedAt: number;
  endsAt: number;
  totalDurationSeconds: number;
  remainingSeconds: number;
  pausedAt?: number;
  totalPausedSeconds: number;
  winnerTeam?: 'RUNNERS' | 'CHASERS' | 'DRAW';
  catches: CatchAttempt[];
}

export interface RoomState {
  roomCode: string;
  hostId: string;
  state: GameState;
  config: GameConfig;
  members: Record<string, PlayerMember>;
  match?: MatchSummary;
}
