import { describe, it, expect, beforeEach } from 'vitest';
import { RoomService } from '../src/services/roomService.js';
import { MatchService } from '../src/services/matchService.js';
import { ChatService } from '../src/services/chatService.js';
import { VoiceService } from '../src/services/voiceService.js';

describe('Match Session Persistence & Refresh Recovery', () => {
  let roomService: RoomService;
  let matchService: MatchService;
  let chatService: ChatService;
  let voiceService: VoiceService;
  let mockIo: any;
  let emittedEvents: Array<{ target: string; event: string; payload: any }> = [];

  beforeEach(() => {
    emittedEvents = [];
    roomService = new RoomService();
    mockIo = {
      to: (target: string) => ({
        emit: (event: string, payload: any) => {
          emittedEvents.push({ target, event, payload });
        },
      }),
    };
    matchService = new MatchService(mockIo as any, roomService);
    chatService = new ChatService(mockIo as any, roomService);
    voiceService = new VoiceService(mockIo as any, roomService);
  });

  it('restores a player to the same room and preserves host authority upon refresh', () => {
    // 1. Host creates room
    const hostPlayerId = 'host_p1';
    const room = roomService.createRoom(hostPlayerId, 'sock_1', 'Commander');
    const roomCode = room.roomCode;

    expect(room.hostId).toBe(hostPlayerId);
    expect(room.members[hostPlayerId].nickname).toBe('Commander');

    // 2. Host simulates page refresh: new socket connects with same playerId
    const refreshResult = roomService.joinRoom(roomCode, hostPlayerId, 'sock_1_refreshed', 'Commander');
    expect(refreshResult.success).toBe(true);
    expect(refreshResult.room?.roomCode).toBe(roomCode);
    expect(refreshResult.room?.hostId).toBe(hostPlayerId); // Host authority preserved!
    expect(refreshResult.room?.members[hostPlayerId].socketId).toBe('sock_1_refreshed');

    // 3. Sanitized view preserves host authority
    const sanitized = roomService.getSanitizedRoomView(refreshResult.room!, hostPlayerId);
    expect(sanitized.hostId).toBe(hostPlayerId);
  });

  it('restores a Runner during head start without resetting countdown or losing catch code', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
    roomService.joinRoom(room.roomCode, 'runner_1', 'sock_r1', 'Speedy');
    roomService.joinRoom(room.roomCode, 'chaser_1', 'sock_c1', 'Hunter');

    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'runner_1', 'RUNNERS');
    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'chaser_1', 'CHASERS');

    const originalCatchCode = room.members['runner_1'].catchCode;
    expect(originalCatchCode).toBeDefined();

    // Start match (head-start phase)
    room.state = 'RUNNER_HEADSTART';
    const headstartEndsAt = Date.now() + 30000;
    room.match = {
      id: 'match_123',
      startedAt: Date.now(),
      gameStartedAt: Date.now(),
      gameEndsAt: Date.now() + 15 * 60 * 1000,
      durationMinutes: 15,
      durationSeconds: 900,
      phase: 'HEAD_START',
      catches: [],
      winnerTeam: null,
      remainingSeconds: 900,
      headstartRemainingSeconds: 30,
      headstartEndsAt,
    };

    // Runner refreshes browser
    const refreshResult = roomService.joinRoom(room.roomCode, 'runner_1', 'sock_r1_new', 'Speedy');
    expect(refreshResult.success).toBe(true);
    expect(refreshResult.room?.state).toBe('RUNNER_HEADSTART');
    expect(refreshResult.room?.members['runner_1'].team).toBe('RUNNERS');
    expect(refreshResult.room?.members['runner_1'].catchCode).toBe(originalCatchCode);
    expect(refreshResult.room?.match?.headstartEndsAt).toBe(headstartEndsAt);

    // Verify runner sees their own catch code
    const runnerView = roomService.getSanitizedRoomView(refreshResult.room!, 'runner_1');
    expect(runnerView.members['runner_1'].catchCode).toBe(originalCatchCode);
  });

  it('prevents Chaser from seeing raw Runner locations during refresh in head start', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
    roomService.joinRoom(room.roomCode, 'runner_1', 'sock_r1', 'Speedy');
    roomService.joinRoom(room.roomCode, 'chaser_1', 'sock_c1', 'Hunter');

    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'runner_1', 'RUNNERS');
    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'chaser_1', 'CHASERS');

    room.state = 'RUNNER_HEADSTART';
    room.members['runner_1'].lastLocation = {
      latitude: 51.505,
      longitude: -0.09,
      accuracy: 5,
      timestamp: Date.now(),
    };

    // Chaser refreshes browser
    const refreshResult = roomService.joinRoom(room.roomCode, 'chaser_1', 'sock_c1_new', 'Hunter');
    expect(refreshResult.success).toBe(true);

    // Sanitized view for chaser MUST NOT expose runner's location or catch code
    const chaserView = roomService.getSanitizedRoomView(refreshResult.room!, 'chaser_1');
    expect(chaserView.members['runner_1'].lastLocation).toBeUndefined();
    expect(chaserView.members['runner_1'].catchCode).toBeUndefined();
  });

  it('preserves the 15-minute gameEndsAt deadline when players refresh during ACTIVE match', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
    roomService.joinRoom(room.roomCode, 'runner_1', 'sock_r1', 'Speedy');
    roomService.joinRoom(room.roomCode, 'chaser_1', 'sock_c1', 'Hunter');

    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'runner_1', 'RUNNERS');
    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'chaser_1', 'CHASERS');

    room.state = 'ACTIVE';
    const originalGameEndsAt = Date.now() + 15 * 60 * 1000;
    room.match = {
      id: 'match_active_999',
      startedAt: Date.now(),
      gameStartedAt: Date.now(),
      gameEndsAt: originalGameEndsAt,
      durationMinutes: 15,
      durationSeconds: 900,
      phase: 'HUNT',
      catches: [],
      winnerTeam: null,
      remainingSeconds: 885,
    };

    // Simulate 35 seconds passing:
    const remainingAfter35Sec = Math.max(0, Math.ceil((originalGameEndsAt - (Date.now() + 35000)) / 1000));
    expect(remainingAfter35Sec).toBe(865);

    // Player refreshes
    const refresh = roomService.joinRoom(room.roomCode, 'runner_1', 'sock_r1_refreshed', 'Speedy');
    expect(refresh.success).toBe(true);
    expect(refresh.room?.state).toBe('ACTIVE');
    // Deadline is strictly preserved from the original match
    expect(refresh.room?.match?.gameEndsAt).toBe(originalGameEndsAt);
    expect(refresh.room?.match?.durationSeconds).toBe(900);
  });

  it('returns an error and rejects restore when a room has expired or does not exist', () => {
    const nonExistentResult = roomService.joinRoom('NONEXT', 'p_fake', 'sock_fake', 'Ghost');
    expect(nonExistentResult.success).toBe(false);
    expect(nonExistentResult.error).toContain('Room not found');
  });

  it('rejects uninvited late joiners attempting to join an in-progress match as new members', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
    roomService.joinRoom(room.roomCode, 'r1', 'sock_r1', 'Speedy');
    roomService.joinRoom(room.roomCode, 'c1', 'sock_c1', 'Hunter');
    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'r1', 'RUNNERS');
    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'c1', 'CHASERS');

    room.state = 'ACTIVE';

    // A brand new player tries to join an ongoing match
    const intruderResult = roomService.joinRoom(room.roomCode, 'intruder_p', 'sock_intruder', 'Crasher');
    expect(intruderResult.success).toBe(false);
    expect(intruderResult.error).toContain('Match already in progress');
  });
});
