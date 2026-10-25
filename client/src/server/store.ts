import { Redis } from '@upstash/redis';
import {
  ActiveMission,
  CatchAttempt,
  ChatMessage,
  DynamicZoneState,
  GameConfig,
  GameState,
  MapPoint,
  MatchSummary,
  PlayerLocation,
  PlayerMember,
  PlayerRole,
  PlayerTeam,
  RadioTransmission,
  RoomState,
} from '../types/game';
import { calculateHaversineDistance, checkPlayZoneBoundary, checkVelocitySanity, validateCatchProximity } from './geo';
import { canTransitionState } from './stateMachine';
import { ScoringService } from './scoring';
import { MissionService } from './missions';
import { broadcastToRoom } from './realtime';

export interface ExtendedRoomState extends RoomState {
  version: number;
  updatedAt: number;
  chatMessages: ChatMessage[];
  radioTransmissions: RadioTransmission[];
  voiceSignals: Array<{
    id: string;
    fromPlayerId: string;
    toPlayerId?: string;
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

function getDefaultConfig(): GameConfig {
  return {
    gameMode: 'CLASSIC_MANHUNT',
    durationSeconds: 900,
    playZone: {
      shapeType: 'CIRCLE',
      centerLat: 37.7749,
      centerLng: -122.4194,
      radiusMeters: 500,
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

export class GameStateStore {
  private static async getRawRoom(roomCode: string): Promise<ExtendedRoomState | null> {
    const code = roomCode.toUpperCase().trim();
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
    return memoryStore.get(code) || null;
  }

  private static async saveRawRoom(room: ExtendedRoomState): Promise<void> {
    const code = room.roomCode.toUpperCase().trim();
    room.version = (room.version || 0) + 1;
    room.updatedAt = Date.now();
    memoryStore.set(code, room);

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
      const totalDuration = room.match.totalDurationSeconds || room.config.durationSeconds || 900;
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
      const completedMilestones = missionService.checkSurvivalMilestones(room);
      if (completedMilestones.length > 0) {
        mutated = true;
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
      if (remaining <= 0) {
        room.state = 'COMPLETED';
        mutated = true;

        if (room.match.scoreLedger) {
          const outcome = scoringService.determineWinningTeam(
            room.match.scoreLedger,
            room.members,
            room.config.missions?.tieBreakerRule || 'DRAW'
          );
          room.match.winnerTeam = outcome.winner;
          if (outcome.winner === 'RUNNERS' || outcome.winner === 'CHASERS') {
            scoringService.resolveWinnerBonuses(
              room.match.scoreLedger,
              outcome.winner,
              room.members,
              room.config.missions || missionService.getDefaultConfig()
            );
          }
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
      gpsStatus: 'GRANTED',
    };

    const room: ExtendedRoomState = {
      roomCode: code,
      hostId: host.id,
      state: 'LOBBY',
      config: getDefaultConfig(),
      members: {
        [host.id]: hostMember,
      },
      version: 1,
      updatedAt: Date.now(),
      chatMessages: [],
      radioTransmissions: [],
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
    const headStartMs = (room.config.globalHeadStartSeconds || 120) * 1000;
    const matchDurationMs = (room.config.durationSeconds || 900) * 1000;

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
    };

    missionService.initializeMatchMissions(room);

    for (const m of Object.values(room.members)) {
      m.isCaught = false;
      m.isEliminated = false;
      delete m.caughtAt;
      delete m.catchCode;
      delete m.catchCodeExpiresAt;
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

    let completedMissions: ActiveMission[] = [];
    let alert: any = null;

    if (room.state === 'ACTIVE' || room.state === 'RUNNER_HEADSTART') {
      // Evaluate active missions for runners
      if (member.team === 'RUNNERS' && !member.isCaught) {
        const evalRes = missionService.evaluateMissionProgress(room, playerId, location);
        completedMissions = evalRes.completedMissions;
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

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expirySec = room.config.missions?.catchCodeExpirySeconds || 30;
    const expiresAt = Date.now() + expirySec * 1000;

    runner.catchCode = code;
    runner.catchCodeExpiresAt = expiresAt;

    await this.saveRawRoom(room);
    return { success: true, catchCode: code, expiresAt };
  }

  public static async attemptCatchWithCode(
    roomCode: string,
    chaserId: string,
    runnerId: string,
    catchCode: string
  ): Promise<{ success: boolean; catchAttempt?: CatchAttempt; room?: ExtendedRoomState; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.state !== 'ACTIVE') return { success: false, error: 'Catches only allowed during active match' };

    const chaser = room.members[chaserId];
    const runner = room.members[runnerId];

    if (!chaser || chaser.team !== 'CHASERS') return { success: false, error: 'Only chasers can catch runners' };
    if (!runner || runner.team !== 'RUNNERS') return { success: false, error: 'Target must be an active runner' };
    if (runner.isCaught) return { success: false, error: 'Runner is already caught' };

    const now = Date.now();
    if (!runner.catchCode || runner.catchCode !== catchCode.trim()) {
      return { success: false, error: 'Incorrect Catch Code. Verification failed.' };
    }

    if (runner.catchCodeExpiresAt && now > runner.catchCodeExpiresAt) {
      return { success: false, error: 'Catch Code has expired. Request a new code.' };
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

    // Mark caught
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
        room.match.winnerTeam = 'CHASERS';
        scoringService.resolveWinnerBonuses(
          room.match.scoreLedger!,
          'CHASERS',
          room.members,
          room.config.missions || missionService.getDefaultConfig()
        );
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

  public static async recordVoiceSignal(
    roomCode: string,
    signalPayload: {
      fromPlayerId: string;
      toPlayerId?: string;
      channelId: string;
      signal: any;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const room = await this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const record = {
      id: 'sig_' + Math.random().toString(36).substring(2, 10),
      fromPlayerId: signalPayload.fromPlayerId,
      toPlayerId: signalPayload.toPlayerId,
      channelId: signalPayload.channelId,
      signal: signalPayload.signal,
      timestamp: Date.now(),
    };

    room.voiceSignals = room.voiceSignals || [];
    room.voiceSignals.push(record);
    if (room.voiceSignals.length > 30) {
      room.voiceSignals = room.voiceSignals.slice(-30);
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
    };
  }

  public static async getSyncState(
    roomCode: string,
    playerId?: string,
    sinceVersion?: number
  ): Promise<{
    changed: boolean;
    version: number;
    room?: RoomState;
    chatMessages?: ChatMessage[];
    radioTransmissions?: RadioTransmission[];
    voiceSignals?: any[];
  }> {
    const room = await this.getRoom(roomCode);
    if (!room) {
      return { changed: false, version: 0 };
    }

    if (sinceVersion && room.version <= sinceVersion) {
      return { changed: false, version: room.version };
    }

    const sanitizedRoom = this.sanitizeRoomForPlayer(room, playerId);

    // Filter chat messages visible to this player
    const player = playerId ? room.members[playerId] : undefined;
    const filteredChat = (room.chatMessages || []).filter((msg) => {
      if (msg.channelId === 'PUBLIC' || msg.recipientType === 'ALL') return true;
      if (player && msg.senderTeam === player.team) return true;
      if (msg.recipientId && msg.recipientId === playerId) return true;
      if (msg.senderId === playerId) return true;
      return false;
    });

    // Filter voice signals directed to this player
    const filteredSignals = (room.voiceSignals || []).filter((sig) => {
      if (!sig.toPlayerId) return true;
      return sig.toPlayerId === playerId;
    });

    return {
      changed: true,
      version: room.version,
      room: sanitizedRoom,
      chatMessages: filteredChat,
      radioTransmissions: room.radioTransmissions || [],
      voiceSignals: filteredSignals,
    };
  }
}
