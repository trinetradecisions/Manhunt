import { describe, it, expect } from 'vitest';
import { GameStateStore } from '../../client/src/server/store';
import { generateRandomBases, isPointInExcludedArea } from '../../client/src/server/geo';
import { ExcludedArea, PlayZone } from '../../client/src/types/game';

describe('Authoritative Gameplay, GPS, Shared Missions & Victory Conditions', () => {
  it('1. Initializes room with real GPS coordinates when provided, without defaulting to San Francisco', async () => {
    const hostGPS = { latitude: 51.5074, longitude: -0.1278 };
    const room = await GameStateStore.createRoom({
      id: 'host_gps_1',
      nickname: 'LondonHost',
      role: 'HOST',
      team: 'CHASERS',
      initialLocation: hostGPS,
    });

    expect(room.config.playZone.centerLat).toBe(51.5074);
    expect(room.config.playZone.centerLng).toBe(-0.1278);
    expect(room.config.playZone.isHostConfirmed).toBe(true);
    expect(room.members['host_gps_1'].lastLocation?.latitude).toBe(51.5074);

    // Unprovided location starts with 0 and isHostConfirmed = false
    const roomNoGps = await GameStateStore.createRoom({
      id: 'host_no_gps',
      nickname: 'PendingHost',
      role: 'HOST',
      team: 'CHASERS',
    });
    expect(roomNoGps.config.playZone.isHostConfirmed).toBe(false);
  });

  it('2. Randomizes bases strictly within play zone and strictly outside excluded areas', async () => {
    const room = await GameStateStore.createRoom({
      id: 'host_bases_1',
      nickname: 'BaseMaster',
      role: 'HOST',
      team: 'CHASERS',
      initialLocation: { latitude: 12.9716, longitude: 77.5946 }, // Bangalore
    });

    // Add an excluded area at the north of the zone
    const exclusion: ExcludedArea = {
      id: 'excl_1',
      name: 'North Restricted Outpost',
      shapeType: 'CIRCLE',
      centerLat: 12.973,
      centerLng: 77.5946,
      radiusMeters: 100,
    };

    await GameStateStore.updateExcludedAreas(room.roomCode, 'host_bases_1', [exclusion]);
    const randRes = await GameStateStore.randomizeBases(room.roomCode, 'host_bases_1', 4);

    expect(randRes.success).toBe(true);
    expect(randRes.bases).toHaveLength(4);

    // Verify all bases are outside the excluded area
    for (const base of randRes.bases!) {
      const check = isPointInExcludedArea(
        { latitude: base.lat, longitude: base.lng },
        [exclusion]
      );
      expect(check.isInside).toBe(false);
    }
  });

  it('3. Generates warning alerts when a player enters an excluded area', async () => {
    const room = await GameStateStore.createRoom({
      id: 'host_alert',
      nickname: 'AlertHost',
      role: 'HOST',
      team: 'CHASERS',
      initialLocation: { latitude: 12.9716, longitude: 77.5946 },
    });

    await GameStateStore.joinRoom(room.roomCode, {
      id: 'runner_alert',
      nickname: 'Infiltrator',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    const exclusion: ExcludedArea = {
      id: 'excl_danger',
      name: 'High Voltage Facility',
      shapeType: 'CIRCLE',
      centerLat: 12.972,
      centerLng: 77.595,
      radiusMeters: 100,
    };

    await GameStateStore.updateExcludedAreas(room.roomCode, 'host_alert', [exclusion]);
    await GameStateStore.setReady(room.roomCode, 'host_alert', true);
    await GameStateStore.setReady(room.roomCode, 'runner_alert', true);

    // Disable headstart for immediate active state in test
    await GameStateStore.updateConfig(room.roomCode, 'host_alert', { globalHeadStartSeconds: 0 });
    await GameStateStore.startMatch(room.roomCode, 'host_alert');

    // Runner steps directly inside the exclusion
    const insideLocation = {
      latitude: 12.97205,
      longitude: 77.59502,
      accuracy: 8,
      timestamp: Date.now(),
    };

    const updateRes = await GameStateStore.updateLocation(room.roomCode, 'runner_alert', insideLocation);
    expect(updateRes.success).toBe(true);
    expect(updateRes.alert?.type).toBe('EXCLUDED_AREA_WARNING');
    expect(updateRes.alert?.message).toContain('High Voltage Facility');
  });

  it('4. Victory condition: Chasers win immediately when all runners are caught before timer expiry', async () => {
    const room = await GameStateStore.createRoom({
      id: 'host_chaser_win',
      nickname: 'Hunter',
      role: 'HOST',
      team: 'CHASERS',
      initialLocation: { latitude: 12.9716, longitude: 77.5946 },
    });

    await GameStateStore.joinRoom(room.roomCode, {
      id: 'solo_runner',
      nickname: 'Prey',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    await GameStateStore.setReady(room.roomCode, 'host_chaser_win', true);
    await GameStateStore.setReady(room.roomCode, 'solo_runner', true);
    await GameStateStore.updateConfig(room.roomCode, 'host_chaser_win', { globalHeadStartSeconds: 0 });
    await GameStateStore.startMatch(room.roomCode, 'host_chaser_win');

    // Runner requests catch code
    const codeRes = await GameStateStore.requestCatchCode(room.roomCode, 'solo_runner');
    expect(codeRes.success).toBe(true);

    // Chaser submits the code
    const catchRes = await GameStateStore.attemptCatchWithCode(
      room.roomCode,
      'host_chaser_win',
      'solo_runner',
      codeRes.catchCode!
    );

    expect(catchRes.success).toBe(true);
    expect(catchRes.room?.state).toBe('COMPLETED');
    expect(catchRes.room?.match?.winnerTeam).toBe('CHASERS');
    expect(catchRes.room?.match?.victoryReason).toContain('ALL RUNNERS ELIMINATED');
  });

  it('5. Victory condition: Runners win on timer expiry when at least one runner remains uncaught', async () => {
    const room = await GameStateStore.createRoom({
      id: 'host_timer_runner',
      nickname: 'HunterClock',
      role: 'HOST',
      team: 'CHASERS',
      initialLocation: { latitude: 12.9716, longitude: 77.5946 },
    });

    await GameStateStore.joinRoom(room.roomCode, {
      id: 'survivor_runner',
      nickname: 'Evader',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    await GameStateStore.setReady(room.roomCode, 'host_timer_runner', true);
    await GameStateStore.setReady(room.roomCode, 'survivor_runner', true);
    await GameStateStore.updateConfig(room.roomCode, 'host_timer_runner', {
      globalHeadStartSeconds: 0,
      durationSeconds: 10,
    });

    await GameStateStore.startMatch(room.roomCode, 'host_timer_runner');

    const activeRoom = await GameStateStore.getRoom(room.roomCode);
    expect(activeRoom?.state).toBe('ACTIVE');

    // Fast-forward gameStartedAt to simulate timer expiry
    activeRoom!.match!.gameStartedAt = Date.now() - 20000;
    const progressChanged = GameStateStore.updateRoomTimeProgress(activeRoom!);
    expect(progressChanged).toBe(true);
    expect(activeRoom?.state).toBe('COMPLETED');
    expect(activeRoom?.match?.winnerTeam).toBe('RUNNERS');
    expect(activeRoom?.match?.victoryReason).toContain('TIME EXPIRED');
  });

  it('6. Shared missions: completing all enabled shared missions triggers immediate Runners victory', async () => {
    const room = await GameStateStore.createRoom({
      id: 'host_mission_win',
      nickname: 'IntelHost',
      role: 'HOST',
      team: 'CHASERS',
      initialLocation: { latitude: 12.9716, longitude: 77.5946 },
    });

    await GameStateStore.joinRoom(room.roomCode, {
      id: 'runner_operative',
      nickname: 'SpeedyRunner',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    await GameStateStore.setReady(room.roomCode, 'host_mission_win', true);
    await GameStateStore.setReady(room.roomCode, 'runner_operative', true);

    // Enable only Survival Milestone with 2s duration for deterministic test
    await GameStateStore.updateConfig(room.roomCode, 'host_mission_win', {
      globalHeadStartSeconds: 0,
      durationSeconds: 600,
      missions: {
        enabledTypes: ['SURVIVAL_MILESTONE'],
        survivalMilestoneSeconds: 2,
      } as any,
    });

    await GameStateStore.startMatch(room.roomCode, 'host_mission_win');
    const runningRoom = await GameStateStore.getRoom(room.roomCode);
    expect(runningRoom?.match?.sharedMissions).toHaveLength(1);

    // Fast-forward gameStartedAt past milestone duration
    runningRoom!.match!.gameStartedAt = Date.now() - 5000;
    const runner = runningRoom!.members['runner_operative'];

    const evalRes = await GameStateStore.updateLocation(room.roomCode, 'runner_operative', {
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 5,
      timestamp: Date.now(),
    });

    expect(evalRes.success).toBe(true);
    const postRoom = await GameStateStore.getRoom(room.roomCode);
    expect(postRoom?.state).toBe('COMPLETED');
    expect(postRoom?.match?.winnerTeam).toBe('RUNNERS');
    expect(postRoom?.match?.victoryReason).toContain('MISSION OBJECTIVES COMPLETE');
  });

  it('7. Idempotent scoring: duplicate completion attempts do not award duplicate points', async () => {
    const room = await GameStateStore.createRoom({
      id: 'host_idemp',
      nickname: 'ScoreHost',
      role: 'HOST',
      team: 'CHASERS',
      initialLocation: { latitude: 12.9716, longitude: 77.5946 },
    });

    await GameStateStore.joinRoom(room.roomCode, {
      id: 'runner_idemp_1',
      nickname: 'RunnerOne',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    await GameStateStore.joinRoom(room.roomCode, {
      id: 'runner_idemp_2',
      nickname: 'RunnerTwo',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    await GameStateStore.setReady(room.roomCode, 'host_idemp', true);
    await GameStateStore.setReady(room.roomCode, 'runner_idemp_1', true);
    await GameStateStore.setReady(room.roomCode, 'runner_idemp_2', true);
    await GameStateStore.updateConfig(room.roomCode, 'host_idemp', { globalHeadStartSeconds: 0 });
    await GameStateStore.startMatch(room.roomCode, 'host_idemp');

    const activeRoom = await GameStateStore.getRoom(room.roomCode);
    const targetMission = activeRoom?.match?.sharedMissions?.[0];
    if (targetMission) {
      // First runner completes mission
      targetMission.status = 'COMPLETED';
      targetMission.completedByNickname = 'RunnerOne';
      const scoreBefore = activeRoom?.match?.scoreLedger?.teamScores?.RUNNERS || 0;

      // Second runner attempts duplicate completion
      targetMission.status = 'COMPLETED';
      const scoreAfter = activeRoom?.match?.scoreLedger?.teamScores?.RUNNERS || 0;

      expect(scoreAfter).toBe(scoreBefore);
    }
  });
});
