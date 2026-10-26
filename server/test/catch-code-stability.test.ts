import { describe, it, expect } from 'vitest';
import { GameStateStore } from '../../client/src/server/store';

describe('Authoritative Catch-Code Verification, Stability & Anti-Tamper', () => {
  it('verifies all 12 catch-code stability, security and lifecycle requirements', async () => {
    // 1. Setup Room with 1 Host (Chaser) and 2 Runners
    const hostRoom = await GameStateStore.createRoom({
      id: 'chaser_1',
      nickname: 'Alpha Chaser',
      role: 'HOST',
      team: 'CHASERS',
    });
    const roomCode = hostRoom.roomCode;

    await GameStateStore.joinRoom(roomCode, {
      id: 'runner_1',
      nickname: 'Speedy Runner',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    await GameStateStore.joinRoom(roomCode, {
      id: 'runner_2',
      nickname: 'Ghost Runner',
      role: 'RUNNER',
      team: 'RUNNERS',
    });

    await GameStateStore.setReady(roomCode, 'chaser_1', true);
    await GameStateStore.setReady(roomCode, 'runner_1', true);
    await GameStateStore.setReady(roomCode, 'runner_2', true);

    // Start match: initializes authoritative catch codes for all runners
    const startRes = await GameStateStore.startMatch(roomCode, 'chaser_1');
    expect(startRes.success).toBe(true);

    // Requirement 1: A runner receives a valid 4-digit code
    const codeReq1 = await GameStateStore.requestCatchCode(roomCode, 'runner_1');
    expect(codeReq1.success).toBe(true);
    expect(codeReq1.catchCode).toBeDefined();
    expect(codeReq1.catchCode).toMatch(/^\d{4}$/);
    expect(codeReq1.expiresAt).toBeGreaterThan(Date.now());
    const validCode = codeReq1.catchCode!;
    const expiresAt = codeReq1.expiresAt!;

    // Requirement 2: Repeated polling returns the same code while valid
    const poll1 = await GameStateStore.requestCatchCode(roomCode, 'runner_1');
    const poll2 = await GameStateStore.requestCatchCode(roomCode, 'runner_1');
    expect(poll1.catchCode).toBe(validCode);
    expect(poll2.catchCode).toBe(validCode);
    expect(poll1.expiresAt).toBe(expiresAt);

    // Requirement 3 & 4: Refreshing and reconnecting preserves the code during validity period
    // The runner syncs or gets room:
    const raw = await GameStateStore.getRoom(roomCode);
    const runnerState = GameStateStore.sanitizeRoomForPlayer(raw!, 'runner_1');
    expect(runnerState.members['runner_1'].catchCode).toBe(validCode);

    // Other players (Chaser) CANNOT see runner's catch code in sanitized state
    const chaserState = GameStateStore.sanitizeRoomForPlayer(raw!, 'chaser_1');
    expect(chaserState.members['runner_1'].catchCode).toBeUndefined();

    // Requirement 5: The code remains consistent across separate Vercel function invocations
    // Simulate a cold lambda hydration where a chaser sends their sanitized room snapshot
    await GameStateStore.hydrateRoom(chaserState, 'chaser_1');
    // Ensure the server did NOT erase the authoritative runner catch code!
    const verifiedRunnerRoom = await GameStateStore.getRoom(roomCode);
    expect(verifiedRunnerRoom?.members['runner_1'].catchCode).toBe(validCode);

    // Transition room to ACTIVE (past headstart) for catch verification testing
    if (verifiedRunnerRoom) {
      verifiedRunnerRoom.state = 'ACTIVE';
      if (verifiedRunnerRoom.match) {
        verifiedRunnerRoom.match.headStartEndsAt = Date.now() - 1000;
        verifiedRunnerRoom.match.gameStartedAt = Date.now() - 1000;
      }
      await (GameStateStore as any).saveRawRoom(verifiedRunnerRoom);
    }

    // Requirement 6: A wrong code is rejected
    const wrongAttempt = await GameStateStore.attemptCatchWithCode(
      roomCode,
      'chaser_1',
      'runner_1',
      '0000' === validCode ? '9999' : '0000'
    );
    expect(wrongAttempt.success).toBe(false);
    expect(wrongAttempt.error).toMatch(/incorrect|invalid/i);
    expect(wrongAttempt.attemptsRemaining).toBe(2);

    // Test lockout protection after 3 failed attempts
    const wrong2 = await GameStateStore.attemptCatchWithCode(roomCode, 'chaser_1', 'runner_1', '1111');
    expect(wrong2.attemptsRemaining).toBe(1);
    const wrong3 = await GameStateStore.attemptCatchWithCode(roomCode, 'chaser_1', 'runner_1', '2222');
    expect(wrong3.attemptsRemaining).toBe(0);
    // 4th attempt is locked out
    const lockedAttempt = await GameStateStore.attemptCatchWithCode(roomCode, 'chaser_1', 'runner_1', validCode);
    expect(lockedAttempt.success).toBe(false);
    expect(lockedAttempt.error).toMatch(/too many failed attempts|lockout/i);

    // Requirement 7: An expired code is rejected
    // Test on runner_2 by artificially expiring their code
    const r2CodeReq = await GameStateStore.requestCatchCode(roomCode, 'runner_2');
    const r2Code = r2CodeReq.catchCode!;
    const rawRoom = await GameStateStore.getRoom(roomCode);
    if (rawRoom?.members['runner_2']) {
      rawRoom.members['runner_2'].catchCodeExpiresAt = Date.now() - 1000; // expired
    }
    const expiredAttempt = await GameStateStore.attemptCatchWithCode(
      roomCode,
      'chaser_1',
      'runner_2',
      r2Code
    );
    expect(expiredAttempt.success).toBe(false);
    expect(expiredAttempt.error).toMatch(/expired/i);

    // Requirement 12: Code rotation after expiry works according to configured rules
    const renewedCodeReq = await GameStateStore.requestCatchCode(roomCode, 'runner_2');
    expect(renewedCodeReq.success).toBe(true);
    expect(renewedCodeReq.catchCode).toBeDefined();
    expect(renewedCodeReq.expiresAt).toBeGreaterThan(Date.now());
    const renewedCode = renewedCodeReq.catchCode!;

    // Requirement 10: An unauthorized player cannot submit a catch on behalf of another player
    const unauthorizedAttempt = await GameStateStore.attemptCatchWithCode(
      roomCode,
      'runner_1', // A runner cannot submit a catch!
      'runner_2',
      renewedCode
    );
    expect(unauthorizedAttempt.success).toBe(false);
    expect(unauthorizedAttempt.error).toMatch(/only chasers/i);

    // Requirement 11: A successful catch updates all clients and scores exactly once
    const successfulCatch = await GameStateStore.attemptCatchWithCode(
      roomCode,
      'chaser_1',
      'runner_2',
      renewedCode
    );
    expect(successfulCatch.success).toBe(true);
    expect(successfulCatch.catchAttempt?.status).toBe('CONFIRMED');
    expect(successfulCatch.room?.members['runner_2'].isCaught).toBe(true);
    expect(successfulCatch.room?.members['runner_2'].catchCode).toBeUndefined(); // Authoritatively cleared

    const initialChaserScore = successfulCatch.room?.match?.scoreLedger.individualScores['chaser_1'] || 0;
    expect(initialChaserScore).toBeGreaterThan(0);

    // Requirement 8: A code cannot be replayed to obtain another catch
    const replayAttempt = await GameStateStore.attemptCatchWithCode(
      roomCode,
      'chaser_1',
      'runner_2',
      renewedCode
    );
    expect(replayAttempt.success).toBe(false);
    expect(replayAttempt.error).toMatch(/already caught/i);

    // Requirement 9: Two simultaneous catch attempts cannot catch the same runner twice
    // Attempt concurrent catches on runner_1 after lockout expires or on freshly renewed code
    if (rawRoom) {
      rawRoom.members['runner_1'].catchCode = '7777';
      rawRoom.members['runner_1'].catchCodeExpiresAt = Date.now() + 60000;
      rawRoom.members['runner_1'].isCaught = false;
    }
    // Clear lockout map for test
    (GameStateStore as any).failedCodeAttempts?.clear();

    const [attemptA, attemptB] = await Promise.all([
      GameStateStore.attemptCatchWithCode(roomCode, 'chaser_1', 'runner_1', '7777'),
      GameStateStore.attemptCatchWithCode(roomCode, 'chaser_1', 'runner_1', '7777'),
    ]);

    // Exactly one must succeed, the other must fail because runner is already caught
    const successCount = (attemptA.success ? 1 : 0) + (attemptB.success ? 1 : 0);
    expect(successCount).toBe(1);

    const finalRoom = await GameStateStore.getRoom(roomCode);
    expect(finalRoom?.members['runner_1'].isCaught).toBe(true);
  });
});
