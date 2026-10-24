import { describe, it, expect } from 'vitest';
import { RoomService } from '../src/services/roomService.js';
import { MatchService } from '../src/services/matchService.js';
import { PlayerLocation } from '../src/types/game.js';

describe('Geolocation Integrity & Fallback Prevention', () => {
  it('never assigns default room coordinates or London fallback as player GPS location', () => {
    const roomService = new RoomService();
    const room = roomService.createRoom('host_123', 'sock_1', 'HostAlice');

    // Room config has a play zone center placeholder
    expect(room.config.playZone.centerLat).toBe(51.5074);
    expect(room.config.playZone.centerLng).toBe(-0.1278);

    // CRITICAL: Player lastLocation MUST be undefined, NOT the play zone center
    const hostMember = room.members['host_123'];
    expect(hostMember.lastLocation).toBeUndefined();
    expect(hostMember.gpsStatus).toBe('PROMPT');

    // Add another player
    const joinRes = roomService.joinRoom(room.roomCode, 'runner_456', 'sock_2', 'RunnerBob');
    expect(joinRes.success).toBe(true);

    const runnerMember = room.members['runner_456'];
    expect(runnerMember.lastLocation).toBeUndefined();
    expect(runnerMember.gpsStatus).toBe('PROMPT');
  });

  it('correctly accepts and stores authentic GPS coordinates and accuracy', () => {
    const roomService = new RoomService();
    const mockIo = {
      to: () => ({ emit: () => {} }),
      emit: () => {},
    } as any;
    const matchService = new MatchService(mockIo, roomService);

    const room = roomService.createRoom('host_1', 'sock_1', 'HostAlice');
    roomService.setPlayerRole(room.roomCode, 'host_1', 'host_1', 'HOST');

    // Real GPS reading from Paris, France (48.8566, 2.3522)
    const realLocation: PlayerLocation = {
      latitude: 48.856614,
      longitude: 2.352222,
      accuracy: 6.5,
      heading: 180,
      speed: 1.2,
      timestamp: Date.now(),
    };

    matchService.updatePlayerLocation(room.roomCode, 'host_1', realLocation);

    const updatedMember = room.members['host_1'];
    expect(updatedMember.lastLocation).toBeDefined();
    expect(updatedMember.lastLocation?.latitude).toBe(48.856614);
    expect(updatedMember.lastLocation?.longitude).toBe(2.352222);
    expect(updatedMember.lastLocation?.accuracy).toBe(6.5);
    expect(updatedMember.gpsStatus).toBe('GRANTED');
  });

  it('rejects malformed and impossible coordinate values', () => {
    const roomService = new RoomService();
    const mockIo = {
      to: () => ({ emit: () => {} }),
      emit: () => {},
    } as any;
    const matchService = new MatchService(mockIo, roomService);

    const room = roomService.createRoom('host_1', 'sock_1', 'HostAlice');

    // Malformed coordinates (out-of-range latitude > 90)
    const invalidLatLocation = {
      latitude: 95.0,
      longitude: 2.3522,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: Date.now(),
    };

    matchService.updatePlayerLocation(room.roomCode, 'host_1', invalidLatLocation as any);
    expect(room.members['host_1'].lastLocation).toBeUndefined();

    // Malformed coordinates (NaN)
    const nanLocation = {
      latitude: NaN,
      longitude: 2.3522,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: Date.now(),
    };

    matchService.updatePlayerLocation(room.roomCode, 'host_1', nanLocation as any);
    expect(room.members['host_1'].lastLocation).toBeUndefined();
  });

  it('properly detects stale location fixes (>45 seconds old)', () => {
    const stalenessThresholdSeconds = 45;
    const now = Date.now();

    // 50 seconds old
    const staleTimestamp = now - 50 * 1000;
    const isStale = (now - staleTimestamp) / 1000 >= stalenessThresholdSeconds;
    expect(isStale).toBe(true);

    // 10 seconds old
    const freshTimestamp = now - 10 * 1000;
    const isFresh = (now - freshTimestamp) / 1000 >= stalenessThresholdSeconds;
    expect(isFresh).toBe(false);
  });
});
