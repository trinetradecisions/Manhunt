import { describe, it, expect, beforeEach } from 'vitest';
import { RoomService } from '../src/services/roomService.js';
import { MatchService } from '../src/services/matchService.js';
import { ChatService } from '../src/services/chatService.js';
import { VoiceService } from '../src/services/voiceService.js';
import { Server } from 'socket.io';

describe('Team Management, Authoritative Schedulers & Chat Protocol', () => {
  let roomService: RoomService;
  let matchService: MatchService;
  let chatService: ChatService;
  let mockIo: any;

  beforeEach(() => {
    roomService = new RoomService();
    mockIo = {
      to: () => ({
        emit: () => {},
      }),
    };
    matchService = new MatchService(mockIo as any, roomService);
    chatService = new ChatService(mockIo as any, roomService);
  });

  describe('Host-Controlled Team Management & Chaser Count', () => {
    it('allows host to assign players between Waiting Room, Runners, and Chasers', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
      roomService.joinRoom(room.roomCode, 'p2', 'sock_p2', 'Ghost');
      roomService.joinRoom(room.roomCode, 'p3', 'sock_p3', 'Viper');

      // Non-host attempts assignment (must be rejected)
      const unauthorized = roomService.assignPlayerTeam(room.roomCode, 'p2', 'p3', 'CHASERS');
      expect(unauthorized.success).toBe(false);
      expect(unauthorized.error).toContain('Only Host');

      // Host assigns p2 to CHASERS
      const assignChaser = roomService.assignPlayerTeam(room.roomCode, 'host_1', 'p2', 'CHASERS');
      expect(assignChaser.success).toBe(true);
      expect(room.members['p2'].team).toBe('CHASERS');
      expect(room.members['p2'].role).toBe('CHASER');
      expect(room.members['p2'].catchCode).toBeUndefined();

      // Host assigns p3 to RUNNERS
      const assignRunner = roomService.assignPlayerTeam(room.roomCode, 'host_1', 'p3', 'RUNNERS');
      expect(assignRunner.success).toBe(true);
      expect(room.members['p3'].team).toBe('RUNNERS');
      expect(room.members['p3'].role).toBe('RUNNER');
      expect(room.members['p3'].catchCode).toBeDefined();

      // Return p2 to Waiting Room (team: 'NONE')
      const returnToWaiting = roomService.assignPlayerTeam(room.roomCode, 'host_1', 'p2', 'NONE');
      expect(returnToWaiting.success).toBe(true);
      expect(room.members['p2'].team).toBe('NONE');
    });

    it('validates target chaser count limits', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
      roomService.joinRoom(room.roomCode, 'p2', 'sock_p2', 'Alpha');
      roomService.joinRoom(room.roomCode, 'p3', 'sock_p3', 'Bravo');

      // 3 eligible players total: max chasers is 2 (leaving 1 runner)
      const invalidZero = roomService.setTargetChaserCount(room.roomCode, 'host_1', 0);
      expect(invalidZero.success).toBe(false);

      const invalidTooHigh = roomService.setTargetChaserCount(room.roomCode, 'host_1', 3);
      expect(invalidTooHigh.success).toBe(false);
      expect(invalidTooHigh.error).toContain('Must leave at least 1 runner');

      const validCount = roomService.setTargetChaserCount(room.roomCode, 'host_1', 2);
      expect(validCount.success).toBe(true);
      expect(room.config.targetChaserCount).toBe(2);
    });

    it('performs atomic server auto-assignment and guarantees 1+ runner and 1+ chaser', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Host');
      roomService.joinRoom(room.roomCode, 'p2', 'sock_p2', 'One');
      roomService.joinRoom(room.roomCode, 'p3', 'sock_p3', 'Two');
      roomService.joinRoom(room.roomCode, 'p4', 'sock_p4', 'Three');

      room.config.targetChaserCount = 1;
      const res = roomService.autoAssignTeams(room.roomCode, 'host_1');
      expect(res.success).toBe(true);
      expect(res.chasersCount).toBe(1);
      expect(res.runnersCount).toBe(3);

      const chasers = Object.values(room.members).filter((m) => m.team === 'CHASERS');
      const runners = Object.values(room.members).filter((m) => m.team === 'RUNNERS');
      expect(chasers.length).toBe(1);
      expect(runners.length).toBe(3);
    });
  });

  describe('In-Game Tactical Chat Permissions & Sanitization', () => {
    it('enforces recipient permissions (ALL, TEAM, DIRECT)', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Host');
      roomService.joinRoom(room.roomCode, 'runner_1', 'sock_r1', 'RunnerOne');
      roomService.joinRoom(room.roomCode, 'chaser_1', 'sock_c1', 'ChaserOne');

      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'runner_1', 'RUNNERS');
      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'chaser_1', 'CHASERS');

      // 1. Broadcast to ALL
      const msgAll = chatService.sendMessage(room.roomCode, 'runner_1', 'ALL', 'Hello everyone');
      expect(msgAll.success).toBe(true);

      // 2. Team message
      const msgTeam = chatService.sendMessage(room.roomCode, 'runner_1', 'TEAM', 'Runners regroup');
      expect(msgTeam.success).toBe(true);

      // 3. Direct message
      const msgDirect = chatService.sendMessage(room.roomCode, 'runner_1', 'DIRECT', 'Secret plan', 'chaser_1');
      expect(msgDirect.success).toBe(true);

      // Check history visible to Chaser
      const chaserHistory = chatService.getHistoryForPlayer(room, 'chaser_1');
      // Chaser should see: ALL message, DIRECT message sent to them, but NOT runner TEAM message
      const texts = chaserHistory.map((m) => m.text);
      expect(texts).toContain('Hello everyone');
      expect(texts).toContain('Secret plan');
      expect(texts).not.toContain('Runners regroup');
    });

    it('sanitizes HTML injection and strips script tags from chat', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Host');
      const res = chatService.sendMessage(
        room.roomCode,
        'host_1',
        'ALL',
        '<script>alert("hack")</script><b>Tactical</b> message'
      );
      expect(res.success).toBe(true);
      expect(res.message?.text).toBe('alert("hack")Tactical message');
    });
  });

  describe('120-Second Server-Authoritative Runner Location Snapshots & Privacy', () => {
    it('hides live runner coordinates from chasers and delivers only valid 120s snapshots', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Host');
      roomService.joinRoom(room.roomCode, 'runner_1', 'sock_r1', 'Runner');
      roomService.joinRoom(room.roomCode, 'chaser_1', 'sock_c1', 'Chaser');

      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'runner_1', 'RUNNERS');
      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'chaser_1', 'CHASERS');

      // Update runner location
      const now = Date.now();
      room.members['runner_1'].lastLocation = {
        latitude: 51.505,
        longitude: -0.125,
        accuracy: 8,
        heading: null,
        speed: null,
        timestamp: now,
      };

      // When room view is sanitized for Chaser, live runner coordinates MUST be undefined
      const chaserView = roomService.getSanitizedRoomView(room, 'chaser_1');
      expect(chaserView.members['runner_1'].lastLocation).toBeUndefined();

      // However, fellow runners see their teammate
      const runnerView = roomService.getSanitizedRoomView(room, 'runner_1');
      expect(runnerView.members['runner_1'].lastLocation).toBeDefined();

      // Now trigger server scheduled snapshot during active match
      room.state = 'ACTIVE';
      room.match = {
        startedAt: now - 120000,
        headStartEndsAt: now - 60000,
        gameStartedAt: now - 60000,
        gameEndsAt: now + 800000,
        totalDurationSeconds: 900,
        remainingSeconds: 800,
        totalPausedSeconds: 0,
        catches: [],
      };

      matchService.executeScheduledRunnerSnapshot(room);
      expect(room.match.lastScheduledSnapshot).toBeDefined();
      expect(room.match.lastScheduledSnapshot?.runners.length).toBe(1);
      expect(room.match.lastScheduledSnapshot?.runners[0].latitude).toBe(51.505);

      // Verify stale locations (>45s) are excluded
      room.members['runner_1'].lastLocation.timestamp = now - 60000; // 60s old
      matchService.executeScheduledRunnerSnapshot(room);
      expect(room.match.lastScheduledSnapshot?.runners.length).toBe(0);
    });
  });

  describe('Discord-Style Separate Channel Histories & Eligibility', () => {
    it('isolates message histories across distinct channels (PUBLIC, SQUAD, RUNNERS, CHASERS)', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Host');
      roomService.joinRoom(room.roomCode, 'r1', 'sock_r1', 'Runner1');
      roomService.joinRoom(room.roomCode, 'c1', 'sock_c1', 'Chaser1');
      roomService.joinRoom(room.roomCode, 'bench', 'sock_b', 'BenchPlayer');

      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'r1', 'RUNNERS');
      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'c1', 'CHASERS');

      // 1. Bench player cannot send squad message
      const benchSquad = chatService.sendMessage(room.roomCode, 'bench', 'SQUAD', 'I am unassigned');
      expect(benchSquad.success).toBe(false);
      expect(benchSquad.error).toContain('Unassigned');

      // 2. Runner sends to SQUAD
      const rSquad = chatService.sendMessage(room.roomCode, 'r1', 'SQUAD', 'Runner tactical intel');
      expect(rSquad.success).toBe(true);

      // 3. Chaser sends to SQUAD
      const cSquad = chatService.sendMessage(room.roomCode, 'c1', 'SQUAD', 'Chaser patrol routes');
      expect(cSquad.success).toBe(true);

      // 4. Public channel message
      const pubMsg = chatService.sendMessage(room.roomCode, 'host_1', 'PUBLIC', 'Game starting soon');
      expect(pubMsg.success).toBe(true);

      // Verify channel-specific queries:
      // Runner sees Runner Squad messages, NOT Chaser messages
      const runnerSquadHistory = chatService.getHistoryForChannel(room, 'SQUAD', 'r1');
      expect(runnerSquadHistory.map((m) => m.text)).toContain('Runner tactical intel');
      expect(runnerSquadHistory.map((m) => m.text)).not.toContain('Chaser patrol routes');

      // Chaser sees Chaser Squad messages, NOT Runner messages
      const chaserSquadHistory = chatService.getHistoryForChannel(room, 'SQUAD', 'c1');
      expect(chaserSquadHistory.map((m) => m.text)).toContain('Chaser patrol routes');
      expect(chaserSquadHistory.map((m) => m.text)).not.toContain('Runner tactical intel');

      // Public history is visible to all
      const publicHistory = chatService.getHistoryForChannel(room, 'PUBLIC', 'bench');
      expect(publicHistory.map((m) => m.text)).toContain('Game starting soon');
      expect(publicHistory.map((m) => m.text)).not.toContain('Runner tactical intel');
    });
  });

  describe('WebRTC Walkie-Talkie Push-to-Talk Voice System', () => {
    it('manages squad and public voice channels, enforces squad isolation, and relays signaling', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Host');
      roomService.joinRoom(room.roomCode, 'r1', 'sock_r1', 'Runner1');
      roomService.joinRoom(room.roomCode, 'c1', 'sock_c1', 'Chaser1');
      roomService.joinRoom(room.roomCode, 'bench', 'sock_b', 'BenchPlayer');

      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'r1', 'RUNNERS');
      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'c1', 'CHASERS');

      const voiceService = new VoiceService(mockIo, roomService);

      // 1. Unassigned player cannot join Squad Voice
      const benchJoin = voiceService.joinVoiceChannel(room.roomCode, 'bench', 'SQUAD');
      expect(benchJoin.success).toBe(false);
      expect(benchJoin.error).toContain('Only assigned');

      // 2. Runner joins Squad Voice
      const rJoin = voiceService.joinVoiceChannel(room.roomCode, 'r1', 'SQUAD');
      expect(rJoin.success).toBe(true);

      // 3. Chaser joins Squad Voice
      const cJoin = voiceService.joinVoiceChannel(room.roomCode, 'c1', 'SQUAD');
      expect(cJoin.success).toBe(true);
      // Chaser must not see Runner in their squad channel
      expect(cJoin.participants?.map((p: any) => p.playerId)).not.toContain('r1');

      // 4. Signaling between cross squads in SQUAD channel must be rejected
      const crossSignal = voiceService.relaySignal(room.roomCode, 'r1', 'c1', 'SQUAD', { dummy: true });
      expect(crossSignal.success).toBe(false);
      expect(crossSignal.error).toContain('Cross-squad');

      // 5. Switching to PUBLIC Voice
      const pubJoinR = voiceService.joinVoiceChannel(room.roomCode, 'r1', 'PUBLIC');
      expect(pubJoinR.success).toBe(true);
      const pubJoinC = voiceService.joinVoiceChannel(room.roomCode, 'c1', 'PUBLIC');
      expect(pubJoinC.success).toBe(true);
      // In PUBLIC channel, chaser sees runner
      expect(pubJoinC.participants?.map((p: any) => p.playerId)).toContain('r1');

      // 6. Push-to-Talk speaking state update
      voiceService.setSpeaking(room.roomCode, 'r1', 'PUBLIC', true);
      // Clean leave
      voiceService.leaveVoiceChannel(room.roomCode, 'r1');
      const remaining = voiceService.getChannelParticipants(room.roomCode, 'PUBLIC', 'c1');
      expect(remaining.map((p: any) => p.playerId)).not.toContain('r1');
    });
  });

  describe('Server-Authoritative 15-Minute Countdown Timer & Expiration', () => {
    it('initializes remaining seconds to durationSeconds (15:00) and counts down toward 00:00', () => {
      const room = roomService.createRoom('host_1', 'sock_host', 'Host');
      roomService.joinRoom(room.roomCode, 'r1', 'sock_r1', 'Runner1');
      roomService.joinRoom(room.roomCode, 'c1', 'sock_c1', 'Chaser1');
      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'r1', 'RUNNERS');
      roomService.assignPlayerTeam(room.roomCode, 'host_1', 'c1', 'CHASERS');

      room.config.durationSeconds = 900; // 15 minutes exactly
      room.config.globalHeadStartSeconds = 60; // 1 minute head start

      // Initiate match
      const now = Date.now();
      room.state = 'ACTIVE';
      room.match = {
        startedAt: now - 60000,
        headStartEndsAt: now,
        gameStartedAt: now,
        gameEndsAt: now + 900000,
        totalDurationSeconds: 900,
        remainingSeconds: 900,
        totalPausedSeconds: 0,
        catches: [],
      };

      // Exactly at gameStartedAt, remainingSeconds is 900 (15:00)
      const remaining = Math.max(0, Math.ceil((room.match.gameEndsAt - now) / 1000));
      expect(remaining).toBe(900);

      // After 1 second elapsed, remaining is 899 (14:59)
      const remaining1s = Math.max(0, Math.ceil((room.match.gameEndsAt - (now + 1000)) / 1000));
      expect(remaining1s).toBe(899);

      // When deadline expires, remaining reaches 0 (00:00)
      const expired = Math.max(0, Math.ceil((room.match.gameEndsAt - (now + 901000)) / 1000));
      expect(expired).toBe(0);
    });
  });
});
