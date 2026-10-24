import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { io as Client, Socket } from 'socket.io-client';
import { RoomService } from '../src/services/roomService.js';
import { MatchService } from '../src/services/matchService.js';
import { RadioService } from '../src/services/radioService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Full Stack Multiplayer Integration Test', () => {
  let server: http.Server;
  let ioServer: Server;
  let port: number;
  let hostSocket: Socket;
  let runnerSocket: Socket;
  let chaserSocket: Socket;
  let roomCode: string;

  const roomService = new RoomService();

  beforeAll(async () => {
    const app = express();
    server = http.createServer(app);
    ioServer = new Server(server, { cors: { origin: '*' } });

    const matchService = new MatchService(ioServer, roomService);
    const radioService = new RadioService(
      ioServer,
      roomService,
      path.join(__dirname, '../uploads/audio_test')
    );

    // Socket dispatcher with acknowledgements
    ioServer.on('connection', (socket) => {
      socket.on('room:join', ({ roomCode, playerId, nickname }, cb) => {
        const res = roomService.joinRoom(roomCode, playerId, socket.id, nickname);
        if (res.success && res.room) {
          socket.join(roomCode);
          matchService.broadcastRoomState(res.room);
          if (cb) cb({ success: true, room: res.room });
        } else {
          if (cb) cb({ success: false, error: res.error });
        }
      });

      socket.on('player:set_role', ({ roomCode, requesterId, targetPlayerId, role }, cb) => {
        const res = roomService.setPlayerRole(roomCode, requesterId, targetPlayerId, role);
        if (res.success && res.room) {
          matchService.broadcastRoomState(res.room);
          if (cb) cb({ success: true });
        } else {
          if (cb) cb({ success: false, error: res.error });
        }
      });

      socket.on('location:update', ({ roomCode, playerId, location }) => {
        matchService.updatePlayerLocation(roomCode, playerId, location);
      });

      socket.on('catch:attempt', ({ roomCode, chaserId, targetRunnerId }, cb) => {
        const res = matchService.attemptCatch(roomCode, chaserId, targetRunnerId);
        if (cb) cb(res);
      });

      socket.on('catch:attempt_code', ({ roomCode, chaserId, targetRunnerId, catchCode }, cb) => {
        const res = matchService.attemptCatchWithCode(roomCode, chaserId, targetRunnerId, catchCode);
        if (cb) cb(res);
      });

      socket.on('catch:respond', ({ attemptId, runnerId, response }, cb) => {
        const res = matchService.respondCatch(attemptId, runnerId, response);
        if (cb) cb(res);
      });

      socket.on('match:safety_pause', ({ roomCode, initiatorId, reason }, cb) => {
        const res = matchService.safetyPause(roomCode, initiatorId, reason);
        if (cb) cb(res);
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  afterAll(() => {
    hostSocket?.disconnect();
    runnerSocket?.disconnect();
    chaserSocket?.disconnect();
    ioServer?.close();
    server?.close();
  });

  it('orchestrates room creation and sequential multi-player socket joining', async () => {
    const initialRoom = roomService.createRoom('host_user', 'sock_host', 'HostAlpha');
    roomCode = initialRoom.roomCode;
    expect(roomCode).toBeDefined();

    // 1. Connect Host
    hostSocket = Client(`http://localhost:${port}`);
    await new Promise<void>((resolve) => {
      hostSocket.on('connect', () => {
        hostSocket.emit(
          'room:join',
          { roomCode, playerId: 'host_user', nickname: 'HostAlpha' },
          () => resolve()
        );
      });
    });

    // 2. Connect Runner
    runnerSocket = Client(`http://localhost:${port}`);
    await new Promise<void>((resolve) => {
      runnerSocket.on('connect', () => {
        runnerSocket.emit(
          'room:join',
          { roomCode, playerId: 'runner_user', nickname: 'SpeedyRunner' },
          () => resolve()
        );
      });
    });

    // 3. Connect Chaser
    chaserSocket = Client(`http://localhost:${port}`);
    await new Promise<void>((resolve) => {
      chaserSocket.on('connect', () => {
        chaserSocket.emit(
          'room:join',
          { roomCode, playerId: 'chaser_user', nickname: 'HunterBeta' },
          () => resolve()
        );
      });
    });

    // Set roles with acknowledgement callbacks
    await new Promise<void>((resolve, reject) => {
      hostSocket.emit(
        'player:set_role',
        { roomCode, requesterId: 'host_user', targetPlayerId: 'runner_user', role: 'RUNNER' },
        (res: any) => (res.success ? resolve() : reject(res.error))
      );
    });

    await new Promise<void>((resolve, reject) => {
      hostSocket.emit(
        'player:set_role',
        { roomCode, requesterId: 'host_user', targetPlayerId: 'chaser_user', role: 'CHASER' },
        (res: any) => (res.success ? resolve() : reject(res.error))
      );
    });

    const activeRoom = roomService.getRoom(roomCode)!;
    expect(activeRoom.members['runner_user'].team).toBe('RUNNERS');
    expect(activeRoom.members['chaser_user'].team).toBe('CHASERS');
  });

  it('validates catch attempt when chaser and runner are in proximity and handles confirmation', async () => {
    const activeRoom = roomService.getRoom(roomCode)!;
    activeRoom.state = 'ACTIVE';

    const runnerLocation = {
      latitude: 51.5000,
      longitude: -0.1200,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: Date.now(),
    };

    const chaserLocation = {
      latitude: 51.5001,
      longitude: -0.1200,
      accuracy: 5,
      heading: null,
      speed: null,
      timestamp: Date.now(),
    };

    runnerSocket.emit('location:update', {
      roomCode,
      playerId: 'runner_user',
      location: runnerLocation,
    });

    chaserSocket.emit('location:update', {
      roomCode,
      playerId: 'chaser_user',
      location: chaserLocation,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Listen for catch:pending on runner
    const catchPendingPromise = new Promise<any>((resolve) => {
      runnerSocket.once('catch:pending', (attempt) => {
        resolve(attempt);
      });
    });

    chaserSocket.emit('catch:attempt', {
      roomCode,
      chaserId: 'chaser_user',
      targetRunnerId: 'runner_user',
    });

    const attempt = await catchPendingPromise;
    expect(attempt.status).toBe('PENDING');
    expect(attempt.runnerId).toBe('runner_user');

    // Runner confirms catch
    const catchResolvedPromise = new Promise<any>((resolve) => {
      hostSocket.once('catch:resolved', (result) => {
        resolve(result);
      });
    });

    runnerSocket.emit('catch:respond', {
      attemptId: attempt.id,
      runnerId: 'runner_user',
      response: 'CONFIRM',
    });

    const resolution = await catchResolvedPromise;
    expect(resolution.status).toBe('CAUGHT');
    expect(activeRoom.members['runner_user'].isCaught).toBe(true);
  });

  it('validates dynamic 4-digit catch code verification flow', async () => {
    const activeRoom = roomService.getRoom(roomCode)!;
    activeRoom.state = 'ACTIVE';
    // Reset runner caught state and generate code
    activeRoom.members['runner_user'].isCaught = false;
    activeRoom.members['runner_user'].catchCode = '7429';

    // 1. Wrong code test
    const wrongCodeRes = await new Promise<any>((resolve) => {
      chaserSocket.emit(
        'catch:attempt_code',
        { roomCode, chaserId: 'chaser_user', targetRunnerId: 'runner_user', catchCode: '0000' },
        (res: any) => resolve(res)
      );
    });
    expect(wrongCodeRes.success).toBe(false);
    expect(wrongCodeRes.error).toContain('Incorrect Catch Code');

    // 2. Correct code test
    const correctCodeRes = await new Promise<any>((resolve) => {
      chaserSocket.emit(
        'catch:attempt_code',
        { roomCode, chaserId: 'chaser_user', targetRunnerId: 'runner_user', catchCode: '7429' },
        (res: any) => resolve(res)
      );
    });
    expect(correctCodeRes.success).toBe(true);
    expect(correctCodeRes.attempt.verificationType).toBe('CODE_VERIFIED');
    expect(activeRoom.members['runner_user'].isCaught).toBe(true);
  });

  it('triggers emergency safety pause and alerts all connected clients', async () => {
    const safetyAlertPromise = new Promise<any>((resolve) => {
      runnerSocket.once('match:alert', (alert) => {
        if (alert.type === 'SAFETY_PAUSE') {
          resolve(alert);
        }
      });
    });

    hostSocket.emit('match:safety_pause', {
      roomCode,
      initiatorId: 'host_user',
      reason: 'Pedestrian hazard ahead',
    });

    const alert = await safetyAlertPromise;
    expect(alert.type).toBe('SAFETY_PAUSE');
    expect(alert.title).toContain('SAFETY PAUSE');
  });
});
