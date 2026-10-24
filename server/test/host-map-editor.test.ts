import { describe, it, expect, beforeEach } from 'vitest';
import { RoomService } from '../src/services/roomService.js';
import { MatchService } from '../src/services/matchService.js';
import { PlayZone } from '../src/types/game.js';

describe('Host Play Area Map Editor & Boundary Synchronization', () => {
  let roomService: RoomService;
  let matchService: MatchService;
  let mockIo: any;
  let emittedEvents: Array<{ event: string; payload: any }> = [];

  beforeEach(() => {
    roomService = new RoomService();
    emittedEvents = [];
    mockIo = {
      to: () => ({
        emit: (event: string, payload: any) => {
          emittedEvents.push({ event, payload });
        },
      }),
    };
    matchService = new MatchService(mockIo as any, roomService);
  });

  it('allows the host to update the play area to a verified custom polygon with strategic markers', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');

    const customPolygonZone: PlayZone = {
      shapeType: 'POLYGON',
      centerLat: 51.5050,
      centerLng: -0.1250,
      radiusMeters: 600,
      vertices: [
        { lat: 51.5000, lng: -0.1300 },
        { lat: 51.5100, lng: -0.1300 },
        { lat: 51.5100, lng: -0.1200 },
        { lat: 51.5000, lng: -0.1200 },
      ],
      markers: [
        {
          id: 'm1',
          lat: 51.5020,
          lng: -0.1220,
          label: 'Extraction Point Alpha',
          type: 'SAFE_ZONE',
        },
        {
          id: 'm2',
          lat: 51.5080,
          lng: -0.1280,
          label: 'Rendezvous Point',
          type: 'MEETING_POINT',
        },
      ],
      version: 2,
    };

    const updateRes = roomService.updatePlayZone(room.roomCode, 'host_1', customPolygonZone);
    expect(updateRes.success).toBe(true);
    expect(room.config.playZone.shapeType).toBe('POLYGON');
    expect(room.config.playZone.vertices?.length).toBe(4);
    expect(room.config.playZone.markers?.length).toBe(2);
    expect(room.config.playZone.version).toBe(2);
    expect(room.config.playZone.areaSquareMeters).toBeGreaterThan(5000);
  });

  it('rejects play area updates from unauthorized guests', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
    roomService.joinRoom(room.roomCode, 'guest_2', 'sock_guest', 'Rogue');

    const guestZone: PlayZone = {
      shapeType: 'CIRCLE',
      centerLat: 51.5074,
      centerLng: -0.1278,
      radiusMeters: 400,
      version: 2,
    };

    const guestUpdate = roomService.updatePlayZone(room.roomCode, 'guest_2', guestZone);
    expect(guestUpdate.success).toBe(false);
    expect(guestUpdate.error).toContain('Only the Host');
  });

  it('rejects stale revisions when incoming version is older than or equal to current', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');

    // First update with version 5
    const zoneV5: PlayZone = {
      shapeType: 'CIRCLE',
      centerLat: 51.5000,
      centerLng: -0.1200,
      radiusMeters: 300,
      version: 5,
    };
    const res1 = roomService.updatePlayZone(room.roomCode, 'host_1', zoneV5);
    expect(res1.success).toBe(true);
    expect(room.config.playZone.version).toBe(5);

    // Stale update with version 4 (delayed/concurrent payload)
    const staleZone: PlayZone = {
      shapeType: 'CIRCLE',
      centerLat: 51.5000,
      centerLng: -0.1200,
      radiusMeters: 400,
      version: 4,
    };
    const staleRes = roomService.updatePlayZone(room.roomCode, 'host_1', staleZone);
    expect(staleRes.success).toBe(false);
    expect(staleRes.error).toContain('Stale revision');
  });

  it('rejects self-intersecting polygon geometry on the server', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');

    const selfIntersectingZone: PlayZone = {
      shapeType: 'POLYGON',
      centerLat: 51.5050,
      centerLng: -0.1250,
      radiusMeters: 500,
      vertices: [
        { lat: 51.5000, lng: -0.1300 },
        { lat: 51.5100, lng: -0.1100 },
        { lat: 51.5000, lng: -0.1100 },
        { lat: 51.5100, lng: -0.1300 },
      ],
      version: 2,
    };

    const res = roomService.updatePlayZone(room.roomCode, 'host_1', selfIntersectingZone);
    expect(res.success).toBe(false);
    expect(res.error).toContain('self-intersects');
  });

  it('prevents play area modification once match is active or in head-start', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
    roomService.joinRoom(room.roomCode, 'runner_1', 'sock_runner', 'Flash');
    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'host_1', 'CHASERS');
    roomService.assignPlayerTeam(room.roomCode, 'host_1', 'runner_1', 'RUNNERS');

    // Start match (enters 5-second COUNTDOWN sequence)
    const startRes = matchService.startMatch(room.roomCode, 'host_1');
    expect(startRes.success).toBe(true);
    expect(room.state).toBe('COUNTDOWN');

    // Attempt modification during active match
    const zone: PlayZone = {
      shapeType: 'CIRCLE',
      centerLat: 51.5000,
      centerLng: -0.1200,
      radiusMeters: 600,
      version: 3,
    };
    const modifyAttempt = roomService.updatePlayZone(room.roomCode, 'host_1', zone);
    expect(modifyAttempt.success).toBe(false);
    expect(modifyAttempt.error).toContain('Cannot modify play area while match is active');
  });

  it('preserves boundary geometry and markers across sanitization and reconnect views', () => {
    const room = roomService.createRoom('host_1', 'sock_host', 'Commander');
    const rectZone: PlayZone = {
      shapeType: 'RECTANGLE',
      centerLat: 51.5050,
      centerLng: -0.1250,
      radiusMeters: 500,
      northEast: { lat: 51.5100, lng: -0.1200 },
      southWest: { lat: 51.5000, lng: -0.1300 },
      markers: [
        {
          id: 'sp_1',
          lat: 51.5010,
          lng: -0.1290,
          label: 'Chaser Insertion Drop',
          type: 'START_POINT',
        },
      ],
      version: 2,
    };

    roomService.updatePlayZone(room.roomCode, 'host_1', rectZone);

    // Reconnecting guest fetches sanitized view
    const sanitized = roomService.getSanitizedRoomView(room, 'guest_unknown');
    expect(sanitized.config.playZone.shapeType).toBe('RECTANGLE');
    expect(sanitized.config.playZone.northEast).toEqual({ lat: 51.5100, lng: -0.1200 });
    expect(sanitized.config.playZone.southWest).toEqual({ lat: 51.5000, lng: -0.1300 });
    expect(sanitized.config.playZone.markers?.[0].label).toBe('Chaser Insertion Drop');
  });
});
