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

export type PlayBoundaryShape = 'CIRCLE' | 'RECTANGLE' | 'POLYGON';

export interface MapPoint {
  lat: number;
  lng: number;
  latitude?: number;
  longitude?: number;
}

export type TacticalMarkerType =
  | 'START_POINT'
  | 'SAFE_ZONE'
  | 'MEETING_POINT'
  | 'CUSTOM';

export interface TacticalMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  type: TacticalMarkerType;
}

export interface ExcludedArea {
  id: string;
  name: string;
  shapeType: 'CIRCLE' | 'POLYGON';
  centerLat: number;
  centerLng: number;
  radiusMeters?: number;
  vertices?: MapPoint[];
  createdAt?: number;
}

export interface PlayZone {
  shapeType?: PlayBoundaryShape; // 'CIRCLE' (default) | 'RECTANGLE' | 'POLYGON'
  centerLat: number; // Anchor or centroid for map centering
  centerLng: number;
  radiusMeters: number; // Circle radius or enclosing radius
  northEast?: MapPoint; // Rectangle top-right
  southWest?: MapPoint; // Rectangle bottom-left
  vertices?: MapPoint[]; // Polygon boundary vertices
  markers?: TacticalMarker[]; // Named points of interest
  bases?: TacticalMarker[]; // Randomized tactical bases & checkpoints
  excludedAreas?: ExcludedArea[]; // Excluded hazardous or off-limits sectors
  isHostConfirmed?: boolean; // Set when host confirms official play zone (prevents GPS overwrite)
  areaSquareMeters?: number; // Approximate calculated area
  perimeterMeters?: number; // Approximate calculated perimeter
  version?: number; // Monotonically increasing revision number
  updatedAt?: number;
  updatedBy?: string;
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
  isEliminated?: boolean;
  individualHeadStartSeconds?: number;
  catchCode?: string; // 4-digit code generated for runner
  catchCodeExpiresAt?: number;
}

export type MissionTemplateType =
  | 'SECURE_POINT'
  | 'SECURE_THE_POINT'
  | 'CHECKPOINT_RUN'
  | 'SURVIVAL_MILESTONE'
  | 'CLOSE_ENCOUNTER'
  | 'LANDMARK_RECON';

export type MissionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type MissionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'PAUSED';

export interface MissionCheckpoint {
  id?: string;
  index: number;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  completed: boolean;
  isCompleted?: boolean;
  completedAt?: number;
}

export interface ActiveMission {
  id: string;
  playerId: string;
  playerNickname: string;
  roomCode: string;
  matchId?: string;
  type?: string;
  templateType: MissionTemplateType;
  title: string;
  description: string;
  difficulty: MissionDifficulty;
  rewardIndividual: number;
  rewardTeam: number;
  assignedAt: number;
  deadlineAt: number | null;
  targetLocation?: MapPoint;
  targetRadiusMeters?: number;
  requiredStaySeconds?: number;
  currentStaySeconds?: number;
  stayDurationSeconds?: number;
  stayResetOnDeparture?: boolean;
  isInRadius?: boolean;
  progress?: number;
  proximityDistanceMeters?: number;
  milestoneMinutes?: number;
  milestoneAwardedCount?: number;
  checkpoints?: MissionCheckpoint[];
  currentCheckpointIndex?: number;
  landmarkClue?: {
    question?: string;
    answer?: string;
    isAnswered?: boolean;
    name?: string;
  };
  status: MissionStatus;
  completedAt?: number;
  distanceToTargetMeters?: number;
}

export interface ScoreEvent {
  id: string;
  timestamp: number;
  type:
    | 'MISSION_COMPLETED'
    | 'CATCH_AWARD'
    | 'SURVIVAL_MILESTONE'
    | 'WINNING_BONUS'
    | 'INTERCEPTION'
    | 'CHASER_MILESTONE';
  playerId?: string;
  playerNickname?: string;
  team: PlayerTeam;
  pointsIndividual: number;
  pointsTeam: number;
  reason: string;
  idempotencyKey: string;
}

export interface ScoreLedger {
  teamScores: {
    RUNNERS: number;
    CHASERS: number;
  };
  playerScores: Record<string, number>;
  individualScores?: Record<string, number>;
  events: ScoreEvent[];
}

export type CaughtRunnerRule = 'CONVERT_TO_CHASER' | 'ELIMINATE';
export type TieBreakerRule = 'DRAW' | 'MOST_CATCHES' | 'MOST_MISSIONS';

export interface MissionsConfig {
  enabled: boolean;
  enabledMissionTypes: MissionTemplateType[];
  enabledTypes?: string[];
  difficultyWeights: {
    easy: number;
    medium: number;
    hard: number;
  };
  rewards: {
    securePoint: { individual: number; team: number };
    checkpointRun: { individual: number; team: number };
    survivalMilestone: { individual: number; team: number };
    closeEncounter: { individual: number; team: number };
    landmarkRecon: { individual: number; team: number };
  };
  securePointRadiusMeters: number;
  securePointDurationSeconds: number;
  securePointLeaveBehavior: 'RESET' | 'PAUSE';
  checkpointCount: number;
  checkpointDeadlineSeconds: number;
  survivalMilestoneSeconds: number;
  closeEncounterDistanceMeters: number;
  closeEncounterDurationSeconds: number;
  landmarkRadiusMeters: number;
  catchCodeExpirySeconds: number;
  catchRequiresGpsProximity: boolean;
  catchRadiusMeters?: number;
  catchGpsFreshnessSeconds: number;
  caughtRunnerRule: CaughtRunnerRule;
  catchReward: { individual: number; team: number };
  winningTeamBonus: number;
  winningIndividualBonus: number;
  earlyEndAllRunnersCaught: boolean;
  allRunnersCaughtEndsMatch?: boolean;
  tieBreakerRule: TieBreakerRule;
  tieBreaker?: TieBreakerRule;
  // Optional Chaser Gameplay Objectives
  chaserObjectivesEnabled?: boolean;
  rewardInterception?: { individual: number; team: number };
  rewardChaserMilestone?: { individual: number; team: number };
  chaserMilestoneSeconds?: number;
}

export interface GameConfig {
  gameMode: GameMode;
  durationSeconds: number; // default 900 (15 min)
  playZone: PlayZone;
  pingIntervalSeconds: number; // default 60s
  runnerSnapshotIntervalSeconds: number; // default 120s for server-scheduled chaser intel
  globalHeadStartSeconds: number; // default 120s (2 min)
  individualHeadStarts?: Record<string, number>; // playerId -> custom seconds
  targetChaserCount: number; // host-configured desired chasers (default 1)
  radioEnabled: boolean;
  catchProximityThresholdMeters: number; // default 25m
  dynamicZone?: DynamicZoneConfig;
  missions?: MissionsConfig;
}

export interface DynamicZoneConfig {
  enabled: boolean;
  initialRadiusMeters: number;
  shrinkIntervalSeconds: number;
  shrinkPercentage: number;
  minRadiusMeters: number;
  initialDelaySeconds: number;
  warningDurationSeconds: number;
}

export interface DynamicZoneState {
  currentRadiusMeters: number;
  nextRadiusMeters: number;
  currentPhase: number;
  nextShrinkAt: number;
  warningAt: number;
  isWarningActive: boolean;
  isFinalZone: boolean;
}

export interface MatchHistoryRecord {
  matchId: string;
  roomCode: string;
  role: PlayerRole;
  team: PlayerTeam;
  won: boolean;
  distanceMeters: number;
  durationSeconds: number;
  timestamp: number;
}

export interface PlayerStats {
  playerId: string;
  nickname: string;
  totalDistanceMeters: number;
  currentMatchDistanceMeters: number;
  totalPlaytimeSeconds: number;
  matchesPlayed: number;
  matchesWon: number;
  timesCaught: number;
  escapes: number;
  matchHistory?: MatchHistoryRecord[];
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

export type ChatRecipientType = 'ALL' | 'TEAM' | 'DIRECT';
export type ChatChannelType = 'PUBLIC' | 'SQUAD' | 'RUNNERS' | 'CHASERS' | 'DIRECT';

export interface ChatMessage {
  id: string;
  roomCode: string;
  channelId: string; // 'PUBLIC', 'SQUAD', 'RUNNERS', 'CHASERS', or `DM:${id1}:${id2}`
  conversationId: string;
  senderId: string;
  senderNickname: string;
  senderTeam: PlayerTeam;
  recipientType: ChatRecipientType;
  recipientId?: string; // target player ID if DIRECT
  text: string;
  timestamp: number;
}

export type VoiceChannelId = 'SQUAD' | 'PUBLIC' | 'DIRECT';

export interface VoiceParticipant {
  playerId: string;
  nickname: string;
  team: PlayerTeam;
  isSpeaking: boolean;
  isMuted: boolean;
  channelId: VoiceChannelId;
  joinedAt: number;
}

export interface VoiceSignalPayload {
  roomCode: string;
  senderId: string;
  targetPlayerId: string;
  channelId: VoiceChannelId;
  signal: any;
}

export interface PeerVoiceState {
  playerId: string;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  hasAudioTrack: boolean;
}

export interface VoiceDiagnostics {
  status: 'DISCONNECTED' | 'JOINING' | 'WAITING_PEERS' | 'NEGOTIATING' | 'CONNECTED';
  selectedChannel: VoiceChannelId | null;
  micPermission: 'prompt' | 'granted' | 'denied' | 'requesting';
  hasMicStream: boolean;
  authorizedPeerCount: number;
  connectedPeerCount: number;
  peerStates: Record<string, PeerVoiceState>;
  autoplayBlocked: boolean;
  lastError: string | null;
}

export interface ScheduledRunnerSnapshot {
  snapshotTimestamp: number;
  nextExpectedSnapshotAt: number;
  intervalSeconds: number;
  runners: Array<{
    playerId: string;
    nickname: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    snapshotAgeSeconds: number;
  }>;
}

export interface SharedMission extends ActiveMission {
  completedByPlayerId?: string;
  completedByNickname?: string;
}

export interface MatchSummary {
  startedAt: number;
  headStartEndsAt: number; // exact timestamp when head-start expires
  gameStartedAt: number;     // exact timestamp when active hunt starts
  gameEndsAt: number;        // exact timestamp when match clock reaches zero
  totalDurationSeconds: number;
  remainingSeconds: number;
  pausedAt?: number;
  totalPausedSeconds: number;
  winnerTeam?: 'RUNNERS' | 'CHASERS' | 'DRAW';
  victoryReason?: string; // Authoritative reason for match outcome
  catches: CatchAttempt[];
  lastScheduledSnapshot?: ScheduledRunnerSnapshot;
  dynamicZoneState?: DynamicZoneState;
  scoreLedger?: ScoreLedger;
  activeMissions?: Record<string, ActiveMission>; // legacy compatibility
  completedMissions?: ActiveMission[];
  sharedMissions?: SharedMission[]; // Authoritative shared match missions
}

export interface RoomState {
  roomCode: string;
  hostId: string;
  state: GameState;
  config: GameConfig;
  members: Record<string, PlayerMember>;
  match?: MatchSummary;
  version?: number;
  updatedAt?: number;
}

