import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import { io as Client, Socket } from 'socket.io-client';
import { RoomService } from '../src/services/roomService.js';
import { MatchService } from '../src/services/matchService.js';
import { VoiceService } from '../src/services/voiceService.js';

describe('Voice Signaling & Channel Security Test Suite', () => {
  let server: http.Server;
  let ioServer: Server;
  let port: number;
  let socketA: Socket;
  let socketB: Socket;
  let socketC: Socket;

  const roomService = new RoomService();
  let voiceService: VoiceService;
  let matchService: MatchService;
  let roomCode: string;

  beforeAll(async () => {
    const app = express();
    server = http.createServer(app);
    ioServer = new Server(server, { cors: { origin: '*' } });

    matchService = new MatchService(ioServer, roomService);
    voiceService = new VoiceService(ioServer, roomService);

    ioServer.on('connection', (socket) => {
      socket.on('room:create', ({ hostId, nickname }, cb) => {
        const room = roomService.createRoom(hostId, socket.id, nickname);
        socket.data.playerId = hostId;
        socket.data.roomCode = room.roomCode;
        socket.join(room.roomCode);
        if (cb) cb({ success: true, room });
      });

      socket.on('room:join', ({ roomCode, playerId, nickname }, cb) => {
        const res = roomService.joinRoom(roomCode, playerId, socket.id, nickname);
        if (res.success && res.room) {
          socket.data.playerId = playerId;
          socket.data.roomCode = roomCode;
          socket.join(roomCode);
          matchService.broadcastRoomState(res.room);
          if (cb) cb({ success: true, room: res.room });
        } else {
          if (cb) cb({ success: false, error: res.error });
        }
      });

      socket.on('team:assign', ({ roomCode, requesterId, targetPlayerId, team }, cb) => {
        const res = roomService.assignPlayerTeam(roomCode, requesterId, targetPlayerId, team);
        if (res.success && res.room) {
          matchService.broadcastRoomState(res.room);
          if (cb) cb({ success: true, room: res.room });
        } else {
          if (cb) cb({ success: false, error: res.error });
        }
      });

      socket.on('voice:join', ({ roomCode, playerId, channelId }, cb) => {
        socket.data.playerId = playerId;
        socket.data.roomCode = roomCode;
        const result = voiceService.joinVoiceChannel(roomCode, playerId, channelId);
        if (cb) cb(result);
      });

      socket.on('voice:leave', ({ roomCode, playerId }, cb) => {
        voiceService.leaveVoiceChannel(roomCode, playerId);
        if (cb) cb({ success: true });
      });

      socket.on('voice:signal', ({ roomCode, senderId, targetPlayerId, channelId, signal }, cb) => {
        const result = voiceService.relaySignal(roomCode, senderId, targetPlayerId, channelId, signal);
        if (cb) cb(result);
      });

      socket.on('voice:speaking', ({ roomCode, playerId, channelId, isSpeaking }) => {
        voiceService.setSpeaking(roomCode, playerId, channelId, isSpeaking);
      });

      socket.on('disconnect', () => {
        const pId = socket.data?.playerId;
        const rCode = socket.data?.roomCode;
        if (rCode && pId) {
          voiceService.leaveVoiceChannel(rCode, pId);
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    socketA = Client(`http://localhost:${port}`);
    socketB = Client(`http://localhost:${port}`);
    socketC = Client(`http://localhost:${port}`);

    await Promise.all([
      new Promise<void>((res) => socketA.on('connect', () => res())),
      new Promise<void>((res) => socketB.on('connect', () => res())),
      new Promise<void>((res) => socketC.on('connect', () => res())),
    ]);
  });

  afterAll(async () => {
    socketA.disconnect();
    socketB.disconnect();
    socketC.disconnect();
    ioServer.close();
    server.close();
  });

  it('1. Initializes room and joins all 3 players', async () => {
    // Player A creates room
    const createRes: any = await new Promise((res) => {
      socketA.emit('room:create', { hostId: 'playerA', nickname: 'Alice' }, res);
    });
    expect(createRes.success).toBe(true);
    roomCode = createRes.room.roomCode;

    // Player B joins room
    const joinB: any = await new Promise((res) => {
      socketB.emit('room:join', { roomCode, playerId: 'playerB', nickname: 'Bob' }, res);
    });
    expect(joinB.success).toBe(true);

    // Player C joins room
    const joinC: any = await new Promise((res) => {
      socketC.emit('room:join', { roomCode, playerId: 'playerC', nickname: 'Charlie' }, res);
    });
    expect(joinC.success).toBe(true);
  });

  it('2. Public Radio allows all room members to discover each other', async () => {
    // Player A joins PUBLIC
    const joinResA: any = await new Promise((res) => {
      socketA.emit('voice:join', { roomCode, playerId: 'playerA', channelId: 'PUBLIC' }, res);
    });
    expect(joinResA.success).toBe(true);
    // Initially Player A is alone in the channel
    expect(joinResA.participants).toHaveLength(0);

    // Player B joins PUBLIC - should discover Player A, and Player A should receive voice:user_joined
    const peerJoinedPromise = new Promise<any>((resolve) => {
      socketA.once('voice:user_joined', (data) => resolve(data));
    });

    const joinResB: any = await new Promise((res) => {
      socketB.emit('voice:join', { roomCode, playerId: 'playerB', channelId: 'PUBLIC' }, res);
    });

    expect(joinResB.success).toBe(true);
    expect(joinResB.participants).toHaveLength(1);
    expect(joinResB.participants[0].playerId).toBe('playerA');

    const peerJoined = await peerJoinedPromise;
    expect(peerJoined.playerId).toBe('playerB');
  });

  it('3. WebRTC signaling forwards correctly between authorized peers in PUBLIC radio', async () => {
    const signalPromise = new Promise<any>((resolve) => {
      socketB.once('voice:signal', (data) => resolve(data));
    });

    // Player A sends WebRTC offer signal to Player B
    socketA.emit('voice:signal', {
      roomCode,
      senderId: 'playerA',
      targetPlayerId: 'playerB',
      channelId: 'PUBLIC',
      signal: { description: { type: 'offer', sdp: 'fake-sdp-offer' } },
    });

    const receivedSignal = await signalPromise;
    expect(receivedSignal.senderId).toBe('playerA');
    expect(receivedSignal.signal.description.type).toBe('offer');
    expect(receivedSignal.signal.description.sdp).toBe('fake-sdp-offer');
  });

  it('4. Speaking state broadcasts to channel peers', async () => {
    const speakingPromise = new Promise<any>((resolve) => {
      socketB.once('voice:speaking_changed', (data) => resolve(data));
    });

    socketA.emit('voice:speaking', {
      roomCode,
      playerId: 'playerA',
      channelId: 'PUBLIC',
      isSpeaking: true,
    });

    const received = await speakingPromise;
    expect(received.playerId).toBe('playerA');
    expect(received.isSpeaking).toBe(true);
  });

  it('5. Squad Radio strictly isolates Runners from Chasers', async () => {
    // Assign Player A to RUNNERS, Player B to CHASERS, Player C to RUNNERS
    await new Promise((res) => {
      socketA.emit('team:assign', { roomCode, requesterId: 'playerA', targetPlayerId: 'playerA', team: 'RUNNERS' }, res);
    });
    await new Promise((res) => {
      socketA.emit('team:assign', { roomCode, requesterId: 'playerA', targetPlayerId: 'playerB', team: 'CHASERS' }, res);
    });
    await new Promise((res) => {
      socketA.emit('team:assign', { roomCode, requesterId: 'playerA', targetPlayerId: 'playerC', team: 'RUNNERS' }, res);
    });

    // Player A switches to SQUAD
    const joinResA: any = await new Promise((res) => {
      socketA.emit('voice:join', { roomCode, playerId: 'playerA', channelId: 'SQUAD' }, res);
    });
    expect(joinResA.success).toBe(true);

    // Player B (Chaser) switches to SQUAD
    const joinResB: any = await new Promise((res) => {
      socketB.emit('voice:join', { roomCode, playerId: 'playerB', channelId: 'SQUAD' }, res);
    });
    expect(joinResB.success).toBe(true);

    // Cross-team isolation: Player B is a CHASER, Player A is a RUNNER.
    // Neither should see the other in peers list!
    expect(joinResB.participants).toHaveLength(0);

    // If Player B tries to send a signal to Player A on SQUAD, it must be rejected by server
    const rejectRes: any = await new Promise((res) => {
      socketB.emit('voice:signal', {
        roomCode,
        senderId: 'playerB',
        targetPlayerId: 'playerA',
        channelId: 'SQUAD',
        signal: { description: { type: 'offer', sdp: 'unauthorized-squad-spy' } },
      }, res);
    });
    expect(rejectRes.success).toBe(false);
    expect(rejectRes.error).toContain('Cross-squad');

    // Now Player C (Runner teammate) joins SQUAD
    const peerJoinedRunnerPromise = new Promise<any>((resolve) => {
      socketA.once('voice:user_joined', (data) => resolve(data));
    });

    const joinResC: any = await new Promise((res) => {
      socketC.emit('voice:join', { roomCode, playerId: 'playerC', channelId: 'SQUAD' }, res);
    });

    expect(joinResC.success).toBe(true);
    // Player C should see Player A (fellow Runner), but NOT Player B (Chaser)
    expect(joinResC.participants).toHaveLength(1);
    expect(joinResC.participants[0].playerId).toBe('playerA');

    const runnerJoined = await peerJoinedRunnerPromise;
    expect(runnerJoined.playerId).toBe('playerC');
  });

  it('6. Disconnect cleanly removes player and notifies peers', async () => {
    const peerLeftPromise = new Promise<any>((resolve) => {
      socketA.once('voice:user_left', (data) => resolve(data));
    });

    // Player C leaves voice channel
    socketC.emit('voice:leave', { roomCode, playerId: 'playerC' });

    const peerLeft = await peerLeftPromise;
    expect(peerLeft.playerId).toBe('playerC');
  });
});
