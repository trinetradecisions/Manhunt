import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { RoomService } from './services/roomService.js';
import { MatchService } from './services/matchService.js';
import { RadioService } from './services/radioService.js';
import { ChatService } from './services/chatService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { VoiceService } from './services/voiceService.js';
import { PlayerStatsService } from './services/playerStatsService.js';

const PORT = process.env.PORT || 4000;
const AUDIO_UPLOAD_DIR = path.join(__dirname, '../uploads/audio');

// Ensure upload directory exists
if (!fs.existsSync(AUDIO_UPLOAD_DIR)) {
  fs.mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // Allow local development and mobile network IP testing
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

app.use(cors());
app.use(express.json());

// Initialize core services
const roomService = new RoomService();
const playerStatsService = new PlayerStatsService();
const matchService = new MatchService(io, roomService, playerStatsService);
const radioService = new RadioService(io, roomService, AUDIO_UPLOAD_DIR);
const chatService = new ChatService(io, roomService);
const voiceService = new VoiceService(io, roomService);
matchService.setVoiceService(voiceService);

// Multer storage for voice transmissions
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AUDIO_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `voice_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB limit
});

// Health check endpoint
app.get(['/health', '/api/health'], (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// REST: Create Room
app.post('/api/room/create', (req: Request, res: Response) => {
  const { hostPlayerId, nickname } = req.body;
  if (!hostPlayerId) {
    return res.status(400).json({ error: 'hostPlayerId required' });
  }

  const room = roomService.createRoom(
    hostPlayerId,
    '',
    nickname || 'Host'
  );
  res.json({ success: true, room });
});

// REST: Get Room Info
app.get('/api/room/:code', (req: Request, res: Response) => {
  const room = roomService.getRoom(req.params.code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const viewerId = req.query.viewerId as string;
  res.json(roomService.getSanitizedRoomView(room, viewerId || ''));
});

// REST: Get Player Statistics Dossier
app.get('/api/player/:id/stats', (req: Request, res: Response) => {
  const stats = playerStatsService.getOrCreateStats(req.params.id);
  res.json({ success: true, stats });
});

// REST: Upload Radio Audio
app.post('/api/radio/upload', upload.single('audio'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const { roomCode, senderId, durationMs } = req.body;
  const result = radioService.transmitAudio(
    roomCode,
    senderId,
    req.file.filename,
    parseInt(durationMs, 10) || 5000
  );

  if (!result.success) {
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, transmission: result.transmission });
});

// REST: Stream Audio File
app.get('/api/radio/stream/:filename', (req: Request, res: Response) => {
  const filePath = path.join(AUDIO_UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Audio file expired or not found' });
  }
  res.sendFile(filePath);
});

// Socket.IO Real-Time Dispatcher
io.on('connection', (socket) => {
  // Create Room via Socket
  socket.on('room:create', ({ hostPlayerId, nickname }, callback) => {
    if (!hostPlayerId) {
      if (typeof callback === 'function') callback({ success: false, error: 'hostPlayerId required' });
      return;
    }
    const room = roomService.createRoom(hostPlayerId, socket.id, nickname || 'Host');
    socket.data.playerId = hostPlayerId;
    socket.data.roomCode = room.roomCode;
    socket.join(room.roomCode);
    if (typeof callback === 'function') callback({ success: true, room });
  });

  // Join Room
  socket.on('room:join', ({ roomCode, playerId, nickname }, callback) => {
    socket.data.playerId = playerId;
    socket.data.roomCode = roomCode;
    const result = roomService.joinRoom(roomCode, playerId, socket.id, nickname);
    if (!result.success || !result.room) {
      socket.emit('error', { message: result.error || 'Failed to join' });
      if (typeof callback === 'function') callback({ success: false, error: result.error });
      return;
    }

    socket.join(roomCode);
    matchService.broadcastRoomState(result.room);

    // Sync chat history
    const chatHistory = chatService.getHistoryForPlayer(result.room, playerId);
    socket.emit('chat:history', chatHistory);

    // If active hunt and viewer is chaser, sync latest scheduled snapshot
    if (result.room.state === 'ACTIVE' && result.room.match?.lastScheduledSnapshot) {
      const viewer = result.room.members[playerId];
      if (viewer && (viewer.team === 'CHASERS' || viewer.role === 'REFEREE')) {
        socket.emit('location:scheduled_snapshot', result.room.match.lastScheduledSnapshot);
      }
    }

    if (typeof callback === 'function') {
      const sanitized = roomService.getSanitizedRoomView(result.room, playerId);
      callback({ success: true, room: sanitized });
    }
  });

  // Leave Room (Authoritative removal, voice cleanup, and deterministic host migration)
  socket.on('room:leave', ({ roomCode, playerId }, callback) => {
    voiceService.leaveVoiceChannel(roomCode, playerId);
    playerStatsService.clearPlayerTracking(playerId);
    socket.leave(roomCode);

    const result = roomService.leaveRoom(roomCode, playerId);
    if (result.success) {
      if (result.roomClosed) {
        matchService.clearRoomTimers(roomCode);
      } else if (result.room) {
        matchService.broadcastRoomState(result.room);
        const newHostNickname = result.newHostId ? result.room.members[result.newHostId]?.nickname : undefined;
        io.to(roomCode).emit('match:alert', {
          type: 'INFO',
          title: 'Operative Departed',
          message: newHostNickname
            ? `Host departed. New Commander elected: ${newHostNickname}.`
            : 'An operative departed the lobby.',
          timestamp: Date.now(),
        });
      }
      if (typeof callback === 'function') callback({ success: true });
    } else {
      if (typeof callback === 'function') callback({ success: false, error: result.error });
    }
  });

  // Query Player Tactical Dossier & Statistics
  socket.on('player:get_stats', ({ playerId }, callback) => {
    const stats = playerStatsService.getOrCreateStats(playerId);
    if (typeof callback === 'function') callback({ success: true, stats });
  });

  // Update Config
  socket.on('room:update_config', ({ roomCode, requesterId, config }, callback) => {
    const result = roomService.updateConfig(roomCode, requesterId, config);
    if (result.success && result.room) {
      matchService.broadcastRoomState(result.room);
      if (typeof callback === 'function') callback({ success: true });
    } else {
      socket.emit('error', { message: result.error });
      if (typeof callback === 'function') callback({ success: false, error: result.error });
    }
  });

  // Host Updates Play Area Map Boundary
  socket.on(
    'room:update_play_zone',
    ({ roomCode, requesterId, playZone }, callback) => {
      const result = roomService.updatePlayZone(roomCode, requesterId, playZone);
      if (result.success && result.room) {
        matchService.broadcastRoomState(result.room);
        if (result.warning) {
          socket.emit('match:alert', {
            type: 'BOUNDARY_WARNING',
            title: 'Play Area Warning',
            message: result.warning,
            timestamp: Date.now(),
          });
        }
        if (typeof callback === 'function')
          callback({ success: true, room: result.room, warning: result.warning });
      } else {
        socket.emit('error', { message: result.error });
        if (typeof callback === 'function')
          callback({ success: false, error: result.error });
      }
    }
  );

  // Host Drag-and-Drop or Dropdown Team Assignment ('RUNNERS', 'CHASERS', 'NONE')
  socket.on(
    'team:assign',
    ({ roomCode, requesterId, hostPlayerId, targetPlayerId, team }, callback) => {
      const authId = requesterId || hostPlayerId;
      const result = roomService.assignPlayerTeam(
        roomCode,
        authId,
        targetPlayerId,
        team
      );
      if (result.success && result.room) {
        matchService.broadcastRoomState(result.room);
        if (typeof callback === 'function') callback({ success: true, room: result.room });
      } else {
        socket.emit('error', { message: result.error });
        if (typeof callback === 'function') callback({ success: false, error: result.error });
      }
    }
  );

  // Host-Controlled Target Chaser Count
  socket.on(
    'team:set_target_chasers',
    ({ roomCode, requesterId, hostPlayerId, targetCount }, callback) => {
      const authId = requesterId || hostPlayerId;
      const result = roomService.setTargetChaserCount(
        roomCode,
        authId,
        targetCount
      );
      if (result.success && result.room) {
        matchService.broadcastRoomState(result.room);
        if (typeof callback === 'function') callback({ success: true, room: result.room });
      } else {
        socket.emit('error', { message: result.error });
        if (typeof callback === 'function') callback({ success: false, error: result.error });
      }
    }
  );

  // Automatic Team Assignment on Server
  socket.on('team:auto_assign', ({ roomCode, requesterId, hostPlayerId }, callback) => {
    const authId = requesterId || hostPlayerId;
    const result = roomService.autoAssignTeams(roomCode, authId);
    if (result.success && result.room) {
      matchService.broadcastRoomState(result.room);
      io.to(roomCode).emit('match:alert', {
        type: 'INFO',
        title: 'Teams Auto-Assigned',
        message: `Assigned ${result.chasersCount} Chaser(s) and ${result.runnersCount} Runner(s).`,
        timestamp: Date.now(),
      });
      if (typeof callback === 'function')
        callback({
          success: true,
          chasersCount: result.chasersCount,
          runnersCount: result.runnersCount,
          room: result.room,
        });
    } else {
      socket.emit('error', { message: result.error });
      if (typeof callback === 'function') callback({ success: false, error: result.error });
    }
  });

  // Assign Player Role (Backwards-compatibility & referee mode)
  socket.on(
    'player:set_role',
    ({ roomCode, requesterId, targetPlayerId, role }, callback) => {
      const result = roomService.setPlayerRole(
        roomCode,
        requesterId,
        targetPlayerId,
        role
      );
      if (result.success && result.room) {
        matchService.broadcastRoomState(result.room);
        if (typeof callback === 'function') callback({ success: true });
      } else {
        socket.emit('error', { message: result.error });
        if (typeof callback === 'function') callback({ success: false, error: result.error });
      }
    }
  );

  // Player Readiness
  socket.on('player:set_ready', ({ roomCode, playerId, ready, gpsStatus }, callback) => {
    const result = roomService.setPlayerReady(
      roomCode,
      playerId,
      ready,
      gpsStatus
    );
    if (result.success && result.room) {
      matchService.broadcastRoomState(result.room);
      if (typeof callback === 'function') callback({ success: true });
    }
  });

  // In-Game Tactical Chat (PUBLIC, SQUAD, RUNNERS, CHASERS, DIRECT)
  socket.on(
    'chat:send',
    ({ roomCode, senderId, channelId, recipientType, text, recipientId }, callback) => {
      const targetChannel = channelId || recipientType || 'PUBLIC';
      const result = chatService.sendMessage(
        roomCode,
        senderId,
        targetChannel,
        text,
        recipientId
      );
      if (!result.success) {
        socket.emit('error', { message: result.error });
      }
      if (typeof callback === 'function') callback(result);
    }
  );

  // Get Chat History (Channel-specific or aggregated)
  socket.on('chat:get_history', ({ roomCode, viewerId, channelId, targetDmId }, callback) => {
    const room = roomService.getRoom(roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Room not found' });
      return;
    }
    if (channelId) {
      const history = chatService.getHistoryForChannel(room, channelId, viewerId, targetDmId);
      if (typeof callback === 'function') callback({ success: true, history, channelId });
    } else {
      const history = chatService.getHistoryForPlayer(room, viewerId);
      if (typeof callback === 'function') callback({ success: true, history });
    }
  });

  // WebRTC Walkie-Talkie Voice Channel: Join
  socket.on('voice:join', ({ roomCode, playerId, channelId }, callback) => {
    const result = voiceService.joinVoiceChannel(roomCode, playerId, channelId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // WebRTC Walkie-Talkie Voice Channel: Leave
  socket.on('voice:leave', ({ roomCode, playerId }, callback) => {
    voiceService.leaveVoiceChannel(roomCode, playerId);
    if (typeof callback === 'function') callback({ success: true });
  });

  // WebRTC Walkie-Talkie Voice Channel: Push-to-Talk Speaking Indicator
  socket.on('voice:speaking', ({ roomCode, playerId, channelId, isSpeaking }) => {
    voiceService.setSpeaking(roomCode, playerId, channelId, isSpeaking);
  });

  // WebRTC Walkie-Talkie Voice Channel: Peer Signaling (SDP Offer/Answer/ICE)
  socket.on(
    'voice:signal',
    ({ roomCode, senderId, targetPlayerId, channelId, signal }, callback) => {
      const result = voiceService.relaySignal(
        roomCode,
        senderId,
        targetPlayerId,
        channelId,
        signal
      );
      if (typeof callback === 'function') callback(result);
    }
  );

  // WebRTC Walkie-Talkie Voice Channel: Query Participants
  socket.on('voice:get_participants', ({ roomCode, channelId, viewerId }, callback) => {
    const participants = voiceService.getChannelParticipants(roomCode, channelId, viewerId);
    if (typeof callback === 'function') callback({ success: true, participants });
  });

  // Match Start
  socket.on('match:start', ({ roomCode, initiatorId }, callback) => {
    const result = matchService.startMatch(roomCode, initiatorId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
      if (typeof callback === 'function') callback({ success: false, error: result.error });
    } else {
      if (typeof callback === 'function') callback({ success: true });
    }
  });

  // Location Updates
  socket.on('location:update', ({ roomCode, playerId, location }) => {
    matchService.updatePlayerLocation(roomCode, playerId, location);
  });

  // Catch Attempt (Proximity Tag)
  socket.on('catch:attempt', ({ roomCode, chaserId, targetRunnerId }, callback) => {
    const result = matchService.attemptCatch(
      roomCode,
      chaserId,
      targetRunnerId
    );
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // Catch Request Code (Runner requests short-lived, single-use 4-digit PIN)
  socket.on('catch:request_code', ({ roomCode, runnerId }, callback) => {
    const result = matchService.requestCatchCode(roomCode, runnerId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // Landmark Clue Answer Submission
  socket.on('mission:answer_landmark', ({ roomCode, playerId, answer }, callback) => {
    const result = matchService.answerLandmarkClue(roomCode, playerId, answer);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // Catch Attempt with Dynamic 4-Digit Catch Code
  socket.on('catch:attempt_code', ({ roomCode, chaserId, targetRunnerId, catchCode }, callback) => {
    const result = matchService.attemptCatchWithCode(
      roomCode,
      chaserId,
      targetRunnerId,
      catchCode
    );
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // Catch Response
  socket.on('catch:respond', ({ attemptId, runnerId, response }, callback) => {
    const result = matchService.respondCatch(attemptId, runnerId, response);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // Catch Override
  socket.on('catch:override', ({ roomCode, actorId, attemptId, decision }, callback) => {
    const result = matchService.overrideCatch(
      roomCode,
      actorId,
      attemptId,
      decision
    );
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // Safety Pause
  socket.on('match:safety_pause', ({ roomCode, initiatorId, reason }, callback) => {
    const result = matchService.safetyPause(roomCode, initiatorId, reason);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // Resume Match
  socket.on('match:resume', ({ roomCode, initiatorId }, callback) => {
    const result = matchService.resumeMatch(roomCode, initiatorId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
    if (typeof callback === 'function') callback(result);
  });

  // Diagnostics Ping handler for round-trip latency measurement
  socket.on('diagnostics:ping', (_data, callback) => {
    if (typeof callback === 'function') {
      callback({ received: true, serverTimestamp: Date.now() });
    }
  });

  // Track client disconnection and clean up active voice channels
  socket.on('disconnect', (reason) => {
    const pId = socket.data?.playerId;
    const rCode = socket.data?.roomCode;
    if (pId && rCode) {
      voiceService.leaveVoiceChannel(rCode, pId);
    } else {
      const match = roomService.findRoomBySocketId(socket.id);
      if (match) {
        voiceService.leaveVoiceChannel(match.room.roomCode, match.member.id);
      }
    }
    console.log(`[Socket.IO] Client disconnected: ${socket.id} (reason: ${reason})`);
  });
});

server.listen(PORT, () => {
  console.log(`[Manhunt Server] Running on http://localhost:${PORT}`);
});
