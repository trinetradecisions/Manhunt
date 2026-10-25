import { describe, it, expect, beforeEach } from 'vitest';
import { GameStateStore, ExtendedRoomState } from '../../client/src/server/store';
import { PlayerTeam } from '../../client/src/types/game';

describe('PHASE 3 & 10: Multi-Player Scale, Concurrency & Roster Synchronization Test Suite', () => {
  let roomCode: string;
  const hostId = 'host_operative_prime';

  beforeEach(async () => {
    const room = await GameStateStore.createRoom({
      id: hostId,
      nickname: 'ViperPrime',
      initialLocation: { latitude: 37.7749, longitude: -122.4194 },
    });
    roomCode = room.roomCode;
  });

  it('1. Scales through 1, 2, 4, 6, 7, 8, 10, 12 players without missing or duplicate operatives', async () => {
    const playerCounts = [1, 2, 4, 6, 7, 8, 10, 12];
    let currentRosterCount = 1; // Host already present

    for (const targetCount of playerCounts) {
      const playersToAdd = targetCount - currentRosterCount;
      if (playersToAdd > 0) {
        const joinPromises = [];
        for (let i = 0; i < playersToAdd; i++) {
          const pId = `agent_${targetCount}_${i}`;
          const nick = `Agent-${targetCount}-${i}`;
          joinPromises.push(
            GameStateStore.joinRoom(roomCode, {
              id: pId,
              nickname: nick,
            })
          );
        }

        const joinResults = await Promise.all(joinPromises);
        for (const res of joinResults) {
          expect(res.success).toBe(true);
          expect(res.room).toBeDefined();
        }
        currentRosterCount = targetCount;
      }

      // Authoritative room state verification
      const room = await GameStateStore.getRoom(roomCode);
      expect(room).not.toBeNull();
      const memberKeys = Object.keys(room!.members);
      expect(memberKeys.length).toBe(targetCount);

      // Verify no duplicate IDs
      const uniqueIds = new Set(memberKeys);
      expect(uniqueIds.size).toBe(targetCount);

      // Verify sync state for all connected operatives
      for (const memberId of memberKeys) {
        const sync = await GameStateStore.getSyncState(roomCode, memberId, 0);
        expect(sync.changed).toBe(true);
        expect(sync.room).toBeDefined();
        expect(Object.keys(sync.room!.members).length).toBe(targetCount);
        expect(sync.room!.version).toBeGreaterThanOrEqual(targetCount);
      }
    }
  });

  it('2. Critical 8-Player & 12-Player Roster Synchronization & Monotonic Versioning', async () => {
    // Add 11 additional players to reach 12
    for (let i = 1; i <= 11; i++) {
      const joinRes = await GameStateStore.joinRoom(roomCode, {
        id: `operative_${i}`,
        nickname: `Agent_${i}`,
      });
      expect(joinRes.success).toBe(true);
    }

    const room12 = await GameStateStore.getRoom(roomCode);
    expect(Object.keys(room12!.members).length).toBe(12);

    // Delta sync: when polling with current version, changed should be false
    const currentVersion = room12!.version;
    const noChangeSync = await GameStateStore.getSyncState(roomCode, 'operative_1', currentVersion);
    expect(noChangeSync.changed).toBe(false);
    expect(noChangeSync.version).toBe(currentVersion);

    // When an action occurs (e.g. host sets ready or assigns team)
    const assignRes = await GameStateStore.assignPlayerTeam(roomCode, hostId, 'operative_1', 'CHASERS');
    expect(assignRes.success).toBe(true);

    // Operatives polling with old version immediately receive the update
    const updatedSync = await GameStateStore.getSyncState(roomCode, 'operative_2', currentVersion);
    expect(updatedSync.changed).toBe(true);
    expect(updatedSync.room).toBeDefined();
    expect(updatedSync.room!.members['operative_1'].team).toBe('CHASERS');
    expect(updatedSync.room!.version).toBeGreaterThan(currentVersion);
  });

  it('3. Exhaustive Team Assignment across 12 players (Manual, Drag-Drop, Auto-Balance)', async () => {
    // Populate 12 players
    for (let i = 1; i <= 11; i++) {
      await GameStateStore.joinRoom(roomCode, {
        id: `player_${i}`,
        nickname: `Tactical_${i}`,
      });
    }

    // Set desired chasers to 3
    const setChasersRes = await GameStateStore.setTargetChaserCount(roomCode, hostId, 3);
    expect(setChasersRes.success).toBe(true);
    expect(setChasersRes.room!.config.targetChaserCount).toBe(3);

    // Auto-assign teams
    const autoRes = await GameStateStore.autoAssignTeams(roomCode, hostId);
    expect(autoRes.success).toBe(true);
    expect(autoRes.chasersCount).toBe(3);
    expect(autoRes.runnersCount).toBe(9);

    const roomAfterAuto = await GameStateStore.getRoom(roomCode);
    const members = Object.values(roomAfterAuto!.members);
    const chasers = members.filter((m) => m.team === 'CHASERS');
    const runners = members.filter((m) => m.team === 'RUNNERS');
    expect(chasers.length).toBe(3);
    expect(runners.length).toBe(9);

    // Verify all runners have catch codes and chasers do not
    runners.forEach((r) => {
      expect(r.catchCode).toBeDefined();
      expect(r.catchCode!.length).toBe(4);
    });
    chasers.forEach((c) => {
      expect(c.catchCode).toBeUndefined();
    });

    // Manual / Drag-drop reallocation: move a chaser to runners
    const chaserToMove = chasers[0].id;
    const moveRes = await GameStateStore.assignPlayerTeam(roomCode, hostId, chaserToMove, 'RUNNERS');
    expect(moveRes.success).toBe(true);
    expect(moveRes.room!.members[chaserToMove].team).toBe('RUNNERS');
    expect(moveRes.room!.members[chaserToMove].catchCode).toBeDefined();

    // Verify non-host cannot reassign
    const unauthorized = await GameStateStore.assignPlayerTeam(roomCode, 'player_1', chaserToMove, 'CHASERS');
    expect(unauthorized.success).toBe(false);
    expect(unauthorized.error).toContain('Only Host');
  });

  it('4. Cold-Start Hydration & Disk Fallback Recovery across Serverless Invocations', async () => {
    // Add 4 players
    for (let i = 1; i <= 3; i++) {
      await GameStateStore.joinRoom(roomCode, {
        id: `p_${i}`,
        nickname: `Operative_${i}`,
      });
    }

    const room = await GameStateStore.getRoom(roomCode);
    expect(room).not.toBeNull();
    const originalVersion = room!.version;

    // Simulate complete in-memory wipe on cold serverless container
    if (globalThis.__MANHUNT_MEMORY_STORE__) {
      globalThis.__MANHUNT_MEMORY_STORE__.delete(roomCode);
    }

    // Disk fallback in /tmp should automatically restore the room!
    const restoredFromDisk = await GameStateStore.getRoom(roomCode);
    expect(restoredFromDisk).not.toBeNull();
    expect(Object.keys(restoredFromDisk!.members).length).toBe(4);
    expect(restoredFromDisk!.version).toBe(originalVersion);

    // Simulate instance hydration from client gossip
    const clientSnapshot = {
      ...restoredFromDisk!,
      version: originalVersion + 2,
    };
    const hydrateRes = await GameStateStore.hydrateRoom(clientSnapshot, hostId);
    expect(hydrateRes.success).toBe(true);
    expect(hydrateRes.room!.version).toBeGreaterThanOrEqual(originalVersion + 2);
  });

});
