import { describe, it, expect, beforeEach } from 'vitest';
import { GameStateStore } from '../../client/src/server/store';

describe('Team Assignment, Auto-Assign, Roles & Controls Test Suite', () => {
  let roomCode: string;
  const hostId = 'host_agent';
  const player2Id = 'player_02';
  const player3Id = 'player_03';
  const player4Id = 'player_04';

  beforeEach(async () => {
    const room = await GameStateStore.createRoom(
      { id: hostId, nickname: 'HostCommander', role: 'HOST', initialLocation: { latitude: 37.7749, longitude: -122.4194 } }
    );
    roomCode = room.roomCode;

    await GameStateStore.joinRoom(roomCode, { id: player2Id, nickname: 'Operative2' });
    await GameStateStore.joinRoom(roomCode, { id: player3Id, nickname: 'Operative3' });
    await GameStateStore.joinRoom(roomCode, { id: player4Id, nickname: 'Operative4' });
  });

  it('1. Host can manually assign players to RUNNERS and CHASERS (and non-host is rejected)', async () => {
    // Non-host attempts assignment
    const rejectRes = await GameStateStore.assignPlayerTeam(roomCode, player2Id, player3Id, 'RUNNERS');
    expect(rejectRes.success).toBe(false);
    expect(rejectRes.error).toContain('Only Host can assign teams');

    // Host assigns player2 to RUNNERS
    const assignRunnerRes = await GameStateStore.assignPlayerTeam(roomCode, hostId, player2Id, 'RUNNERS');
    expect(assignRunnerRes.success).toBe(true);
    const p2 = assignRunnerRes.room!.members[player2Id];
    expect(p2.team).toBe('RUNNERS');
    expect(p2.role).toBe('RUNNER');
    expect(p2.catchCode).toBeDefined();
    expect(p2.catchCode?.length).toBe(4);

    // Host assigns player3 to CHASERS
    const assignChaserRes = await GameStateStore.assignPlayerTeam(roomCode, hostId, player3Id, 'CHASERS');
    expect(assignChaserRes.success).toBe(true);
    const p3 = assignChaserRes.room!.members[player3Id];
    expect(p3.team).toBe('CHASERS');
    expect(p3.role).toBe('CHASER');
    expect(p3.catchCode).toBeUndefined();

    // Host unassigns player2 to NONE
    const unassignRes = await GameStateStore.assignPlayerTeam(roomCode, hostId, player2Id, 'NONE');
    expect(unassignRes.success).toBe(true);
    const p2After = unassignRes.room!.members[player2Id];
    expect(p2After.team).toBe('NONE');
    expect(p2After.catchCode).toBeUndefined();
  });

  it('2. Target chaser count configuration adheres to bounds', async () => {
    // Non-host rejected
    const nonHost = await GameStateStore.setTargetChaserCount(roomCode, player2Id, 2);
    expect(nonHost.success).toBe(false);

    // Count < 1 rejected
    const zeroRes = await GameStateStore.setTargetChaserCount(roomCode, hostId, 0);
    expect(zeroRes.success).toBe(false);
    expect(zeroRes.error).toContain('Target chaser count must be at least 1');

    // Count equal or exceeding total eligible rejected (must leave at least 1 runner)
    // 4 players in room -> max 3 chasers
    const exceedRes = await GameStateStore.setTargetChaserCount(roomCode, hostId, 4);
    expect(exceedRes.success).toBe(false);
    expect(exceedRes.error).toContain('Must leave at least 1 runner');

    // Valid count 2 succeeds
    const validRes = await GameStateStore.setTargetChaserCount(roomCode, hostId, 2);
    expect(validRes.success).toBe(true);
    expect(validRes.room!.config.targetChaserCount).toBe(2);
  });

  it('3. Auto-assign distributes players into balanced teams respecting targetChaserCount', async () => {
    // Set desired chasers to 2
    await GameStateStore.setTargetChaserCount(roomCode, hostId, 2);

    // Auto-assign teams
    const autoRes = await GameStateStore.autoAssignTeams(roomCode, hostId);
    expect(autoRes.success).toBe(true);
    expect(autoRes.chasersCount).toBe(2);
    expect(autoRes.runnersCount).toBe(2);

    const members = Object.values(autoRes.room!.members);
    const chasers = members.filter((m) => m.team === 'CHASERS');
    const runners = members.filter((m) => m.team === 'RUNNERS');
    expect(chasers.length).toBe(2);
    expect(runners.length).toBe(2);

    // All runners have catch codes, chasers do not
    for (const r of runners) {
      expect(r.catchCode).toBeDefined();
    }
    for (const c of chasers) {
      expect(c.catchCode).toBeUndefined();
    }
  });

  it('4. Host can set specific player roles', async () => {
    const roleRes = await GameStateStore.setPlayerRole(roomCode, hostId, player4Id, 'REFEREE');
    expect(roleRes.success).toBe(true);
    expect(roleRes.room!.members[player4Id].role).toBe('REFEREE');
    expect(roleRes.room!.members[player4Id].team).toBe('NONE');
  });

  it('5. Safety pause and resume lifecycle transitions properly', async () => {
    // Set 1 runner and 1 chaser, start match
    await GameStateStore.assignPlayerTeam(roomCode, hostId, hostId, 'CHASERS');
    await GameStateStore.assignPlayerTeam(roomCode, hostId, player2Id, 'RUNNERS');

    const startRes = await GameStateStore.startMatch(roomCode, hostId);
    expect(startRes.success).toBe(true);

    // Pause match
    const pauseRes = await GameStateStore.safetyPause(roomCode, player2Id, 'Hazard on course');
    expect(pauseRes.success).toBe(true);
    expect(pauseRes.room!.state).toBe('SAFETY_PAUSED');

    // Non-host cannot resume
    const nonHostResume = await GameStateStore.resumeMatch(roomCode, player2Id);
    expect(nonHostResume.success).toBe(false);

    // Host resumes match
    const hostResume = await GameStateStore.resumeMatch(roomCode, hostId);
    expect(hostResume.success).toBe(true);
    expect(hostResume.room!.state).toBe('ACTIVE');
  });
});
