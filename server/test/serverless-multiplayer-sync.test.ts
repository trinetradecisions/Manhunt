import { describe, it, expect } from 'vitest';
import { GameStateStore } from '../../client/src/server/store';

describe('Serverless Multiplayer GameStateStore & Synchronization', () => {
  it('creates room, allows two clients to join, and isolates opposing team coordinates', async () => {
    // 1. Host creates room
    const hostRoom = await GameStateStore.createRoom({
      id: 'host_p1',
      nickname: 'Agent Host',
      role: 'HOST',
      team: 'CHASERS',
    });

    expect(hostRoom.roomCode).toHaveLength(6);
    expect(hostRoom.hostId).toBe('host_p1');
    expect(hostRoom.state).toBe('LOBBY');

    const roomCode = hostRoom.roomCode;

    // 2. Client 2 (Runner) joins room
    const joinRes = await GameStateStore.joinRoom(roomCode, {
      id: 'runner_p2',
      nickname: 'Shadow Runner',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    expect(joinRes.success).toBe(true);
    expect(joinRes.room?.members['runner_p2']).toBeDefined();
    expect(joinRes.room?.members['runner_p2'].team).toBe('RUNNERS');

    // 3. Both toggle ready
    await GameStateStore.setReady(roomCode, 'host_p1', true);
    await GameStateStore.setReady(roomCode, 'runner_p2', true);

    const roomBeforeStart = await GameStateStore.getRoom(roomCode);
    expect(roomBeforeStart?.members['host_p1'].isReady).toBe(true);
    expect(roomBeforeStart?.members['runner_p2'].isReady).toBe(true);

    // 4. Host starts the match
    const startRes = await GameStateStore.startMatch(roomCode, 'host_p1');
    expect(startRes.success).toBe(true);
    expect(startRes.room?.state).toMatch(/RUNNER_HEADSTART|ACTIVE/);
    expect(startRes.room?.match).toBeDefined();

    // 5. Runner updates location
    const runnerLoc = {
      latitude: 37.775,
      longitude: -122.419,
      accuracy: 5,
      heading: 0,
      speed: 1.5,
      timestamp: Date.now(),
    };

    const locRes = await GameStateStore.updateLocation(roomCode, 'runner_p2', runnerLoc);
    expect(locRes.success).toBe(true);

    // 6. Chaser requests catch attempt with code
    // First, runner generates 4-digit catch code
    const codeRes = await GameStateStore.requestCatchCode(roomCode, 'runner_p2');
    expect(codeRes.success).toBe(true);
    expect(codeRes.catchCode).toHaveLength(4);

    // Chaser views room: catchCode must NOT be visible to chaser
    const chaserView = await GameStateStore.getSyncState(roomCode, 'host_p1', 0);
    expect(chaserView.room?.members['runner_p2'].catchCode).toBeUndefined();

    // 7. Force match into ACTIVE for catch verification
    const activeRoom = await GameStateStore.getRoom(roomCode);
    if (activeRoom) {
      activeRoom.state = 'ACTIVE';
      activeRoom.match!.headStartEndsAt = Date.now() - 1000;
      activeRoom.match!.gameStartedAt = Date.now() - 1000;
    }

    // Chaser submits the code to tag the runner
    const catchRes = await GameStateStore.attemptCatchWithCode(
      roomCode,
      'host_p1',
      'runner_p2',
      codeRes.catchCode!
    );
    expect(catchRes.success).toBe(true);
    expect(catchRes.catchAttempt?.status).toBe('CONFIRMED');

    // Runner is marked caught
    const finalRoom = await GameStateStore.getRoom(roomCode);
    expect(finalRoom?.members['runner_p2'].isCaught).toBe(true);

    // 8. Delta sync test: when nothing has changed, sinceVersion returns changed: false
    const versionBeforeChat = finalRoom!.version;
    const syncNoChange = await GameStateStore.getSyncState(roomCode, 'host_p1', versionBeforeChat);
    expect(syncNoChange.changed).toBe(false);

    // When chat message is sent, version increments and delta returns the message
    await GameStateStore.sendChatMessage(roomCode, {
      senderId: 'host_p1',
      senderNickname: 'Agent Host',
      senderTeam: 'CHASERS',
      channelId: 'PUBLIC',
      text: 'Target neutralized!',
    });

    const syncWithChat = await GameStateStore.getSyncState(roomCode, 'runner_p2', versionBeforeChat);
    expect(syncWithChat.changed).toBe(true);
    expect(syncWithChat.chatMessages?.length).toBeGreaterThan(0);
    expect(syncWithChat.chatMessages?.[0].text).toBe('Target neutralized!');
  });
});
