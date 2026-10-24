import { describe, it, expect, beforeEach } from 'vitest';
import { PlayerStatsService } from '../src/services/playerStatsService.js';
import { PlayerLocation } from '../src/types/game.js';

describe('PlayerStatsService - GPS Distance Calculation and Integrity', () => {
  let statsService: PlayerStatsService;

  beforeEach(() => {
    statsService = new PlayerStatsService();
  });

  it('accumulates distance for valid consecutive GPS movements', () => {
    const pId = 'test-player-' + Date.now();
    const now = Date.now();

    // Start at Trafalgar Square (London)
    const loc1: PlayerLocation = {
      latitude: 51.5080,
      longitude: -0.1280,
      accuracy: 10,
      heading: null,
      speed: 1.5,
      timestamp: now,
    };

    // Move ~50 meters North 30 seconds later (speed ~1.67 m/s, perfectly plausible)
    const loc2: PlayerLocation = {
      latitude: 51.5085,
      longitude: -0.1280,
      accuracy: 8,
      heading: null,
      speed: 1.6,
      timestamp: now + 30000,
    };

    const res1 = statsService.recordLocation(pId, loc1, true, 'TestOp');
    expect(res1.accepted).toBe(true);

    const res2 = statsService.recordLocation(pId, loc2, true, 'TestOp');
    expect(res2.accepted).toBe(true);
    expect(res2.distanceAdded).toBeGreaterThan(40);
    expect(res2.distanceAdded).toBeLessThan(70);

    const stats = statsService.getOrCreateStats(pId);
    expect(stats.totalDistanceMeters).toBeGreaterThan(40);
    expect(stats.currentMatchDistanceMeters).toBe(stats.totalDistanceMeters);
  });

  it('suppresses stationary GPS jitter (< 3m) from inflating distance', () => {
    const pId = 'jitter-player-' + Date.now();
    const now = Date.now();

    const loc1: PlayerLocation = {
      latitude: 51.5080,
      longitude: -0.1280,
      accuracy: 12,
      heading: null,
      speed: 0.1,
      timestamp: now,
    };

    // Jitter of 0.00001 degrees lat is ~1.1 meters
    const jitterLoc: PlayerLocation = {
      latitude: 51.50801,
      longitude: -0.1280,
      accuracy: 14,
      heading: null,
      speed: 0.2,
      timestamp: now + 5000,
    };

    statsService.recordLocation(pId, loc1, true);
    const res = statsService.recordLocation(pId, jitterLoc, true);

    expect(res.accepted).toBe(true);
    expect(res.reason).toBe('Stationary jitter filtered');
    expect(res.distanceAdded).toBe(0);

    const stats = statsService.getOrCreateStats(pId);
    expect(stats.totalDistanceMeters).toBe(0);
  });

  it('rejects impossible GPS teleportation jumps (> 12 m/s)', () => {
    const pId = 'teleport-player-' + Date.now();
    const now = Date.now();

    const loc1: PlayerLocation = {
      latitude: 51.5080,
      longitude: -0.1280,
      accuracy: 10,
      heading: null,
      speed: 2.0,
      timestamp: now,
    };

    // Jump 1 km in 2 seconds (500 m/s)
    const locJump: PlayerLocation = {
      latitude: 51.5170,
      longitude: -0.1280,
      accuracy: 10,
      heading: null,
      speed: 50.0,
      timestamp: now + 2000,
    };

    statsService.recordLocation(pId, loc1, true);
    const res = statsService.recordLocation(pId, locJump, true);

    expect(res.accepted).toBe(false);
    expect(res.reason).toContain('Implausible speed');
    expect(res.distanceAdded).toBe(0);

    const stats = statsService.getOrCreateStats(pId);
    expect(stats.totalDistanceMeters).toBe(0);
  });

  it('rejects duplicate or backwards timestamps', () => {
    const pId = 'dup-player-' + Date.now();
    const now = Date.now();

    const loc1: PlayerLocation = {
      latitude: 51.5080,
      longitude: -0.1280,
      accuracy: 10,
      heading: null,
      speed: 1.0,
      timestamp: now,
    };

    const locDup: PlayerLocation = {
      latitude: 51.5085,
      longitude: -0.1280,
      accuracy: 10,
      heading: null,
      speed: 1.0,
      timestamp: now, // identical timestamp
    };

    statsService.recordLocation(pId, loc1, true);
    const res = statsService.recordLocation(pId, locDup, true);

    expect(res.accepted).toBe(false);
    expect(res.reason).toContain('Duplicate');
  });

  it('records match outcomes and increments play time, matches, and escapes/catches', () => {
    const pRunner = 'runner-stats-' + Date.now();
    const pChaser = 'chaser-stats-' + Date.now();

    statsService.recordMatchOutcome(
      'ROOM1',
      'match-101',
      600, // 10 minutes
      'RUNNERS',
      [
        { id: pRunner, nickname: 'Flash', role: 'RUNNER', team: 'RUNNERS', isCaught: false },
        { id: pChaser, nickname: 'Hunter', role: 'CHASER', team: 'CHASERS' },
      ]
    );

    const runnerStats = statsService.getOrCreateStats(pRunner);
    expect(runnerStats.matchesPlayed).toBe(1);
    expect(runnerStats.matchesWon).toBe(1);
    expect(runnerStats.escapes).toBe(1);
    expect(runnerStats.timesCaught).toBe(0);
    expect(runnerStats.totalPlaytimeSeconds).toBe(600);
    expect(runnerStats.matchHistory?.length).toBe(1);
    expect(runnerStats.matchHistory?.[0].won).toBe(true);

    const chaserStats = statsService.getOrCreateStats(pChaser);
    expect(chaserStats.matchesPlayed).toBe(1);
    expect(chaserStats.matchesWon).toBe(0);
    expect(chaserStats.totalPlaytimeSeconds).toBe(600);
  });
});
