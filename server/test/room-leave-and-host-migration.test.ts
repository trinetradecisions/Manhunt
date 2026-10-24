import { describe, it, expect, beforeEach } from 'vitest';
import { RoomService } from '../src/services/roomService.js';

describe('RoomService - Player Leave and Host Migration', () => {
  let roomService: RoomService;

  beforeEach(() => {
    roomService = new RoomService();
  });

  it('allows a normal player to leave a room and updates remaining counts', () => {
    const room = roomService.createRoom('host-1', 'sock-1', 'Alpha');
    roomService.joinRoom(room.roomCode, 'p2', 'sock-2', 'Bravo');
    roomService.joinRoom(room.roomCode, 'p3', 'sock-3', 'Charlie');

    expect(Object.keys(room.members).length).toBe(3);

    const leaveResult = roomService.leaveRoom(room.roomCode, 'p2');
    expect(leaveResult.success).toBe(true);
    expect(leaveResult.roomClosed).toBe(false);
    expect(Object.keys(room.members).length).toBe(2);
    expect(room.members['p2']).toBeUndefined();
    expect(room.hostId).toBe('host-1');
  });

  it('deterministically elects a replacement host when host departs and preserves team assignment', () => {
    const room = roomService.createRoom('host-1', 'sock-1', 'Commander');
    roomService.joinRoom(room.roomCode, 'runner-1', 'sock-2', 'Speedy');
    roomService.assignPlayerTeam(room.roomCode, 'host-1', 'runner-1', 'RUNNERS');

    expect(room.hostId).toBe('host-1');
    expect(room.members['runner-1'].team).toBe('RUNNERS');

    const leaveResult = roomService.leaveRoom(room.roomCode, 'host-1');
    expect(leaveResult.success).toBe(true);
    expect(leaveResult.newHostId).toBe('runner-1');
    expect(room.hostId).toBe('runner-1');
    expect(room.members['runner-1'].role).toBe('HOST');
    // Team assignment must be preserved
    expect(room.members['runner-1'].team).toBe('RUNNERS');
    expect(room.members['host-1']).toBeUndefined();
  });

  it('closes and deletes the room when the last player leaves', () => {
    const room = roomService.createRoom('host-alone', 'sock-1', 'LoneWolf');
    const leaveResult = roomService.leaveRoom(room.roomCode, 'host-alone');

    expect(leaveResult.success).toBe(true);
    expect(leaveResult.roomClosed).toBe(true);
    expect(roomService.getRoom(room.roomCode)).toBeUndefined();
  });

  it('rejects leave requests for nonexistent rooms or unknown players', () => {
    const res1 = roomService.leaveRoom('NONEXIST', 'p1');
    expect(res1.success).toBe(false);
    expect(res1.error).toBe('Room not found');

    const room = roomService.createRoom('h1', 's1', 'H');
    const res2 = roomService.leaveRoom(room.roomCode, 'stranger');
    expect(res2.success).toBe(false);
    expect(res2.error).toBe('Player not in room');
  });
});
