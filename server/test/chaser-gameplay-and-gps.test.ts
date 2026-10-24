import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RoomService } from '../src/services/roomService.js';
import { MatchService } from '../src/services/matchService.js';
import { ScoringService } from '../src/services/scoringService.js';
import { MissionService } from '../src/services/missionService.js';
import { VoiceService } from '../src/services/voiceService.js';
import { RoomState, PlayerLocation } from '../src/types/game.js';

class MockSocketServer {
  public emittedEvents: Array<{ roomOrSocket: string; event: string; data: any }> = [];

  to(target: string) {
    return {
      emit: (event: string, data: any) => {
        this.emittedEvents.push({ roomOrSocket: target, event, data });
      },
    };
  }

  emit(event: string, data: any) {
    this.emittedEvents.push({ roomOrSocket: 'all', event, data });
  }

  clear() {
    this.emittedEvents = [];
  }
}

describe('Chaser Gameplay Scoring & Team Conversion Test Suite', () => {
  let roomService: RoomService;
  let scoringService: ScoringService;
  let missionService: MissionService;
  let voiceService: VoiceService;
  let matchService: MatchService;
  let mockIo: MockSocketServer;
  let room: RoomState;

  const hostId = 'host_1';
  const runner1Id = 'runner_1';
  const runner2Id = 'runner_2';
  const chaser1Id = 'chaser_1';
  const chaser2Id = 'chaser_2';

  beforeEach(() => {
    mockIo = new MockSocketServer();
    roomService = new RoomService();
    scoringService = new ScoringService();
    missionService = new MissionService(scoringService);
    voiceService = new VoiceService(mockIo as any, roomService);
    matchService = new MatchService(
      mockIo as any,
      roomService,
      undefined,
      scoringService,
      missionService
    );
    matchService.setVoiceService(voiceService);

    // Setup Room
    room = roomService.createRoom(hostId, 'socket_host', 'CommanderHost');

    // Join Runners and Chasers
    roomService.joinRoom(room.roomCode, runner1Id, 'socket_r1', 'RunnerOne');
    roomService.joinRoom(room.roomCode, runner2Id, 'socket_r2', 'RunnerTwo');
    roomService.joinRoom(room.roomCode, chaser1Id, 'socket_c1', 'ChaserOne');
    roomService.joinRoom(room.roomCode, chaser2Id, 'socket_c2', 'ChaserTwo');

    // Assign Teams
    roomService.assignPlayerTeam(room.roomCode, room.hostId, runner1Id, 'RUNNERS');
    roomService.assignPlayerTeam(room.roomCode, room.hostId, runner2Id, 'RUNNERS');
    roomService.assignPlayerTeam(room.roomCode, room.hostId, chaser1Id, 'CHASERS');
    roomService.assignPlayerTeam(room.roomCode, room.hostId, chaser2Id, 'CHASERS');

    // Configure missions & scoring
    room.config.missions = {
      ...missionService.getDefaultConfig(),
      chaserObjectivesEnabled: true,
      rewardInterception: { individual: 25, team: 25 },
      rewardChaserMilestone: { individual: 25, team: 25 },
      chaserMilestoneSeconds: 300,
      catchReward: { individual: 100, team: 100 },
      winningTeamBonus: 500,
      winningIndividualBonus: 100,
      caughtRunnerRule: 'CONVERT_TO_CHASER',
      allRunnersCaughtEndsMatch: false,
    };
  });

  afterEach(() => {
    matchService.clearRoomTimers(room.roomCode);
  });

  it('1. End-to-end catch scoring: awards chaser +100 ind and +100 team points with CATCH_AWARD event', () => {
    (matchService as any)['transitionToHeadStart'](room);
    room.state = 'ACTIVE';

    const codeRes = matchService.requestCatchCode(room.roomCode, runner1Id);
    expect(codeRes.success).toBe(true);
    expect(codeRes.catchCode).toBeDefined();

    const catchRes = matchService.attemptCatchWithCode(
      room.roomCode,
      chaser1Id,
      runner1Id,
      codeRes.catchCode!
    );

    expect(catchRes.success).toBe(true);
    expect(catchRes.attempt?.status).toBe('CONFIRMED');

    // Verify authoritative score ledger
    const ledger = room.match!.scoreLedger!;
    expect(ledger.playerScores[chaser1Id]).toBe(100);
    expect(ledger.individualScores![chaser1Id]).toBe(100);
    expect(ledger.teamScores.CHASERS).toBe(100);
    expect(ledger.teamScores.RUNNERS).toBe(0);

    // Verify event in score ledger
    const catchEvent = ledger.events.find((e) => e.type === 'CATCH_AWARD');
    expect(catchEvent).toBeDefined();
    expect(catchEvent?.playerId).toBe(chaser1Id);
    expect(catchEvent?.playerNickname).toBe('ChaserOne');
    expect(catchEvent?.team).toBe('CHASERS');
    expect(catchEvent?.pointsIndividual).toBe(100);
    expect(catchEvent?.pointsTeam).toBe(100);
    expect(catchEvent?.idempotencyKey).toBe(`catch-${catchRes.attempt!.id}`);
  });

  it('2. Idempotency: simultaneous / duplicate catch requests do not award duplicate points', () => {
    (matchService as any)['transitionToHeadStart'](room);
    room.state = 'ACTIVE';

    const codeRes = matchService.requestCatchCode(room.roomCode, runner1Id);
    const code = codeRes.catchCode!;

    // First attempt succeeds
    const firstRes = matchService.attemptCatchWithCode(room.roomCode, chaser1Id, runner1Id, code);
    expect(firstRes.success).toBe(true);

    // Second attempt fails because runner has already been caught/converted to chaser
    const secondRes = matchService.attemptCatchWithCode(room.roomCode, chaser1Id, runner1Id, code);
    expect(secondRes.success).toBe(false);
    expect(secondRes.error).toBeDefined();

    // Score remains exactly 100
    const ledger = room.match!.scoreLedger!;
    expect(ledger.playerScores[chaser1Id]).toBe(100);
    expect(ledger.teamScores.CHASERS).toBe(100);
    expect(ledger.events.filter((e) => e.type === 'CATCH_AWARD').length).toBe(1);
  });

  it('3. Team switching: runner keeps earned individual score, historical points stay with RUNNERS, squad voice severed', () => {
    (matchService as any)['transitionToHeadStart'](room);
    room.state = 'ACTIVE';

    // 1. Runner 1 earns 100 points while on RUNNERS team
    scoringService.awardPoints({
      ledger: room.match!.scoreLedger!,
      playerId: runner1Id,
      playerNickname: 'RunnerOne',
      team: 'RUNNERS',
      pointsIndividual: 100,
      pointsTeam: 100,
      type: 'MISSION_COMPLETED',
      reason: 'Secure the Point mission completed',
      idempotencyKey: 'runner1-mission-1',
    });

    expect(room.match!.scoreLedger!.playerScores[runner1Id]).toBe(100);
    expect(room.match!.scoreLedger!.teamScores.RUNNERS).toBe(100);

    // 2. Runner 1 joins squad voice channel as Runner
    voiceService.joinVoiceChannel(room.roomCode, runner1Id, 'SQUAD');

    // 3. Chaser 1 catches Runner 1
    const codeRes = matchService.requestCatchCode(room.roomCode, runner1Id);
    matchService.attemptCatchWithCode(room.roomCode, chaser1Id, runner1Id, codeRes.catchCode!);

    // 4. Verify Runner 1 converted to Chasers
    expect(room.members[runner1Id].team).toBe('CHASERS');
    expect(room.members[runner1Id].role).toBe('CHASER');

    // 5. Verify individual score is preserved (100)
    expect(room.match!.scoreLedger!.playerScores[runner1Id]).toBe(100);
    // Historical team score remains with RUNNERS (100)
    expect(room.match!.scoreLedger!.teamScores.RUNNERS).toBe(100);
    // Chasers team earned 100 points for the catch
    expect(room.match!.scoreLedger!.teamScores.CHASERS).toBe(100);

    // 6. Verify Runner 1 was removed from the old squad voice channel
    const channels = (voiceService as any).roomVoiceChannels.get(room.roomCode);
    const squadChannel = channels?.get('SQUAD');
    expect(squadChannel?.has(runner1Id)).toBe(false);

    // 7. Future catches by Runner 1 (now a Chaser) award points to CHASERS
    const code2Res = matchService.requestCatchCode(room.roomCode, runner2Id);
    matchService.attemptCatchWithCode(room.roomCode, runner1Id, runner2Id, code2Res.catchCode!);

    expect(room.match!.scoreLedger!.playerScores[runner1Id]).toBe(200); // 100 previous + 100 catch
    expect(room.match!.scoreLedger!.teamScores.CHASERS).toBe(200); // 100 first catch + 100 second catch
    expect(room.match!.scoreLedger!.teamScores.RUNNERS).toBe(100); // historical team score untouched!
  });

  it('4. Optional Chaser Objective A: Successful Interception awards +25 Solo and +25 Chaser Team points when physically intercepting runner at objective', () => {
    (matchService as any)['transitionToHeadStart'](room);
    room.state = 'ACTIVE';

    const missionTargetLat = 51.5074;
    const missionTargetLng = -0.1278;

    // Assign active mission to Runner 1 at known target coordinates
    room.match!.activeMissions = room.match!.activeMissions || {};
    room.match!.activeMissions[runner1Id] = {
      id: 'mission_runner1_1',
      playerId: runner1Id,
      playerNickname: 'RunnerOne',
      team: 'RUNNERS',
      type: 'SECURE_POINT',
      title: 'Secure the Point: Tower',
      description: 'Defend area',
      difficulty: 'medium',
      rewardIndividual: 100,
      rewardTeam: 100,
      targetLocation: { latitude: missionTargetLat, longitude: missionTargetLng, accuracy: 5 },
      targetRadiusMeters: 25,
      progress: 50,
      isInRadius: true,
      status: 'IN_PROGRESS',
    };

    // Runner 1 is at the objective
    const runnerLoc: PlayerLocation = {
      latitude: missionTargetLat,
      longitude: missionTargetLng,
      accuracy: 5,
      timestamp: Date.now(),
    };
    room.members[runner1Id].lastLocation = runnerLoc;

    // Chaser 1 arrives within 15 meters of Runner 1
    const chaserLoc: PlayerLocation = {
      latitude: missionTargetLat + 0.0001, // ~11 meters away
      longitude: missionTargetLng,
      accuracy: 5,
      timestamp: Date.now() + 100,
    };
    room.members[chaser1Id].lastLocation = chaserLoc;

    // Trigger evaluateChaserInterceptions
    matchService.evaluateChaserInterceptions(room, chaser1Id);

    const ledger = room.match!.scoreLedger!;
    expect(ledger.playerScores[chaser1Id]).toBe(25);
    expect(ledger.teamScores.CHASERS).toBe(25);

    const interceptEvent = ledger.events.find((e) => e.type === 'INTERCEPTION');
    expect(interceptEvent).toBeDefined();
    expect(interceptEvent?.playerId).toBe(chaser1Id);
    expect(interceptEvent?.pointsIndividual).toBe(25);
    expect(interceptEvent?.pointsTeam).toBe(25);

    // Repeated calls do not duplicate points (idempotent key)
    matchService.evaluateChaserInterceptions(room, chaser1Id);
    expect(ledger.playerScores[chaser1Id]).toBe(25);
    expect(ledger.events.filter((e) => e.type === 'INTERCEPTION').length).toBe(1);
  });

  it('5. Optional Chaser Objective B: Chaser Control Milestone awards +25 Solo and +25 Team points once per 5-minute milestone', () => {
    (matchService as any)['transitionToHeadStart'](room);
    room.state = 'ACTIVE';

    const now = Date.now();
    // Simulate active match has been running for 5 minutes (300 seconds)
    room.match!.gameStartedAt = now - 305 * 1000;

    matchService.checkChaserMilestones(room, now);

    const ledger = room.match!.scoreLedger!;
    // Both active chasers (chaser1 and chaser2) receive their milestone 1 reward (+25 each)
    expect(ledger.playerScores[chaser1Id]).toBe(25);
    expect(ledger.playerScores[chaser2Id]).toBe(25);
    // Chasers team receives team points
    expect(ledger.teamScores.CHASERS).toBe(50);

    const milestoneEvents = ledger.events.filter((e) => e.type === 'CHASER_MILESTONE');
    expect(milestoneEvents.length).toBe(2);

    // Repeated call at same elapsed time does not duplicate
    matchService.checkChaserMilestones(room, now);
    expect(ledger.playerScores[chaser1Id]).toBe(25);
    expect(ledger.events.filter((e) => e.type === 'CHASER_MILESTONE').length).toBe(2);

    // Simulate reaching minute 10 (step 2)
    const tenMinutesNow = now + 300 * 1000;
    room.match!.gameStartedAt = tenMinutesNow - 605 * 1000;
    matchService.checkChaserMilestones(room, tenMinutesNow);

    expect(ledger.playerScores[chaser1Id]).toBe(50); // 25 + 25
    expect(ledger.events.filter((e) => e.type === 'CHASER_MILESTONE').length).toBe(4);
  });

  it('6. Winning team bonus: awards +500 team bonus and +100 individual bonus idempotently without distribution into individual scores', () => {
    (matchService as any)['transitionToHeadStart'](room);
    room.state = 'ACTIVE';

    const events = scoringService.awardVictoryBonus({
      ledger: room.match!.scoreLedger!,
      matchId: 'match_test_win',
      winner: 'CHASERS',
      members: room.members,
      config: room.config.missions,
    });

    expect(events.length).toBeGreaterThan(0);
    const ledger = room.match!.scoreLedger!;
    // Winning team bonus is exactly 500 team points
    expect(ledger.teamScores.CHASERS).toBe(500);
    // Eligible winning players receive exactly 100 individual bonus; team bonus is NOT distributed into individual scores
    expect(ledger.playerScores[chaser1Id]).toBe(100);
    expect(ledger.playerScores[chaser2Id]).toBe(100);
    expect(ledger.playerScores[runner1Id]).toBe(0);

    // Duplicate call awards nothing (exactly-once idempotency)
    const dupEvents = scoringService.awardVictoryBonus({
      ledger: room.match!.scoreLedger!,
      matchId: 'match_test_win',
      winner: 'CHASERS',
      members: room.members,
      config: room.config.missions,
    });
    expect(dupEvents.length).toBe(0);
    expect(ledger.teamScores.CHASERS).toBe(500);
  });
});
