import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
export class RadioService {
    io;
    roomService;
    uploadDir;
    transmissions = new Map();
    constructor(io, roomService, uploadDir) {
        this.io = io;
        this.roomService = roomService;
        this.uploadDir = uploadDir;
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
    }
    transmitAudio(roomCode, senderId, filename, durationMs) {
        const room = this.roomService.getRoom(roomCode);
        if (!room)
            return { success: false, error: 'Room not found' };
        const sender = room.members[senderId];
        if (!sender)
            return { success: false, error: 'Sender not in room' };
        if (!room.config.radioEnabled) {
            return { success: false, error: 'Team radio is disabled for this match' };
        }
        if (sender.team === 'NONE') {
            return { success: false, error: 'Spectators cannot broadcast radio' };
        }
        const transmission = {
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
            if (member.id === sender.id)
                continue; // Sender already knows they sent it
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
    cleanupAudio(filename) {
        const filePath = path.join(this.uploadDir, filename);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            }
            catch (err) {
                console.error('Failed to purge ephemeral audio file:', err);
            }
        }
    }
}
