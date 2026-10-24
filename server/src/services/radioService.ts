import fs from 'fs';
import path from 'path';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RadioTransmission } from '../types/game.js';
import { RoomService } from './roomService.js';

export class RadioService {
  private io: Server;
  private roomService: RoomService;
  private uploadDir: string;
  private transmissions: Map<string, RadioTransmission> = new Map();

  constructor(io: Server, roomService: RoomService, uploadDir: string) {
    this.io = io;
    this.roomService = roomService;
    this.uploadDir = uploadDir;

    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  public transmitAudio(
    roomCode: string,
    senderId: string,
    filename: string,
    durationMs: number
  ): { success: boolean; transmission?: RadioTransmission; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const sender = room.members[senderId];
    if (!sender) return { success: false, error: 'Sender not in room' };

    if (!room.config.radioEnabled) {
      return { success: false, error: 'Team radio is disabled for this match' };
    }

    if (sender.team === 'NONE') {
      return { success: false, error: 'Spectators cannot broadcast radio' };
    }

    const transmission: RadioTransmission = {
      id: uuidv4(),
      senderId: sender.id,
      senderNickname: sender.nickname,
      team: sender.team,
      audioUrl: `/api/radio/stream/${filename}`,
      durationMs,
      timestamp: Date.now(),
    };

    this.transmissions.set(transmission.id, transmission);

    // Broadcast only to teammates and referees
    for (const member of Object.values(room.members)) {
      if (member.id === sender.id) continue; // Sender already knows they sent it

      if (member.team === sender.team || member.role === 'REFEREE') {
        this.io.to(member.socketId).emit('radio:incoming', transmission);
      }
    }

    // Schedule automatic cleanup after 10 minutes
    setTimeout(() => {
      this.cleanupAudio(filename);
    }, 10 * 60 * 1000);

    return { success: true, transmission };
  }

  private cleanupAudio(filename: string): void {
    const filePath = path.join(this.uploadDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Failed to purge ephemeral audio file:', err);
      }
    }
  }
}
