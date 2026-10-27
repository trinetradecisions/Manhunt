import fs from 'fs';
import path from 'path';
import os from 'os';
import { Redis } from '@upstash/redis';
import {
  ActiveMission,
  CatchAttempt,
  ChatMessage,
  DynamicZoneState,
  ExcludedArea,
  GameConfig,
  GameState,
  MapPoint,
  MatchSummary,
  PlayerLocation,
  PlayerMember,
  PlayerRole,
  PlayerTeam,
  PlayZone,
  RadioTransmission,
  RoomState,
  SharedMission,
  TacticalMarker,
  VoiceChannelId,
  VoiceParticipant,
} from '../types/game';
import {
  calculateHaversineDistance,
  checkPlayZoneBoundary,
  checkVelocitySanity,
  validateCatchProximity,
  isPointInExcludedArea,
  generateRandomBases,
} from './geo';
import { canTransitionState } from './stateMachine';
import { ScoringService } from './scoring';
import { MissionService } from './missions';
import { broadcastToRoom } from './realtime';

export interface ExtendedRoomState extends RoomState {
  version: number;
  updatedAt: number;
  chatMessages: ChatMessage[];
  radioTransmissions: RadioTransmission[];
  voiceParticipants?: Record<string, VoiceParticipant>;
  voiceSignals: Array<{
    id: string;
    fromPlayerId: string;
    senderId?: string;
    toPlayerId?: string;
    targetPlayerId?: string;
    channelId: string;
    signal: any;
    timestamp: number;
  }>;
}

const scoringService = new ScoringService();
const missionService = new MissionService(scoringService);

// Global in-memory fallback for local dev & single-process Lambdas
declare global {
  // eslint-disable-next-line no-var
  var __MANHUNT_MEMORY_STORE__: Map<string, ExtendedRoomState> | undefined;
}

if (!globalThis.__MANHUNT_MEMORY_STORE__) {
  globalThis.__MANHUNT_MEMORY_STORE__ = new Map<string, ExtendedRoomState>();
}
const memoryStore = globalThis.__MANHUNT_MEMORY_STORE__;

let redisClient: Redis | null = null;
function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    try {
      redisClient = new Redis({ url, token });
      return redisClient;
    } catch (err) {
      console.warn('[Store] Failed to initialize Redis client:', err);
    }
  }
  return null;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function computeDeterministicCatchCode(
  roomCode: string,
  runnerId: string,
  timestamp: number,
  windowSeconds: number = 300,
  seed: number = 0
): { code: string; expiresAt: number; windowIndex: number } {
  const windowMs = Math.max(30, windowSeconds) * 1000;
  const windowIndex = Math.floor(timestamp / windowMs);
  const expiresAt = (windowIndex + 1) * windowMs;

  const key = `${roomCode.toUpperCase().trim()}:${runnerId}:${windowIndex}:${seed}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const abs = Math.abs(hash);
  const code = (1000 + (abs % 9000)).toString();
  return { code, expiresAt, windowIndex };
}

function getDefaultConfig(initialLocation?: { latitude: number; longitude: number }): GameConfig {
  const hasLoc =
    initialLocation &&
    typeof initialLocation.latitude === 'number' &&
    typeof initialLocation.longitude === 'number';

  return {
    gameMode: 'CLASSIC_MANHUNT',
    durationSeconds: 900,
    playZone: {
      shapeType: 'CIRCLE',
      // If host provided coordinates, anchor immediately; otherwise mark unconfirmed so first GPS reading sets it
      centerLat: hasLoc ? initialLocation.latitude : 0,
      centerLng: hasLoc ? initialLocation.longitude : 0,
      radiusMeters: 500,
      isHostConfirmed: !!hasLoc,
      excludedAreas: [],
      bases: [],
      version: 1,
      updatedAt: Date.now(),
    },
    pingIntervalSeconds: 60,
    runnerSnapshotIntervalSeconds: 120,
    globalHeadStartSeconds: 120,
    individualHeadStarts: {},
    targetChaserCount: 1,
    radioEnabled: true,
    catchProximityThresholdMeters: 25,
    dynamicZone: {
      enabled: false,
      initialRadiusMeters: 500,
      shrinkIntervalSeconds: 180,
      shrinkPercentage: 20,
      minRadiusMeters: 100,
      initialDelaySeconds: 60,
      warningDurationSeconds: 30,
    },
    missions: missionService.getDefaultConfig(),
  };
}

function getTempRoomPath(code: string): string {
  const tmpDir = path.join(os.tmpdir(), 'manhunt_rooms');
  try {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  } catch {
    // Ignore tmp dir creation failure
  }
  return path.join(tmpDir, `${code}.json`);
}

export class GameStateStore {
  private static failedCodeAttempts: Map<string, { count: number; lastAttempt: number }> = new Map();

  private static async getRawRoom(roomCode: string): Promise<ExtendedRoomState | null> {
    const code = roomCode.toUpperCase().trim();

    // 1. In-memory fast cache
    const mem = memoryStore.get(code);
    if (mem) return mem;

    // 2. Distributed Redis cache (if configured via env)
    const redis = getRedisClient();
    if (redis) {
      try {
        const raw = await redis.get<ExtendedRoomState>(`manhunt:room:${code}`);
        if (raw) {
          memoryStore.set(code, raw);
          return raw;
        }
      } catch (err) {
        console.warn(`[Store] Error reading room ${code} from Redis:`, err);
      }
    }

    // 3. Filesystem /tmp cache fallback (shared across invocations on warm containers)
    try {
      const p = getTempRoomPath(code);
      if (fs.existsSync(p)) {
        const fileContent = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(fileContent) as ExtendedRoomState;
        if (parsed && parsed.roomCode) {
          memoryStore.set(code, parsed);
          return parsed;
        }
      }
    } catch (err) {
      // Ignore tmp read failure
    }

    return null;
  }

  private static async saveRawRoom(room: ExtendedRoomState): Promise<void> {
    const code = room.roomCode.toUpperCase().trim();
    room.version = (room.version || 0) + 1;
    room.updatedAt = Date.now();

    // 1. In-memory cache
    memoryStore.set(code, room);

    // 2. Filesystem /tmp cache
    try {
      const p = getTempRoomPath(code);
      fs.writeFileSync(p, JSON.stringify(room), 'utf8');
    } catch {
      // Ignore tmp write failure
    }

    // 3. Distributed Redis cache (if configured)
    const redis = getRedisClient();
    if (redis) {
      try {
        // Expire after 24 hours of inactivity
        await redis.set(`manhunt:room:${code}`, room, { ex: 86400 });
      } catch (err) {
        console.warn(`[Store] Error saving room ${code} to Redis:`, err);
      }
    }
  }


  /**
   * Advances the match clock, headstarts, zone shrinks, survival milestones, and scheduled snapshots
   * deterministically based on timestamps.
   */
  public static updateRoomTimeProgress(room: ExtendedRoomState): boolean {
    if (!room.match) return false;
    if (room.state !== 'RUNNER_HEADSTART' && room.state !== 'ACTIVE') return false;

    const now = Date.now();
    let mutated = false;

    // 1. Transition RUNNER_HEADSTART -> ACTIVE when headstart ends
    if (room.state === 'RUNNER_HEADSTART') {
      if (now >= room.match.headStartEndsAt) {
        room.state = 'ACTIVE';
        room.match.gameStartedAt = now;
        room.match.gameEndsAt = now + room.match.totalDurationSeconds * 1000;
        mutated = true;
      }
    }

    // 2. Active Match Clock & Zone
    if (room.state === 'ACTIVE') {
      const elapsedSinceStart = Math.max(0, Math.floor((now - room.match.gameStartedAt) / 1000));
      const totalDuration = room.match.totalDurationSeconds ?? room.config.durationSeconds ?? 900;
      const remaining = Math.max(0, totalDuration - elapsedSinceStart);

      if (room.match.remainingSeconds !== remaining) {
        room.match.remainingSeconds = remaining;
        mutated = true;
      }

      // Dynamic Zone Shrinking calculation
      if (room.config.dynamicZone?.enabled && room.match.dynamicZoneState) {
        const dz = room.config.dynamicZone;
        const initialR = dz.initialRadiusMeters || room.config.playZone.radiusMeters || 500;
        const minR = dz.minRadiusMeters || 100;
        const progress = Math.min(1, Math.max(0, elapsedSinceStart / totalDuration));
        const currentR = Math.max(minR, Math.round(initialR - progress * (initialR - minR)));

        if (room.match.dynamicZoneState.currentRadiusMeters !== currentR) {
          room.match.dynamicZoneState.currentRadiusMeters = currentR;
          mutated = true;
        }
      }

      // Check recurring survival milestones
      const milestoneRes = missionService.checkSurvivalMilestones(room);
      if (milestoneRes.completedMissions.length > 0) {
        mutated = true;
        if (milestoneRes.allCompleted && room.state === 'ACTIVE') {
          room.state = 'COMPLETED';
          room.match.winnerTeam = 'RUNNERS';
          room.match.victoryReason = 'MISSION OBJECTIVES COMPLETE — All shared missions completed by Runners!';
          if (room.match.scoreLedger) {
            scoringService.resolveWinnerBonuses(
              room.match.scoreLedger,
              'RUNNERS',
              room.members,
              room.config.missions || missionService.getDefaultConfig()
            );
          }
        }
      }

      // Scheduled 120s Runner Snapshot for chasers
      const snapshotInterval = (room.config.runnerSnapshotIntervalSeconds || 120) * 1000;
      const lastSnapshot = room.match.lastScheduledSnapshot;
      if (!lastSnapshot || now >= lastSnapshot.nextExpectedSnapshotAt) {
        const uncaughtRunners = Object.values(room.members).filter(
          (m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated && m.lastLocation
        );
        room.match.lastScheduledSnapshot = {
          snapshotTimestamp: now,
          nextExpectedSnapshotAt: now + snapshotInterval,
          intervalSeconds: room.config.runnerSnapshotIntervalSeconds || 120,
          runners: uncaughtRunners.map((r) => ({
            playerId: r.id,
            nickname: r.nickname,
            latitude: r.lastLocation!.latitude,
            longitude: r.lastLocation!.longitude,
            accuracy: r.lastLocation!.accuracy,
            snapshotAgeSeconds: Math.round((now - r.lastLocation!.timestamp) / 1000),
          })),
        };
        mutated = true;
      }

      // Check match end / timeout
      if (remaining <= 0 && room.state === 'ACTIVE') {
        room.state = 'COMPLETED';
        mutated = true;

        const uncaughtRunners = Object.values(room.members).filter(
          (m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated
        );

        const winner: PlayerTeam = uncaughtRunners.length > 0 ? 'RUNNERS' : 'CHASERS';
        const victoryReason = uncaughtRunners.length > 0
          ? `TIME EXPIRED — ${uncaughtRunners.length} Runner(s) evaded capture!`
          : 'TIME EXPIRED — All Runners were eliminated.';

        room.match.winnerTeam = winner;
        room.match.victoryReason = victoryReason;

        if (room.match.scoreLedger) {
          scoringService.resolveWinnerBonuses(
            room.match.scoreLedger,
            winner,
            room.members,
            room.config.missions || missionService.getDefaultConfig()
          );
        }
      }
    }

    return mutated;
  }

  public static async getRoom(roomCode: string): Promise<ExtendedRoomState | null> {
    const room = await this.getRawRoom(roomCode);
    if (!room) return null;

    const mutated = this.updateRoomTimeProgress(room);
    if (mutated) {
      await this.saveRawRoom(room);
    }
    return room;
  }

  public static async createRoom(host: {
    id: string;
    nickname: string;
    role?: PlayerRole;
    team?: PlayerTeam;
    initialLocation?: { latitude: number; longitude: number };
  }): Promise<ExtendedRoomState> {
    let code = generateRoomCode();
    let attempts = 0;
    while (attempts < 5 && (await this.getRawRoom(code))) {
      code = generateRoomCode();
      attempts++;
    }

    const hostMember: PlayerMember = {
      id: host.id,
      socketId: host.id,
      nickname: host.nickname || 'Host Operative',
      role: host.role || 'HOST',
      team: host.team || 'NONE',
      isReady: true,
      gpsStatus: host.initialLocation ? 'GRANTED' : 'PROMPT',
      lastLocation: host.initialLocation
        ? {
            latitude: host.initialLocation.latitude,
            longitude: host.initialLocation.longitude,
            accuracy: 15,
            heading: null,
            speed: null,
            timestamp: Date.now(),
          }
        : undefined,
    };

    const room: ExtendedRoomState = {
      roomCode: code,
      hostId: host.id,
      state: 'LOBBY',
      config: getDefaultConfig(host.initialLocation),
      members: {
        [host.id]: hostMember,
      },
      version: 1,
      updatedAt: Date.now(),
      chatMessages: [],
      radioTransmissions: [],
      voiceParticipants: {},
      voiceSignals: [],
    };

    await this.saveRawRoom(room);
    return room;
  }

  public static async joinRoom(
    roomCode: string,
    player: {
      id: string;
      nickname: string;
      role?: PlayerRole;
      team?: PlayerTeam;
    }
  ): Promise<{ success: boolean; room?: ExtendedRoomState; member?: PlayerMember; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found. Check code.' };

    let member = room.members[player.id];
    if (!member) {
      member = {
        id: player.id,
        socketId: player.id,
        nickname: player.nickname.trim() || `Agent-${player.id.substring(0, 4)}`,
        role: player.role || 'RUNNER',
        team: player.team || 'NONE',
        isReady: false,
        gpsStatus: 'PROMPT',
      };
      room.members[player.id] = member;
    } else {
      member.nickname = player.nickname.trim() || member.nickname;
      if (player.team) member.team = player.team;
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);

    return { success: true, room, member };
  }

  public static async leaveRoom(
    roomCode: string,
    playerId: string
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    delete room.members[playerId];

    if (room.hostId === playerId) {
      const remaining = Object.keys(room.members);
      if (remaining.length > 0) {
        room.hostId = remaining[0];
        room.members[room.hostId].role = 'HOST';
      }
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    return { success: true, room };
  }

  public static async setReady(
    roomCode: string,
    playerId: string,
    isReady?: boolean,
    gpsStatus?: any,
    accuracy?: number
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const member = room.members[playerId];
    if (!member) return { success: false, error: 'Player not in room' };

    if (typeof isReady === 'boolean') member.isReady = isReady;
    if (gpsStatus) member.gpsStatus = gpsStatus;

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    return { success: true, room };
  }

  public static async assignPlayerTeam(
    roomCode: string,
    requesterId: string,
    targetPlayerId: string,
    team: PlayerTeam
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId) {
      return { success: false, error: 'Only Host can assign teams' };
    }

    const member = room.members[targetPlayerId];
    if (!member) return { success: false, error: 'Target player not in room' };

    member.team = team;
    if (team === 'RUNNERS') {
      member.role = 'RUNNER';
      if (!member.catchCode) {
        member.catchCode = Math.floor(1000 + Math.random() * 9000).toString();
      }
    } else if (team === 'CHASERS') {
      member.role = 'CHASER';
      delete member.catchCode;
    } else {
      member.team = 'NONE';
      member.role = member.id === room.hostId ? 'HOST' : 'SPECTATOR';
      delete member.catchCode;
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    return { success: true, room };
  }

  public static async autoAssignTeams(
    roomCode: string,
    requesterId: string
  ): Promise<{
    success: boolean;
    room?: ExtendedRoomState;
    chasersCount?: number;
    runnersCount?: number;
    error?: string;
  }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId) {
      return { success: false, error: 'Only Host can auto-assign teams' };
    }

    const eligible = Object.values(room.members).filter((m) => m.role !== 'REFEREE');
    if (eligible.length < 2) {
      return {
        success: false,
        error: 'Requires at least 2 players to auto-assign teams (1 Runner & 1 Chaser)',
      };
    }

    const desiredChasers = Math.max(
      1,
      Math.min(room.config.targetChaserCount || 1, eligible.length - 1)
    );

    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    const chasers = shuffled.slice(0, desiredChasers);
    const runners = shuffled.slice(desiredChasers);

    for (const m of chasers) {
      m.team = 'CHASERS';
      m.role = 'CHASER';
      delete m.catchCode;
    }

    for (const m of runners) {
      m.team = 'RUNNERS';
      m.role = 'RUNNER';
      if (!m.catchCode) {
        m.catchCode = Math.floor(1000 + Math.random() * 9000).toString();
      }
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    await broadcastToRoom(room.roomCode, 'match:alert', {
      type: 'INFO',
      title: 'Teams Auto-Assigned',
      message: `Assigned ${chasers.length} Chaser(s) and ${runners.length} Runner(s).`,
      timestamp: Date.now(),
    });

    return {
      success: true,
      room,
      chasersCount: chasers.length,
      runnersCount: runners.length,
    };
  }

  public static async setTargetChaserCount(
    roomCode: string,
    requesterId: string,
    targetCount: number
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId) {
      return { success: false, error: 'Only Host can configure chaser count' };
    }

    const totalEligible = Object.values(room.members).filter((m) => m.role !== 'REFEREE').length;
    if (targetCount < 1) {
      return { success: false, error: 'Target chaser count must be at least 1' };
    }
    if (totalEligible > 1 && targetCount >= totalEligible) {
      return {
        success: false,
        error: `Must leave at least 1 runner (Max ${totalEligible - 1} chasers for ${totalEligible} players)`,
      };
    }

    room.config.targetChaserCount = targetCount;
    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    return { success: true, room };
  }

  public static async setPlayerRole(
    roomCode: string,
    requesterId: string,
    targetPlayerId: string,
    newRole: PlayerRole
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId) {
      return { success: false, error: 'Only Host can assign roles' };
    }

    const member = room.members[targetPlayerId];
    if (!member) return { success: false, error: 'Target player not in room' };

    member.role = newRole;
    if (newRole === 'RUNNER') {
      member.team = 'RUNNERS';
      if (!member.catchCode) {
        member.catchCode = Math.floor(1000 + Math.random() * 9000).toString();
      }
    } else if (newRole === 'CHASER') {
      member.team = 'CHASERS';
      delete member.catchCode;
    } else if (newRole === 'REFEREE') {
      member.team = 'NONE';
      delete member.catchCode;
    } else {
      member.team = 'NONE';
      delete member.catchCode;
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    return { success: true, room };
  }

  public static async safetyPause(
    roomCode: string,
    initiatorId: string,
    reason?: string
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.state !== 'ACTIVE' && room.state !== 'RUNNER_HEADSTART') {
      return { success: false, error: 'Match is not in progress' };
    }

    room.state = 'SAFETY_PAUSED';
    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    await broadcastToRoom(room.roomCode, 'match:alert', {
      type: 'WARNING',
      title: 'Safety Pause Active',
      message: reason || 'Match paused for player safety.',
      timestamp: Date.now(),
    });
    return { success: true, room };
  }

  public static async resumeMatch(
    roomCode: string,
    initiatorId: string
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== initiatorId) {
      return { success: false, error: 'Only Host can resume paused match' };
    }
    if (room.state !== 'SAFETY_PAUSED') {
      return { success: false, error: 'Match is not paused' };
    }

    room.state = 'ACTIVE';
    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    await broadcastToRoom(room.roomCode, 'match:alert', {
      type: 'INFO',
      title: 'Match Resumed',
      message: 'Tactical pursuit active.',
      timestamp: Date.now(),
    });
    return { success: true, room };
  }

  public static async setRole(
    roomCode: string,
    playerId: string,
    role?: PlayerRole,
    team?: PlayerTeam
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const member = room.members[playerId];
    if (!member) return { success: false, error: 'Player not in room' };

    if (role) member.role = role;
    if (team) member.team = team;

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    return { success: true, room };
  }

  public static async updateConfig(
    roomCode: string,
    hostId: string,
    partialConfig: Partial<GameConfig>
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== hostId) return { success: false, error: 'Only the host can modify configuration' };

    room.config = {
      ...room.config,
      ...partialConfig,
      playZone: {
        ...room.config.playZone,
        ...(partialConfig.playZone || {}),
        version: (room.config.playZone?.version || 1) + 1,
        updatedAt: Date.now(),
        updatedBy: hostId,
      },
    };

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    return { success: true, room };
  }

  public static async startMatch(
    roomCode: string,
    hostId: string
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== hostId) return { success: false, error: 'Only host can start the match' };

    const runners = Object.values(room.members).filter((m) => m.team === 'RUNNERS');
    const chasers = Object.values(room.members).filter((m) => m.team === 'CHASERS');

    if (runners.length === 0 || chasers.length === 0) {
      return { success: false, error: 'Match requires at least one Runner and one Chaser assigned' };
    }

    const check = canTransitionState(room.state, 'READY_CHECK', 'HOST');
    if (!check.allowed && room.state !== 'LOBBY') {
      return { success: false, error: check.reason };
    }

    const now = Date.now();
    const headStartMs = (room.config.globalHeadStartSeconds ?? 120) * 1000;
    const matchDurationMs = (room.config.durationSeconds ?? 900) * 1000;

    let dynamicZoneState: DynamicZoneState | undefined;
    if (room.config.dynamicZone?.enabled) {
      const dz = room.config.dynamicZone;
      const initialR = dz.initialRadiusMeters || room.config.playZone.radiusMeters || 500;
      const minR = dz.minRadiusMeters || 100;
      const shrinkPct = Math.min(90, Math.max(5, dz.shrinkPercentage || 20));
      const nextR = Math.max(minR, Math.round(initialR * (1 - shrinkPct / 100)));
      dynamicZoneState = {
        currentRadiusMeters: initialR,
        nextRadiusMeters: nextR,
        currentPhase: 1,
        nextShrinkAt: now + headStartMs + (dz.shrinkIntervalSeconds || 180) * 1000,
        warningAt: now + headStartMs + ((dz.shrinkIntervalSeconds || 180) - (dz.warningDurationSeconds || 30)) * 1000,
        isWarningActive: false,
        isFinalZone: initialR <= minR,
      };
    }

    const scoreLedger = scoringService.createEmptyLedger(room.members);

    room.state = headStartMs > 0 ? 'RUNNER_HEADSTART' : 'ACTIVE';
    room.match = {
      startedAt: now,
      headStartEndsAt: now + headStartMs,
      gameStartedAt: now + headStartMs,
      gameEndsAt: now + headStartMs + matchDurationMs,
      totalDurationSeconds: room.config.durationSeconds,
      remainingSeconds: room.config.durationSeconds,
      totalPausedSeconds: 0,
      catches: [],
      dynamicZoneState,
      scoreLedger,
      activeMissions: {},
      completedMissions: [],
      sharedMissions: [],
    };

    // Initialize bases if not already configured
    if (!room.config.playZone.bases || room.config.playZone.bases.length === 0) {
      room.config.playZone.bases = generateRandomBases(room.config.playZone, 3);
    }

    missionService.initializeSharedMissions(room);

    const codeExpirySec = room.config.missions?.catchCodeExpirySeconds || 300;
    const seed = room.match?.startedAt || (room as any).createdAt || 12345;
    for (const m of Object.values(room.members)) {
      m.isCaught = false;
      m.isEliminated = false;
      delete m.caughtAt;
      if (m.team === 'RUNNERS') {
        const det = computeDeterministicCatchCode(room.roomCode, m.id, now, codeExpirySec, seed);
        m.catchCode = det.code;
        m.catchCodeExpiresAt = det.expiresAt;
      } else {
        delete m.catchCode;
        delete m.catchCodeExpiresAt;
      }
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);
    await broadcastToRoom(room.roomCode, 'match:started', { state: room.state, match: room.match });

    return { success: true, room };
  }

  public static async updateLocation(
    roomCode: string,
    playerId: string,
    location: PlayerLocation
  ): Promise<{ success: boolean; room?: ExtendedRoomState; completedMissions?: ActiveMission[]; alert?: any; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const member = room.members[playerId];
    if (!member) return { success: false, error: 'Player not found in room' };

    // Velocity sanity check against GPS spoofing
    if (member.lastLocation) {
      if (!checkVelocitySanity(member.lastLocation, location)) {
        return { success: false, error: 'Movement velocity exceeds allowable thresholds' };
      }
    }

    member.lastLocation = location;
    member.gpsStatus = 'GRANTED';

    // In LOBBY, if host location arrives and zone not confirmed by host, center the zone
    if (room.state === 'LOBBY' && room.hostId === playerId && !room.config.playZone.isHostConfirmed) {
      room.config.playZone.centerLat = location.latitude;
      room.config.playZone.centerLng = location.longitude;
      room.config.playZone.updatedAt = Date.now();
    }

    let completedMissions: ActiveMission[] = [];
    let alert: any = null;

    if (room.state === 'ACTIVE' || room.state === 'RUNNER_HEADSTART') {
      // Evaluate shared missions for active uncaught runners
      if (member.team === 'RUNNERS' && !member.isCaught) {
        const evalRes = missionService.evaluateSharedMissions(room, member, location);
        completedMissions = evalRes.completedMissions as any;
        if (evalRes.allCompleted && room.state === 'ACTIVE') {
          room.state = 'COMPLETED';
          if (room.match) {
            room.match.winnerTeam = 'RUNNERS';
            room.match.victoryReason = 'MISSION OBJECTIVES COMPLETE — All shared missions completed by Runners!';
            if (room.match.scoreLedger) {
              scoringService.resolveWinnerBonuses(
                room.match.scoreLedger,
                'RUNNERS',
                room.members,
                room.config.missions || missionService.getDefaultConfig()
              );
            }
            await broadcastToRoom(room.roomCode, 'match:victory', {
              winnerTeam: 'RUNNERS',
              reason: room.match.victoryReason,
              summary: room.match,
            });
          }
        }
      }

      // Check boundary constraints
      const activeZone =
        room.config.dynamicZone?.enabled && room.match?.dynamicZoneState
          ? {
              ...room.config.playZone,
              radiusMeters: room.match.dynamicZoneState.currentRadiusMeters,
            }
          : room.config.playZone;

      const boundary = checkPlayZoneBoundary(location, activeZone);
      if (!boundary.isInside) {
        alert = {
          type: 'BOUNDARY_WARNING',
          title: 'OUT OF BOUNDS!',
          message: 'You have left the designated play zone. Return immediately!',
          timestamp: Date.now(),
        };
      } else if (boundary.isApproachingBoundary) {
        alert = {
          type: 'BOUNDARY_WARNING',
          title: 'Approaching Boundary',
          message: `You are within ${Math.round(boundary.distanceToBoundary)}m of the boundary edge!`,
          timestamp: Date.now(),
        };
      }

      // Check excluded areas constraints
      if (room.config.playZone.excludedAreas && room.config.playZone.excludedAreas.length > 0) {
        const inExclusion = isPointInExcludedArea(location, room.config.playZone.excludedAreas);
        if (inExclusion.isInside) {
          alert = {
            type: 'EXCLUDED_AREA_WARNING',
            title: 'RESTRICTED SECTOR!',
            message: `Warning: You have entered restricted area "${inExclusion.areaName || 'Restricted Zone'}". Move away immediately!`,
            timestamp: Date.now(),
          };
        }
      }
    }

    await this.saveRawRoom(room);

    // Teammate live coordinate sync via Pusher broadcast
    if (member.team !== 'NONE') {
      await broadcastToRoom(room.roomCode, 'location:teammate_update', {
        playerId: member.id,
        nickname: member.nickname,
        team: member.team,
        location: member.lastLocation,
      });
    }

    return { success: true, room, completedMissions, alert };
  }

  public static async requestCatchCode(
    roomCode: string,
    runnerId: string
  ): Promise<{ success: boolean; catchCode?: string; expiresAt?: number; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.state !== 'ACTIVE' && room.state !== 'RUNNER_HEADSTART') {
      return { success: false, error: 'Match is not active' };
    }

    const runner = room.members[runnerId];
    if (!runner || runner.team !== 'RUNNERS' || runner.isCaught || runner.isEliminated) {
      return { success: false, error: 'Only active uncaught runners can generate catch codes' };
    }

    const now = Date.now();
    // Return existing code if still valid (stable code during validity window)
    if (runner.catchCode && runner.catchCodeExpiresAt && runner.catchCodeExpiresAt > now) {
      return { success: true, catchCode: runner.catchCode, expiresAt: runner.catchCodeExpiresAt };
    }

    const expirySec = room.config.missions?.catchCodeExpirySeconds || 300;
    const seed = room.match?.startedAt || (room as any).createdAt || 12345;
    const det = computeDeterministicCatchCode(roomCode, runnerId, now, expirySec, seed);

    runner.catchCode = det.code;
    runner.catchCodeExpiresAt = det.expiresAt;

    await this.saveRawRoom(room);
    return { success: true, catchCode: det.code, expiresAt: det.expiresAt };
  }

  public static async attemptCatchWithCode(
    roomCode: string,
    chaserId: string,
    runnerId: string,
    catchCode: string
  ): Promise<{
    success: boolean;
    catchAttempt?: CatchAttempt;
    catchResult?: { confirmed: boolean };
    room?: ExtendedRoomState;
    error?: string;
    attemptsRemaining?: number;
  }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    // Update room progress in case headstart elapsed
    this.updateRoomTimeProgress(room);

    if (room.state !== 'ACTIVE') {
      if (room.state === 'RUNNER_HEADSTART') {
        return { success: false, error: 'Cannot catch runners during Head Start phase' };
      }
      return { success: false, error: 'Catches only allowed during active match' };
    }

    const chaser = room.members[chaserId];
    const runner = room.members[runnerId];

    if (!chaser || chaser.team !== 'CHASERS') return { success: false, error: 'Only chasers can catch runners' };
    if (!runner) return { success: false, error: 'Target runner not found' };
    if (runner.isCaught || runner.isEliminated || runner.team !== 'RUNNERS') {
      return { success: false, error: 'Runner is already caught or eliminated' };
    }

    const now = Date.now();
    const failKey = `${chaserId}:${runnerId}`;
    const failInfo = this.failedCodeAttempts.get(failKey) || { count: 0, lastAttempt: 0 };

    if (failInfo.count >= 3 && now - failInfo.lastAttempt < 30000) {
      const waitSec = Math.ceil((30000 - (now - failInfo.lastAttempt)) / 1000);
      return {
        success: false,
        error: `Too many failed attempts! Locked out for ${waitSec}s`,
        attemptsRemaining: 0,
      };
    }

    const trimmedInput = catchCode.trim();
    const expirySec = room.config.missions?.catchCodeExpirySeconds || 300;
    const seed = room.match?.startedAt || (room as any).createdAt || 12345;
    const currentDet = computeDeterministicCatchCode(roomCode, runnerId, now, expirySec, seed);
    const prevDet = computeDeterministicCatchCode(roomCode, runnerId, now - 60000, expirySec, seed);

    if (runner.catchCodeExpiresAt && now > runner.catchCodeExpiresAt) {
      failInfo.count += 1;
      failInfo.lastAttempt = now;
      this.failedCodeAttempts.set(failKey, failInfo);
      return { success: false, error: 'Catch Code has expired. Request a new code.' };
    }

    const isMatch =
      (runner.catchCode && runner.catchCode === trimmedInput) ||
      currentDet.code === trimmedInput ||
      prevDet.code === trimmedInput;

    if (!isMatch) {
      failInfo.count += 1;
      failInfo.lastAttempt = now;
      this.failedCodeAttempts.set(failKey, failInfo);
      const remaining = Math.max(0, 3 - failInfo.count);
      return {
        success: false,
        error: 'Incorrect Catch Code. Verification failed.',
        attemptsRemaining: remaining,
      };
    }

    // Optional GPS proximity check if configured
    if (room.config.missions?.catchRequiresGpsProximity) {
      if (!chaser.lastLocation || !runner.lastLocation) {
        return { success: false, error: 'GPS proximity required for catch confirmation' };
      }
      const maxDistance = room.config.catchProximityThresholdMeters || 25;
      const validation = validateCatchProximity(chaser.lastLocation, runner.lastLocation, maxDistance);
      if (!validation.isValid) {
        return { success: false, error: `Distance is ${Math.round(validation.rawDistance)}m (Max allowed: ${maxDistance}m)` };
      }
    }

    // Clear failed attempts upon successful verification
    this.failedCodeAttempts.delete(failKey);

    // Mark caught atomically and immediately consume code
    runner.isCaught = true;
    runner.caughtAt = now;
    delete runner.catchCode;
    delete runner.catchCodeExpiresAt;

    if (room.config.missions?.caughtRunnerRule === 'CONVERT_TO_CHASER') {
      runner.team = 'CHASERS';
      runner.role = 'CHASER';
    } else {
      runner.isEliminated = true;
    }

    const catchAttempt: CatchAttempt = {
      id: 'catch_' + Math.random().toString(36).substring(2, 10),
      chaserId: chaser.id,
      chaserNickname: chaser.nickname,
      runnerId: runner.id,
      runnerNickname: runner.nickname,
      distanceMeters: chaser.lastLocation && runner.lastLocation
        ? Math.round(calculateHaversineDistance(
            chaser.lastLocation.latitude,
            chaser.lastLocation.longitude,
            runner.lastLocation.latitude,
            runner.lastLocation.longitude
          ))
        : 0,
      timestamp: now,
      status: 'CONFIRMED',
      verificationType: 'CODE_VERIFIED',
      resolvedBy: chaser.nickname,
    };

    if (room.match) {
      room.match.catches = room.match.catches || [];
      room.match.catches.push(catchAttempt);

      // Award catch points to chaser and chaser team
      if (room.match.scoreLedger) {
        scoringService.resolveCatchReward(room.match.scoreLedger, chaser, runner, room.config.missions || missionService.getDefaultConfig());
      }

      // Check if all runners caught
      const uncaughtRemaining = Object.values(room.members).filter(
        (m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated
      );

      if (uncaughtRemaining.length === 0 && room.config.missions?.earlyEndAllRunnersCaught !== false) {
        room.state = 'COMPLETED';
        if (room.match) {
          room.match.winnerTeam = 'CHASERS';
          room.match.victoryReason = 'ALL RUNNERS ELIMINATED — Chasers apprehended every target!';
          if (room.match.scoreLedger) {
            scoringService.resolveWinnerBonuses(
              room.match.scoreLedger,
              'CHASERS',
              room.members,
              room.config.missions || missionService.getDefaultConfig()
            );
          }
          await broadcastToRoom(room.roomCode, 'match:victory', {
            winnerTeam: 'CHASERS',
            reason: room.match.victoryReason,
            summary: room.match,
          });
        }
      }
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'catch:confirmed', catchAttempt);
    await broadcastToRoom(room.roomCode, 'room:update', room);

    return { success: true, catchAttempt, room };
  }

  public static async attemptCatchProximity(
    roomCode: string,
    chaserId: string,
    runnerId: string
  ): Promise<{
    success: boolean;
    catchAttempt?: CatchAttempt;
    room?: ExtendedRoomState;
    error?: string;
  }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    this.updateRoomTimeProgress(room);
    if (room.state !== 'ACTIVE') {
      if (room.state === 'RUNNER_HEADSTART') {
        return { success: false, error: 'Cannot catch runners during Head Start phase' };
      }
      return { success: false, error: 'Catches only allowed during active match' };
    }

    const chaser = room.members[chaserId];
    const runner = room.members[runnerId];

    if (!chaser || chaser.team !== 'CHASERS') return { success: false, error: 'Only chasers can catch runners' };
    if (!runner) return { success: false, error: 'Target runner not found' };
    if (runner.isCaught || runner.isEliminated || runner.team !== 'RUNNERS') {
      return { success: false, error: 'Runner is already caught or eliminated' };
    }

    if (!chaser.lastLocation || !runner.lastLocation) {
      return { success: false, error: 'GPS location required for both players to verify proximity' };
    }

    const maxDistance = room.config.catchProximityThresholdMeters || 25;
    const validation = validateCatchProximity(chaser.lastLocation, runner.lastLocation, maxDistance);
    if (!validation.isValid) {
      return { success: false, error: `Distance is ${Math.round(validation.rawDistance)}m (Max allowed: ${maxDistance}m)` };
    }

    const now = Date.now();
    runner.isCaught = true;
    runner.caughtAt = now;
    delete runner.catchCode;
    delete runner.catchCodeExpiresAt;

    if (room.config.missions?.caughtRunnerRule === 'CONVERT_TO_CHASER') {
      runner.team = 'CHASERS';
      runner.role = 'CHASER';
    } else {
      runner.isEliminated = true;
    }

    const catchAttempt: CatchAttempt = {
      id: 'catch_' + Math.random().toString(36).substring(2, 10),
      chaserId: chaser.id,
      chaserNickname: chaser.nickname,
      runnerId: runner.id,
      runnerNickname: runner.nickname,
      distanceMeters: Math.round(validation.rawDistance),
      timestamp: now,
      status: 'CONFIRMED',
      verificationType: 'PROXIMITY_CONFIRMED',
      resolvedBy: chaser.nickname,
    };

    if (room.match) {
      room.match.catches = room.match.catches || [];
      room.match.catches.push(catchAttempt);

      if (room.match.scoreLedger) {
        scoringService.resolveCatchReward(room.match.scoreLedger, chaser, runner, room.config.missions || missionService.getDefaultConfig());
      }

      const uncaughtRemaining = Object.values(room.members).filter(
        (m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated
      );

      if (uncaughtRemaining.length === 0 && room.config.missions?.earlyEndAllRunnersCaught !== false) {
        room.state = 'COMPLETED';
        if (room.match) {
          room.match.winnerTeam = 'CHASERS';
          room.match.victoryReason = 'ALL RUNNERS ELIMINATED — Chasers apprehended every target!';
          if (room.match.scoreLedger) {
            scoringService.resolveWinnerBonuses(
              room.match.scoreLedger,
              'CHASERS',
              room.members,
              room.config.missions || missionService.getDefaultConfig()
            );
          }
          await broadcastToRoom(room.roomCode, 'match:victory', {
            winnerTeam: 'CHASERS',
            reason: room.match.victoryReason,
            summary: room.match,
          });
        }
      }
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'catch:confirmed', catchAttempt);
    await broadcastToRoom(room.roomCode, 'room:update', room);

    return { success: true, catchAttempt, room };
  }

  public static async sendChatMessage(
    roomCode: string,
    msg: {
      senderId: string;
      senderNickname: string;
      senderTeam: PlayerTeam;
      channelId: string;
      text: string;
      recipientType?: 'ALL' | 'TEAM' | 'DIRECT';
      recipientId?: string;
    }
  ): Promise<{ success: boolean; chatMessage?: ChatMessage; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const chatMessage: ChatMessage = {
      id: 'msg_' + Math.random().toString(36).substring(2, 10),
      roomCode: room.roomCode,
      channelId: msg.channelId || 'PUBLIC',
      conversationId: msg.channelId || 'PUBLIC',
      senderId: msg.senderId,
      senderNickname: msg.senderNickname,
      senderTeam: msg.senderTeam || 'NONE',
      recipientType: msg.recipientType || (msg.channelId === 'PUBLIC' ? 'ALL' : 'TEAM'),
      recipientId: msg.recipientId,
      text: msg.text.trim(),
      timestamp: Date.now(),
    };

    room.chatMessages = room.chatMessages || [];
    room.chatMessages.push(chatMessage);
    if (room.chatMessages.length > 100) {
      room.chatMessages = room.chatMessages.slice(-100);
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'chat:message', chatMessage);

    return { success: true, chatMessage };
  }

  public static async uploadRadioTransmission(
    roomCode: string,
    transmission: {
      senderId: string;
      senderNickname: string;
      team: PlayerTeam;
      audioUrl: string;
      durationMs?: number;
    }
  ): Promise<{ success: boolean; transmission?: RadioTransmission; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const record: RadioTransmission = {
      id: 'radio_' + Math.random().toString(36).substring(2, 10),
      senderId: transmission.senderId,
      senderNickname: transmission.senderNickname,
      team: transmission.team,
      audioUrl: transmission.audioUrl,
      durationMs: transmission.durationMs || 3000,
      timestamp: Date.now(),
    };

    room.radioTransmissions = room.radioTransmissions || [];
    room.radioTransmissions.push(record);
    if (room.radioTransmissions.length > 50) {
      room.radioTransmissions = room.radioTransmissions.slice(-50);
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'radio:transmission', record);

    return { success: true, transmission: record };
  }

  public static async joinVoiceChannel(
    roomCode: string,
    playerId: string,
    channelId: VoiceChannelId
  ): Promise<{ success: boolean; participants?: VoiceParticipant[]; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const member = room.members[playerId];
    if (!member) return { success: false, error: 'Player not in room' };

    // Squad radio requires active squad assignment
    if (channelId === 'SQUAD') {
      if (member.team === 'NONE' && member.role !== 'REFEREE') {
        return { success: false, error: 'Only assigned Runners or Chasers can join Squad Radio' };
      }
    }

    room.voiceParticipants = room.voiceParticipants || {};

    const participant: VoiceParticipant = {
      playerId,
      nickname: member.nickname,
      team: member.team,
      isSpeaking: false,
      isMuted: false,
      channelId,
      joinedAt: Date.now(),
    };

    room.voiceParticipants[playerId] = participant;

    // Filter visible existing participants according to squad isolation rules
    const visibleParticipants: VoiceParticipant[] = [];
    for (const other of Object.values(room.voiceParticipants)) {
      if (other.playerId === playerId) continue;
      if (other.channelId !== channelId) continue;
      const otherMember = room.members[other.playerId];
      if (!otherMember) continue;

      if (channelId === 'SQUAD') {
        if (member.role !== 'REFEREE' && otherMember.role !== 'REFEREE') {
          if (member.team === 'NONE' || member.team !== otherMember.team) {
            continue;
          }
        }
      }
      visibleParticipants.push(other);
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'voice:user_joined', participant);

    return { success: true, participants: visibleParticipants };
  }

  public static async leaveVoiceChannel(
    roomCode: string,
    playerId: string
  ): Promise<{ success: boolean; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.voiceParticipants && room.voiceParticipants[playerId]) {
      const channelId = room.voiceParticipants[playerId].channelId;
      delete room.voiceParticipants[playerId];
      await this.saveRawRoom(room);
      await broadcastToRoom(room.roomCode, 'voice:user_left', { playerId, channelId });
    }

    return { success: true };
  }

  public static async setVoiceSpeaking(
    roomCode: string,
    playerId: string,
    channelIdOrSpeaking: string | boolean,
    maybeSpeaking?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const channelId = typeof channelIdOrSpeaking === 'string' 
      ? channelIdOrSpeaking 
      : (room.voiceParticipants?.[playerId]?.channelId || 'PUBLIC');
    const isSpeaking = typeof channelIdOrSpeaking === 'boolean' 
      ? channelIdOrSpeaking 
      : !!maybeSpeaking;

    if (room.voiceParticipants && room.voiceParticipants[playerId]) {
      room.voiceParticipants[playerId].isSpeaking = isSpeaking;
      await this.saveRawRoom(room);
      await broadcastToRoom(room.roomCode, 'voice:speaking_changed', {
        playerId,
        channelId,
        isSpeaking,
      });
    }

    return { success: true };
  }

  public static async recordVoiceSignal(
    roomCode: string,
    payloadOrSenderId: {
      fromPlayerId?: string;
      senderId?: string;
      toPlayerId?: string;
      targetPlayerId?: string;
      channelId?: string;
      signal: any;
    } | string,
    maybeTargetId?: string,
    maybeSignal?: any,
    maybeChannelId?: string
  ): Promise<{ success: boolean; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    let senderId: string | undefined;
    let targetPlayerId: string | undefined;
    let channelId: string | undefined;
    let signal: any;

    if (typeof payloadOrSenderId === 'string') {
      senderId = payloadOrSenderId;
      targetPlayerId = maybeTargetId;
      signal = maybeSignal;
      channelId = maybeChannelId || room.voiceParticipants?.[senderId]?.channelId || 'PUBLIC';
    } else {
      senderId = payloadOrSenderId.senderId || payloadOrSenderId.fromPlayerId;
      targetPlayerId = payloadOrSenderId.targetPlayerId || payloadOrSenderId.toPlayerId;
      channelId = payloadOrSenderId.channelId || (senderId ? room.voiceParticipants?.[senderId]?.channelId : undefined) || 'PUBLIC';
      signal = payloadOrSenderId.signal;
    }

    if (!senderId) return { success: false, error: 'Sender ID required' };

    const senderMember = room.members[senderId];
    if (!senderMember) return { success: false, error: 'Sender not in room' };

    // Squad isolation check
    if (channelId === 'SQUAD' && targetPlayerId) {
      const targetMember = room.members[targetPlayerId];
      if (targetMember && senderMember.role !== 'REFEREE' && targetMember.role !== 'REFEREE') {
        if (senderMember.team === 'NONE' || senderMember.team !== targetMember.team) {
          return { success: false, error: 'Squad voice isolation violation: cannot signal across enemy teams' };
        }
      }
    }

    const record = {
      id: 'sig_' + Math.random().toString(36).substring(2, 10),
      senderId,
      fromPlayerId: senderId,
      targetPlayerId,
      toPlayerId: targetPlayerId,
      channelId,
      signal,
      timestamp: Date.now(),
    };

    room.voiceSignals = room.voiceSignals || [];
    room.voiceSignals.push(record);
    if (room.voiceSignals.length > 50) {
      room.voiceSignals = room.voiceSignals.slice(-50);
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'voice:signal', record);

    return { success: true };
  }

  public static async answerLandmarkClue(
    roomCode: string,
    runnerId: string,
    answer: string
  ): Promise<{ success: boolean; completed?: boolean; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const res = missionService.answerLandmarkClue(room, runnerId, answer);
    if (res.success) {
      await this.saveRawRoom(room);
      await broadcastToRoom(room.roomCode, 'room:update', room);
    }
    return res;
  }

  /**
   * Sanitizes room state according to player team visibility rules:
   * Chasers cannot see live runner coordinates unless in headstart or via 120s snapshots.
   */
  public static sanitizeRoomForPlayer(room: ExtendedRoomState, playerId?: string): RoomState {
    const player = playerId ? room.members[playerId] : undefined;
    const isChaser = player?.team === 'CHASERS';

    // Clone members
    const sanitizedMembers: Record<string, PlayerMember> = {};
    for (const [id, m] of Object.entries(room.members)) {
      const clone = { ...m };

      // Redact catch code for anyone who is not this runner
      if (id !== playerId) {
        delete clone.catchCode;
        delete clone.catchCodeExpiresAt;
      }

      // Redact exact live GPS of uncaught runners for chasers during active match
      if (
        isChaser &&
        m.team === 'RUNNERS' &&
        !m.isCaught &&
        room.state === 'ACTIVE'
      ) {
        delete clone.lastLocation;
      }

      sanitizedMembers[id] = clone;
    }

    return {
      roomCode: room.roomCode,
      hostId: room.hostId,
      state: room.state,
      config: room.config,
      members: sanitizedMembers,
      match: room.match,
      version: room.version,
      updatedAt: room.updatedAt,
    };
  }

  public static async hydrateRoom(
    roomState: any,
    requesterId?: string
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    if (!roomState || !roomState.roomCode) {
      return { success: false, error: 'Invalid room state provided for hydration' };
    }
    const code = roomState.roomCode.toUpperCase().trim();
    const existing = await this.getRawRoom(code);

    if (existing && existing.version >= (roomState.version || 0)) {
      // Check if roomState contains any members missing from existing
      let hasMissing = false;
      if (roomState.members && typeof roomState.members === 'object') {
        for (const [mId, mData] of Object.entries(roomState.members)) {
          if (!existing.members[mId]) {
            existing.members[mId] = mData as PlayerMember;
            hasMissing = true;
          } else {
            // If incoming member has catchCode and existing lacks it (e.g. runner generated new code)
            if ((mData as any).catchCode && !existing.members[mId].catchCode) {
              existing.members[mId].catchCode = (mData as any).catchCode;
              existing.members[mId].catchCodeExpiresAt = (mData as any).catchCodeExpiresAt;
              hasMissing = true;
            }
          }
        }
      }
      if (hasMissing) {
        existing.version = (existing.version || 1) + 1;
        existing.updatedAt = Date.now();
        await this.saveRawRoom(existing);
      }
      return { success: true, room: existing };
    }

    // roomState is newer than existing: merge existing members into roomState so no concurrent joins are lost
    const mergedMembers = { ...(roomState.members || {}) };
    if (existing?.members) {
      for (const [mId, mData] of Object.entries(existing.members)) {
        if (!mergedMembers[mId]) {
          mergedMembers[mId] = mData;
        } else {
          // CRITICAL: Preserve existing catchCode if incoming member lacks it!
          // Client state from Chasers or non-owners has catchCode redacted (undefined).
          // If server's existing record has an active catchCode, preserve it!
          if (mData.catchCode && !mergedMembers[mId].catchCode) {
            mergedMembers[mId].catchCode = mData.catchCode;
            mergedMembers[mId].catchCodeExpiresAt = mData.catchCodeExpiresAt;
          }
        }
      }
    }

    const extended: ExtendedRoomState = {
      ...roomState,
      roomCode: code,
      members: mergedMembers,
      version: Math.max(existing?.version || 0, roomState.version || 1),
      updatedAt: Date.now(),
      chatMessages: roomState.chatMessages || existing?.chatMessages || [],
      radioTransmissions: roomState.radioTransmissions || existing?.radioTransmissions || [],
      voiceParticipants: roomState.voiceParticipants || existing?.voiceParticipants || {},
      voiceSignals: roomState.voiceSignals || existing?.voiceSignals || [],
    };

    await this.saveRawRoom(extended);
    return { success: true, room: extended };
  }

  public static async getSyncState(
    roomCode: string,
    playerId?: string,
    sinceVersion?: number,
    minMembers?: number
  ): Promise<{
    changed: boolean;
    version: number;
    room?: RoomState;
    chatMessages?: ChatMessage[];
    radioTransmissions?: RadioTransmission[];
    voiceSignals?: any[];
    voiceParticipants?: VoiceParticipant[];
    needsHydration?: boolean;
  }> {
    const room = await this.getRoom(roomCode);
    if (!room) {
      return { changed: false, version: 0, needsHydration: true };
    }

    if (minMembers && Object.keys(room.members || {}).length < minMembers) {
      return { changed: false, version: room.version, needsHydration: true };
    }

    if (sinceVersion && room.version < sinceVersion) {
      return { changed: false, version: room.version, needsHydration: true };
    }

    const sanitizedRoom = this.sanitizeRoomForPlayer(room, playerId);
    const player = playerId ? room.members[playerId] : undefined;

    // Filter voice signals directed to this player (within last 45s)
    const now = Date.now();
    const filteredSignals = (room.voiceSignals || [])
      .filter((sig) => {
        if (sig.timestamp && now - sig.timestamp > 45000) return false;
        const target = sig.toPlayerId || (sig as any).targetPlayerId;
        if (!target) return true;
        return target === playerId;
      })
      .map((sig) => ({
        ...sig,
        senderId: (sig as any).senderId || sig.fromPlayerId,
        targetPlayerId: (sig as any).targetPlayerId || sig.toPlayerId,
      }));

    // Filter voice participants visible to this player
    const visibleVoiceParticipants: VoiceParticipant[] = [];
    if (room.voiceParticipants) {
      for (const [pId, part] of Object.entries(room.voiceParticipants)) {
        if (part.channelId === 'PUBLIC') {
          visibleVoiceParticipants.push(part);
        } else if (part.channelId === 'SQUAD') {
          const otherMember = room.members[pId];
          if (
            player?.role === 'REFEREE' ||
            otherMember?.role === 'REFEREE' ||
            (player && otherMember && player.team !== 'NONE' && player.team === otherMember.team)
          ) {
            visibleVoiceParticipants.push(part);
          }
        }
      }
    }

    if (sinceVersion && room.version <= sinceVersion) {
      // If there are voice signals directed to this player, return them immediately
      if (filteredSignals.length > 0) {
        return {
          changed: true,
          version: room.version,
          voiceSignals: filteredSignals,
          voiceParticipants: visibleVoiceParticipants,
        };
      }
      return { changed: false, version: room.version };
    }

    // Filter chat messages visible to this player
    const filteredChat = (room.chatMessages || []).filter((msg) => {
      if (msg.channelId === 'PUBLIC' || msg.recipientType === 'ALL') return true;
      if (player && msg.senderTeam === player.team) return true;
      if (msg.recipientId && msg.recipientId === playerId) return true;
      if (msg.senderId === playerId) return true;
      return false;
    });

    return {
      changed: true,
      version: room.version,
      room: sanitizedRoom,
      chatMessages: filteredChat,
      radioTransmissions: room.radioTransmissions || [],
      voiceSignals: filteredSignals,
      voiceParticipants: visibleVoiceParticipants,
    };
  }

  public static async randomizeBases(
    roomCode: string,
    hostId: string,
    count: number = 3
  ): Promise<{ success: boolean; room?: ExtendedRoomState; bases?: TacticalMarker[]; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== hostId) return { success: false, error: 'Only host can randomize bases' };
    if (room.state !== 'LOBBY') return { success: false, error: 'Bases can only be randomized in pre-match lobby' };

    const bases = generateRandomBases(room.config.playZone, count);
    room.config.playZone.bases = bases;
    room.config.playZone.version = (room.config.playZone.version || 1) + 1;
    room.config.playZone.updatedAt = Date.now();
    room.config.playZone.updatedBy = hostId;

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);

    return { success: true, room, bases };
  }

  public static async updateExcludedAreas(
    roomCode: string,
    hostId: string,
    excludedAreas: ExcludedArea[]
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== hostId) return { success: false, error: 'Only host can configure excluded areas' };
    if (room.state !== 'LOBBY') return { success: false, error: 'Excluded areas can only be changed before match starts' };

    room.config.playZone.excludedAreas = excludedAreas;
    room.config.playZone.version = (room.config.playZone.version || 1) + 1;
    room.config.playZone.updatedAt = Date.now();
    room.config.playZone.updatedBy = hostId;

    // Filter out any existing bases that now lie inside an excluded area
    if (room.config.playZone.bases && room.config.playZone.bases.length > 0) {
      room.config.playZone.bases = room.config.playZone.bases.filter((base) => {
        const inExcl = isPointInExcludedArea(
          { latitude: base.lat, longitude: base.lng },
          excludedAreas
        );
        return !inExcl.isInside;
      });
      if (room.config.playZone.bases.length < 3) {
        room.config.playZone.bases = generateRandomBases(room.config.playZone, 3);
      }
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);

    return { success: true, room };
  }

  public static async confirmPlayZone(
    roomCode: string,
    hostId: string,
    playZoneUpdate: Partial<PlayZone>
  ): Promise<{ success: boolean; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== hostId) return { success: false, error: 'Only host can confirm the play zone' };

    room.config.playZone = {
      ...room.config.playZone,
      ...playZoneUpdate,
      isHostConfirmed: true,
      version: (room.config.playZone.version || 1) + 1,
      updatedAt: Date.now(),
      updatedBy: hostId,
    };

    // Ensure bases are placed outside exclusions
    if (!room.config.playZone.bases || room.config.playZone.bases.length === 0) {
      room.config.playZone.bases = generateRandomBases(room.config.playZone, 3);
    }

    await this.saveRawRoom(room);
    await broadcastToRoom(room.roomCode, 'room:update', room);

    return { success: true, room };
  }
}
