import { describe, it, expect } from 'vitest';
import { canTransitionState } from '../src/engine/stateMachine.js';

describe('Game State Machine', () => {
  it('permits Host to start ready check and countdown', () => {
    const res1 = canTransitionState('LOBBY', 'READY_CHECK', 'HOST');
    expect(res1.allowed).toBe(true);

    const res2 = canTransitionState('READY_CHECK', 'COUNTDOWN', 'HOST');
    expect(res2.allowed).toBe(true);
  });

  it('rejects Runner from triggering ready check or countdown', () => {
    const res = canTransitionState('LOBBY', 'READY_CHECK', 'RUNNER');
    expect(res.allowed).toBe(false);
  });

  it('permits both Host and Referee to trigger emergency safety pause', () => {
    const hostPause = canTransitionState('ACTIVE', 'SAFETY_PAUSED', 'HOST');
    expect(hostPause.allowed).toBe(true);

    const refPause = canTransitionState('ACTIVE', 'SAFETY_PAUSED', 'REFEREE');
    expect(refPause.allowed).toBe(true);
  });

  it('rejects illegal non-contiguous jumps like LOBBY directly to COMPLETED', () => {
    const res = canTransitionState('LOBBY', 'COMPLETED', 'HOST');
    expect(res.allowed).toBe(false);
  });
});
