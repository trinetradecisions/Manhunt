import { describe, it, expect, beforeEach } from 'vitest';
import { GameStateStore } from '../../client/src/server/store';

describe('Serverless WebRTC Voice Signaling & Squad Isolation Test Suite', () => {
  let roomCode: string;
  const hostId = 'host_commander';
  const runner1Id = 'runner_one';
  const runner2Id = 'runner_two';
  const chaser1Id = 'chaser_one';

  beforeEach(async () => {
    const room = await GameStateStore.createRoom({
      id: hostId,
      nickname: 'HostCommander',
      role: 'HOST',
      initialLocation: { latitude: 37.7749, longitude: -122.4194 },
    });
    roomCode = room.roomCode;

    await GameStateStore.joinRoom(roomCode, { id: runner1Id, nickname: 'Runner1' });
    await GameStateStore.joinRoom(roomCode, { id: runner2Id, nickname: 'Runner2' });
    await GameStateStore.joinRoom(roomCode, { id: chaser1Id, nickname: 'Chaser1' });

    // Assign teams
    await GameStateStore.assignPlayerTeam(roomCode, hostId, runner1Id, 'RUNNERS');
    await GameStateStore.assignPlayerTeam(roomCode, hostId, runner2Id, 'RUNNERS');
    await GameStateStore.assignPlayerTeam(roomCode, hostId, chaser1Id, 'CHASERS');
  });

  it('1. Public Radio channel allows all room members to discover each other', async () => {
    // Runner1 joins PUBLIC channel
    const res1 = await GameStateStore.joinVoiceChannel(roomCode, runner1Id, 'PUBLIC');
    expect(res1.success).toBe(true);
    expect(res1.participants).toEqual([]); // First to join

    // Chaser1 joins PUBLIC channel
    const res2 = await GameStateStore.joinVoiceChannel(roomCode, chaser1Id, 'PUBLIC');
    expect(res2.success).toBe(true);
    expect(res2.participants?.length).toBe(1);
    expect(res2.participants?.[0].playerId).toBe(runner1Id);

    // Runner2 joins PUBLIC channel
    const res3 = await GameStateStore.joinVoiceChannel(roomCode, runner2Id, 'PUBLIC');
    expect(res3.success).toBe(true);
    expect(res3.participants?.length).toBe(2);
    const discoveredIds = res3.participants?.map((p) => p.playerId);
    expect(discoveredIds).toContain(runner1Id);
    expect(discoveredIds).toContain(chaser1Id);
  });

  it('2. Squad Radio channel strictly isolates Runners from Chasers', async () => {
    // Runner1 joins SQUAD
    const res1 = await GameStateStore.joinVoiceChannel(roomCode, runner1Id, 'SQUAD');
    expect(res1.success).toBe(true);
    expect(res1.participants?.length).toBe(0);

    // Chaser1 joins SQUAD (on Chaser squad)
    const res2 = await GameStateStore.joinVoiceChannel(roomCode, chaser1Id, 'SQUAD');
    expect(res2.success).toBe(true);
    // Chaser1 must NOT see Runner1!
    expect(res2.participants?.length).toBe(0);

    // Runner2 joins SQUAD
    const res3 = await GameStateStore.joinVoiceChannel(roomCode, runner2Id, 'SQUAD');
    expect(res3.success).toBe(true);
    // Runner2 must see Runner1, but NOT Chaser1
    expect(res3.participants?.length).toBe(1);
    expect(res3.participants?.[0].playerId).toBe(runner1Id);

    // Sync state for Runner1 should only show Runner2 (same squad), not Chaser1
    const sync1 = await GameStateStore.getSyncState(roomCode, runner1Id);
    const visibleParticipants = sync1.voiceParticipants || [];
    const visibleIds = visibleParticipants.map((p: any) => p.playerId);
    expect(visibleIds).toContain(runner2Id);
    expect(visibleIds).not.toContain(chaser1Id);
  });

  it('3. WebRTC signals between squads are blocked when channel is SQUAD', async () => {
    await GameStateStore.joinVoiceChannel(roomCode, runner1Id, 'SQUAD');
    await GameStateStore.joinVoiceChannel(roomCode, chaser1Id, 'SQUAD');

    // Chaser1 attempts to send WebRTC offer/candidate to Runner1 on SQUAD channel
    const blockedSignal = await GameStateStore.recordVoiceSignal(roomCode, chaser1Id, runner1Id, {
      type: 'offer',
      sdp: 'mock-sdp-cross-squad',
    });
    expect(blockedSignal.success).toBe(false);
    expect(blockedSignal.error).toContain('Squad voice isolation violation');

    // Runner1 to Runner2 (same squad) succeeds
    await GameStateStore.joinVoiceChannel(roomCode, runner2Id, 'SQUAD');
    const validSignal = await GameStateStore.recordVoiceSignal(roomCode, runner1Id, runner2Id, {
      type: 'offer',
      sdp: 'mock-sdp-legit',
    });
    expect(validSignal.success).toBe(true);

    // Runner2 retrieves the signal via sync
    const sync2 = await GameStateStore.getSyncState(roomCode, runner2Id);
    expect(sync2.voiceSignals?.length).toBeGreaterThanOrEqual(1);
    const signal = sync2.voiceSignals?.[0];
    expect(signal.senderId).toBe(runner1Id);
    expect(signal.fromPlayerId).toBe(runner1Id);
    expect(signal.targetPlayerId).toBe(runner2Id);
    expect(signal.signal.sdp).toBe('mock-sdp-legit');
  });

  it('4. Speaking indicator updates and broadcasts to peers', async () => {
    await GameStateStore.joinVoiceChannel(roomCode, runner1Id, 'PUBLIC');
    const speakingRes = await GameStateStore.setVoiceSpeaking(roomCode, runner1Id, true);
    expect(speakingRes.success).toBe(true);

    const syncState = await GameStateStore.getSyncState(roomCode, runner2Id);
    const p1 = (syncState.voiceParticipants || []).find((p: any) => p.playerId === runner1Id);
    expect(p1?.isSpeaking).toBe(true);

    // Release PTT
    await GameStateStore.setVoiceSpeaking(roomCode, runner1Id, false);
    const syncStateAfter = await GameStateStore.getSyncState(roomCode, runner2Id);
    const p1After = (syncStateAfter.voiceParticipants || []).find((p: any) => p.playerId === runner1Id);
    expect(p1After?.isSpeaking).toBe(false);
  });

  it('5. Leaving voice channel cleans up participants and resets state', async () => {
    await GameStateStore.joinVoiceChannel(roomCode, runner1Id, 'PUBLIC');
    await GameStateStore.joinVoiceChannel(roomCode, runner2Id, 'PUBLIC');

    const leaveRes = await GameStateStore.leaveVoiceChannel(roomCode, runner1Id);
    expect(leaveRes.success).toBe(true);

    const syncState = await GameStateStore.getSyncState(roomCode, runner2Id);
    const remainingIds = (syncState.voiceParticipants || []).map((p: any) => p.playerId);
    expect(remainingIds).not.toContain(runner1Id);
  });
});
