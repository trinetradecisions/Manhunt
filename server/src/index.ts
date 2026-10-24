import express from 'express';
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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const AUDIO_UPLOAD_DIR = path.join(__dirname, '../uploads/audio');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // Allow local development and mobile network IP testing
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// Initialize core services
const roomService = new RoomService();
const matchService = new MatchService(io, roomService);
const radioService = new RadioService(io, roomService, AUDIO_UPLOAD_DIR);

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
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// REST: Create Room
app.post('/api/room/create', (req, res) => {
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
app.get('/api/room/:code', (req, res) => {
  const room = roomService.getRoom(req.params.code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const viewerId = req.query.viewerId as string;
  res.json(roomService.getSanitizedRoomView(room, viewerId || ''));
});

// REST: Upload Radio Audio
app.post('/api/radio/upload', upload.single('audio'), (req, res) => {
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
    // Delete file if transmission failed
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, transmission: result.transmission });
});

// REST: Stream Audio File
app.get('/api/radio/stream/:filename', (req, res) => {
  const filePath = path.join(AUDIO_UPLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Audio file expired or not found' });
  }
  res.sendFile(filePath);
});

// Socket.IO Real-Time Dispatcher
io.on('connection', (socket) => {
  // Join Room
  socket.on('room:join', ({ roomCode, playerId, nickname }) => {
    const result = roomService.joinRoom(roomCode, playerId, socket.id, nickname);
    if (!result.success || !result.room) {
      return socket.emit('error', { message: result.error || 'Failed to join' });
    }

    socket.join(roomCode);
    matchService.broadcastRoomState(result.room);
  });

  // Update Config
  socket.on('room:update_config', ({ roomCode, requesterId, config }) => {
    const result = roomService.updateConfig(roomCode, requesterId, config);
    if (result.success && result.room) {
      matchService.broadcastRoomState(result.room);
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Assign Player Role
  socket.on(
    'player:set_role',
    ({ roomCode, requesterId, targetPlayerId, role }) => {
      const result = roomService.setPlayerRole(
        roomCode,
        requesterId,
        targetPlayerId,
        role
      );
      if (result.success && result.room) {
        matchService.broadcastRoomState(result.room);
      } else {
        socket.emit('error', { message: result.error });
      }
    }
  );

  // Player Readiness
  socket.on('player:set_ready', ({ roomCode, playerId, ready, gpsStatus }) => {
    const result = roomService.setPlayerReady(
      roomCode,
      playerId,
      ready,
      gpsStatus
    );
    if (result.success && result.room) {
      matchService.broadcastRoomState(result.room);
    }
  });

  // Match Start
  socket.on('match:start', ({ roomCode, initiatorId }) => {
    const result = matchService.startMatch(roomCode, initiatorId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  // Location Updates
  socket.on('location:update', ({ roomCode, playerId, location }) => {
    matchService.updatePlayerLocation(roomCode, playerId, location);
  });

  // Catch Attempt
  socket.on('catch:attempt', ({ roomCode, chaserId, targetRunnerId }) => {
    const result = matchService.attemptCatch(
      roomCode,
      chaserId,
      targetRunnerId
    );
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  // Catch Response
  socket.on('catch:respond', ({ attemptId, runnerId, response }) => {
    const result = matchService.respondCatch(attemptId, runnerId, response);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  // Catch Override
  socket.on('catch:override', ({ roomCode, actorId, attemptId, decision }) => {
    const result = matchService.overrideCatch(
      roomCode,
      actorId,
      attemptId,
      decision
    );
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  // Safety Pause
  socket.on('match:safety_pause', ({ roomCode, initiatorId, reason }) => {
    const result = matchService.safetyPause(roomCode, initiatorId, reason);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });

  // Resume Match
  socket.on('match:resume', ({ roomCode, initiatorId }) => {
    const result = matchService.resumeMatch(roomCode, initiatorId);
    if (!result.success) {
      socket.emit('error', { message: result.error });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Manhunt Server] Running on http://localhost:${PORT}`);
});
