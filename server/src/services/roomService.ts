import {
  GameConfig,
  PlayerMember,
  PlayerRole,
  PlayerTeam,
  RoomState,
  PlayZone,
} from '../types/game.js';
import { validatePlayZone } from '../engine/geo.js';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return code;
}

function generateCatchCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export class RoomService {
  private rooms: Map<string, RoomState> = new Map();

  /**
   * Creates a new private game room with host.
   */
  public createRoom(
    hostPlayerId: string,
    hostSocketId: string,
    hostNickname: string
  ): RoomState {
    let roomCode = generateRoomCode();
    while (this.rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const initialConfig: GameConfig = {
      gameMode: 'CLASSIC_MANHUNT',
      durationSeconds: 900, // 15 minutes
      playZone: {
        centerLat: 51.5074, // Default placeholder center (will auto-align with host GPS upon acquisition)
        centerLng: -0.1278,
        radiusMeters: 500,
      },
      pingIntervalSeconds: 45,
      runnerSnapshotIntervalSeconds: 120, // 120s scheduled snapshots to chasers
      globalHeadStartSeconds: 120, // 2 minutes
      targetChaserCount: 1, // Default 1 chaser
      radioEnabled: true,
      catchProximityThresholdMeters: 25,
      dynamicZone: {
        enabled: false,
        initialRadiusMeters: 500,
        shrinkIntervalSeconds: 180,
        shrinkPercentage: 20,
        minRadiusMeters: 100,
        initialDelaySeconds: 120,
        warningDurationSeconds: 30,
      },
      missions: {
        enabled: true,
        enabledMissionTypes: [
          'SECURE_POINT',
          'CHECKPOINT_RUN',
          'SURVIVAL_MILESTONE',
          'LANDMARK_RECON',
        ],
        difficultyWeights: {
          easy: 45,
          medium: 35,
          hard: 20,
        },
        rewards: {
          securePoint: { individual: 100, team: 100 },
          checkpointRun: { individual: 150, team: 150 },
          survivalMilestone: { individual: 50, team: 50 },
          closeEncounter: { individual: 150, team: 150 },
          landmarkRecon: { individual: 100, team: 100 },
        },
        securePointRadiusMeters: 25,
        securePointDurationSeconds: 90,
        securePointLeaveBehavior: 'RESET',
        checkpointCount: 3,
        checkpointDeadlineSeconds: 480,
        survivalMilestoneSeconds: 300,
        closeEncounterDistanceMeters: 50,
        closeEncounterDurationSeconds: 60,
        landmarkRadiusMeters: 25,
        catchCodeExpirySeconds: 30,
        catchRequiresGpsProximity: false,
        catchGpsFreshnessSeconds: 30,
        caughtRunnerRule: 'CONVERT_TO_CHASER',
        catchReward: { individual: 100, team: 100 },
        winningTeamBonus: 200,
        winningIndividualBonus: 100,
        earlyEndAllRunnersCaught: true,
        tieBreakerRule: 'DRAW',
      },
    };

    const hostMember: PlayerMember = {
      id: hostPlayerId,
      socketId: hostSocketId,
      nickname: hostNickname,
      role: 'HOST',
      team: 'NONE', // Host starts in Waiting Room, ready for assignment
      isReady: true,
      gpsStatus: 'PROMPT',
    };

    const roomState: RoomState = {
      roomCode,
      hostId: hostPlayerId,
      state: 'LOBBY',
      config: initialConfig,
      members: {
        [hostPlayerId]: hostMember,
      },
    };

    this.rooms.set(roomCode, roomState);
    return roomState;
  }

  public getRoom(roomCode: string): RoomState | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  public joinRoom(
    roomCode: string,
    playerId: string,
    socketId: string,
    nickname: string
  ): { success: boolean; room?: RoomState; error?: string } {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    if (room.state !== 'LOBBY' && !room.members[playerId]) {
      return { success: false, error: 'Match already in progress' };
    }

    // Reconnection or new member
    const existing = room.members[playerId];
    if (existing) {
      existing.socketId = socketId;
      existing.nickname = nickname || existing.nickname;
    } else {
      // New players join with catchCode generated and in Waiting Room (team: 'NONE')
      room.members[playerId] = {
        id: playerId,
        socketId,
        nickname: nickname || `Operative_${Object.keys(room.members).length + 1}`,
        role: 'RUNNER',
        team: 'NONE',
        isReady: false,
        gpsStatus: 'PROMPT',
        catchCode: generateCatchCode(),
      };
    }

    return { success: true, room };
  }

  public findRoomByMemberId(memberId: string): RoomState | undefined {
    for (const room of this.rooms.values()) {
      if (room.members[memberId]) {
        return room;
      }
    }
    return undefined;
  }

  public findRoomBySocketId(socketId: string): { room: RoomState; member: PlayerMember } | undefined {
    for (const room of this.rooms.values()) {
      for (const member of Object.values(room.members)) {
        if (member.socketId === socketId) {
          return { room, member };
        }
      }
    }
    return undefined;
  }

  public updateConfig(
    roomCode: string,
    requesterId: string,
    partialConfig: Partial<GameConfig>
  ): { success: boolean; room?: RoomState; error?: string } {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId)
      return { success: false, error: 'Only the Host can update configuration' };

    if (room.state !== 'LOBBY' && room.state !== 'READY_CHECK') {
      return {
        success: false,
        error: 'Settings are locked while match is in progress or completed',
      };
    }

    if (partialConfig.durationSeconds !== undefined && (partialConfig.durationSeconds < 60 || partialConfig.durationSeconds > 7200)) {
      return { success: false, error: 'Match duration must be between 1 and 120 minutes' };
    }

    const mergedMissions = partialConfig.missions
      ? {
          ...(room.config.missions || {}),
          ...partialConfig.missions,
        }
      : room.config.missions;

    room.config = {
      ...room.config,
      ...partialConfig,
      playZone: {
        ...room.config.playZone,
        ...(partialConfig.playZone || {}),
      },
      missions: mergedMissions,
    };

    return { success: true, room };
  }

  /**
   * Host updates the playable area boundary with geometry validation and revision control.
   */
  public updatePlayZone(
    roomCode: string,
    requesterId: string,
    playZone: PlayZone
  ): { success: boolean; room?: RoomState; error?: string; warning?: string } {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId)
      return { success: false, error: 'Only the Host can configure the play area' };
    if (room.state !== 'LOBBY' && room.state !== 'READY_CHECK') {
      return {
        success: false,
        error: 'Cannot modify play area while match is active or in progress',
      };
    }

    const currentVersion = room.config.playZone?.version || 0;
    const incomingVersion =
      typeof playZone.version === 'number' && playZone.version > 0
        ? playZone.version
        : currentVersion + 1;

    // Revision check: prevent older or duplicate revision overwrite
    if (
      typeof playZone.version === 'number' &&
      playZone.version > 0 &&
      playZone.version <= currentVersion
    ) {
      return {
        success: false,
        error: `Stale revision: incoming version (${playZone.version}) is not newer than current (${currentVersion})`,
      };
    }

    // Validate geometry bounds, coordinate validity, and area constraints
    const validation = validatePlayZone(playZone);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const updatedZone: PlayZone = {
      ...playZone,
      shapeType: playZone.shapeType || 'CIRCLE',
      areaSquareMeters: validation.areaSquareMeters || playZone.areaSquareMeters,
      version: incomingVersion,
      updatedAt: Date.now(),
      updatedBy: requesterId,
    };

    room.config.playZone = updatedZone;
    return { success: true, room, warning: validation.warning };
  }

  /**
   * Host assigns a player to a team (Waiting Room 'NONE', 'RUNNERS', or 'CHASERS').
   */
  public assignPlayerTeam(
    roomCode: string,
    requesterId: string,
    targetPlayerId: string,
    team: PlayerTeam
  ): { success: boolean; room?: RoomState; error?: string } {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId)
      return { success: false, error: 'Only Host can assign teams' };

    const member = room.members[targetPlayerId];
    if (!member) return { success: false, error: 'Target player not in room' };

    member.team = team;
    if (team === 'RUNNERS') {
      member.role = 'RUNNER';
      if (!member.catchCode) member.catchCode = generateCatchCode();
    } else if (team === 'CHASERS') {
      member.role = 'CHASER';
      delete member.catchCode;
    } else {
      member.team = 'NONE';
      member.role = member.id === room.hostId ? 'HOST' : 'SPECTATOR';
      delete member.catchCode;
    }

    return { success: true, room };
  }

  /**
   * Set target chaser count with backend validation.
   */
  public setTargetChaserCount(
    roomCode: string,
    requesterId: string,
    targetCount: number
  ): { success: boolean; room?: RoomState; error?: string } {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId)
      return { success: false, error: 'Only Host can configure chaser count' };

    const totalEligible = Object.values(room.members).filter(
      (m) => m.role !== 'REFEREE'
    ).length;

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
    return { success: true, room };
  }

  /**
   * Atomic auto-assignment of teams on the server based on targetChaserCount.
   */
  public autoAssignTeams(
    roomCode: string,
    requesterId: string
  ): { success: boolean; room?: RoomState; chasersCount?: number; runnersCount?: number; error?: string } {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId)
      return { success: false, error: 'Only Host can auto-assign teams' };

    const eligible = Object.values(room.members).filter((m) => m.role !== 'REFEREE');
    if (eligible.length < 2) {
      return {
        success: false,
        error: 'Requires at least 2 players to auto-assign teams (1 Runner & 1 Chaser)',
      };
    }

    // Determine target chaser count (clamped to leave at least 1 runner)
    const desiredChasers = Math.max(
      1,
      Math.min(room.config.targetChaserCount || 1, eligible.length - 1)
    );

    // Shuffle eligible players randomly
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);

    const chasers = shuffled.slice(0, desiredChasers);
    const runners = shuffled.slice(desiredChasers);

    // Apply assignments atomically
    for (const m of chasers) {
      m.team = 'CHASERS';
      m.role = 'CHASER';
      delete m.catchCode;
    }

    for (const m of runners) {
      m.team = 'RUNNERS';
      m.role = 'RUNNER';
      if (!m.catchCode) m.catchCode = generateCatchCode();
    }

    return {
      success: true,
      room,
      chasersCount: chasers.length,
      runnersCount: runners.length,
    };
  }

  public setPlayerRole(
    roomCode: string,
    requesterId: string,
    targetPlayerId: string,
    newRole: PlayerRole
  ): { success: boolean; room?: RoomState; error?: string } {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.hostId !== requesterId)
      return { success: false, error: 'Only Host can assign roles' };

    const member = room.members[targetPlayerId];
    if (!member) return { success: false, error: 'Target player not in room' };

    member.role = newRole;
    if (newRole === 'RUNNER') {
      member.team = 'RUNNERS';
      if (!member.catchCode) member.catchCode = generateCatchCode();
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

    return { success: true, room };
  }

  public setPlayerReady(
    roomCode: string,
    playerId: string,
    ready: boolean,
    gpsStatus?: any
  ): { success: boolean; room?: RoomState } {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false };

    const member = room.members[playerId];
    if (member) {
      member.isReady = ready;
      if (gpsStatus) member.gpsStatus = gpsStatus;
    }
    return { success: true, room };
  }

  public removeMember(roomCode: string, playerId: string): void {
    this.leaveRoom(roomCode, playerId);
  }

  /**
   * Authoritative player leave operation with deterministic host migration.
   */
  public leaveRoom(
    roomCode: string,
    playerId: string
  ): {
    success: boolean;
    room?: RoomState;
    newHostId?: string;
    roomClosed?: boolean;
    error?: string;
  } {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const member = room.members[playerId];
    if (!member) return { success: false, error: 'Player not in room' };

    delete room.members[playerId];
    const remainingMembers = Object.values(room.members);

    if (remainingMembers.length === 0) {
      this.rooms.delete(roomCode);
      return { success: true, roomClosed: true };
    }

    let newHostId: string | undefined;
    if (room.hostId === playerId) {
      // Elect replacement host deterministically:
      // Prefer referee or the member with the earliest join / sorted order
      const nextHost = remainingMembers.find((m) => m.role === 'REFEREE') || remainingMembers[0];
      room.hostId = nextHost.id;
      nextHost.role = 'HOST';
      newHostId = nextHost.id;
    }

    return { success: true, room, newHostId, roomClosed: false };
  }

  /**
   * Filters the room view according to the observer's role to strictly enforce
   * location privacy and secret catch codes.
   * - Catch codes visible ONLY to the runner themselves or referee.
   * - During RUNNER_HEADSTART: Chasers receive ZERO runner locations.
   * - During ACTIVE: Chasers receive NO live runner locations in room state (only via scheduled snapshots).
   * - Teammates see teammates' locations.
   */
  public getSanitizedRoomView(room: RoomState, viewerPlayerId: string): RoomState {
    const viewer = room.members[viewerPlayerId];
    const isReferee = viewer?.role === 'REFEREE';
    const isChaser = viewer?.team === 'CHASERS';

    const sanitizedMembers: Record<string, PlayerMember> = {};
    for (const [id, m] of Object.entries(room.members)) {
      let locationToExpose = m.lastLocation;

      // Location privacy enforcement
      if (m.team === 'RUNNERS') {
        if (isChaser && !isReferee) {
          // Chasers NEVER receive raw live runner locations via roomState broadcasts
          locationToExpose = undefined;
        }
      }

      sanitizedMembers[id] = {
        ...m,
        lastLocation: locationToExpose,
        // Only runner themselves or referee sees their catchCode and its expiry
        catchCode: id === viewerPlayerId || isReferee ? m.catchCode : undefined,
        catchCodeExpiresAt: id === viewerPlayerId || isReferee ? m.catchCodeExpiresAt : undefined,
      };
    }

    // Sanitize match details (Missions privacy)
    let sanitizedMatch = room.match;
    if (room.match) {
      let sanitizedActiveMissions: Record<string, any> = {};

      if (isReferee) {
        sanitizedActiveMissions = { ...(room.match.activeMissions || {}) };
      } else if (viewer?.team === 'RUNNERS' && room.match.activeMissions?.[viewerPlayerId]) {
        // Runner only sees their own active mission details
        sanitizedActiveMissions[viewerPlayerId] = room.match.activeMissions[viewerPlayerId];
      }
      // Chasers receive empty activeMissions map (they don't see runner mission targets)

      sanitizedMatch = {
        ...room.match,
        activeMissions: sanitizedActiveMissions,
      };
    }

    return {
      ...room,
      members: sanitizedMembers,
      match: sanitizedMatch,
    };
  }
}
