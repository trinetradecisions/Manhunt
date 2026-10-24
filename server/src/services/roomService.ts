import {
  GameConfig,
  PlayerMember,
  PlayerRole,
  PlayerTeam,
  RoomState,
} from '../types/game.js';

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
        centerLat: 51.5074, // Default placeholder center
        centerLng: -0.1278,
        radiusMeters: 500,
      },
      pingIntervalSeconds: 45,
      globalHeadStartSeconds: 120, // 2 minutes
      radioEnabled: true,
      catchProximityThresholdMeters: 25,
    };

    const hostMember: PlayerMember = {
      id: hostPlayerId,
      socketId: hostSocketId,
      nickname: hostNickname,
      role: 'HOST',
      team: 'NONE',
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
      room.members[playerId] = {
        id: playerId,
        socketId,
        nickname: nickname || `Player_${Object.keys(room.members).length + 1}`,
        role: 'RUNNER', // Default join role
        team: 'RUNNERS',
        isReady: false,
        gpsStatus: 'PROMPT',
        catchCode: generateCatchCode(),
      };
    }

    return { success: true, room };
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

    room.config = {
      ...room.config,
      ...partialConfig,
      playZone: {
        ...room.config.playZone,
        ...(partialConfig.playZone || {}),
      },
    };

    return { success: true, room };
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
    } else {
      member.team = 'NONE';
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
    const room = this.getRoom(roomCode);
    if (!room) return;
    delete room.members[playerId];
    if (Object.keys(room.members).length === 0) {
      this.rooms.delete(roomCode);
    }
  }

  /**
   * Filters the room view according to the observer's role to prevent
   * secret leakage (e.g. catch codes are only visible to the runner themselves or referee).
   */
  public getSanitizedRoomView(room: RoomState, viewerPlayerId: string): RoomState {
    const viewer = room.members[viewerPlayerId];
    const isRefereeOrHost = viewer?.role === 'REFEREE' || viewer?.role === 'HOST';

    const sanitizedMembers: Record<string, PlayerMember> = {};
    for (const [id, m] of Object.entries(room.members)) {
      sanitizedMembers[id] = {
        ...m,
        // Only the runner themselves or a referee/host sees the runner's catchCode
        catchCode:
          id === viewerPlayerId || isRefereeOrHost ? m.catchCode : undefined,
      };
    }

    return {
      ...room,
      members: sanitizedMembers,
    };
  }
}
