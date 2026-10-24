import { describe, it, expect } from 'vitest';
import { RoomService } from '../src/services/roomService.js';

describe('Room Service', () => {
  it('generates 6-character room codes and sets up host member', () => {
    const roomService = new RoomService();
    const room = roomService.createRoom('host_123', 'socket_abc', 'Commander');

    expect(room.roomCode).toHaveLength(6);
    expect(room.hostId).toBe('host_123');
    expect(room.members['host_123'].role).toBe('HOST');
    expect(room.state).toBe('LOBBY');
  });

  it('allows runners to join and sanitize catch codes from opponents', () => {
    const roomService = new RoomService();
    const room = roomService.createRoom('host_1', 'sock_1', 'HostGuy');

    const joinResult = roomService.joinRoom(room.roomCode, 'runner_1', 'sock_2', 'Speedy');
    expect(joinResult.success).toBe(true);

    const runner = room.members['runner_1'];
    expect(runner.catchCode).toBeDefined();

    // View as opponent (chaser)
    const chaserJoin = roomService.joinRoom(room.roomCode, 'chaser_1', 'sock_3', 'Hunter');
    roomService.setPlayerRole(room.roomCode, 'host_1', 'chaser_1', 'CHASER');

    const chaserView = roomService.getSanitizedRoomView(room, 'chaser_1');
    expect(chaserView.members['runner_1'].catchCode).toBeUndefined();

    // View as the runner themselves
    const runnerView = roomService.getSanitizedRoomView(room, 'runner_1');
    expect(runnerView.members['runner_1'].catchCode).toBe(runner.catchCode);
  });
});
