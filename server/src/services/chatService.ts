import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { ChatMessage, ChatRecipientType, RoomState } from '../types/game.js';
import { RoomService } from './roomService.js';

export class ChatService {
  private io: Server;
  private roomService: RoomService;
  // Separate message histories per conversation: `${roomCode}:${conversationId}`
  private conversationMessages: Map<string, ChatMessage[]> = new Map();
  private rateLimits: Map<string, { count: number; windowStart: number }> = new Map();

  constructor(io: Server, roomService: RoomService) {
    this.io = io;
    this.roomService = roomService;
  }

  /**
   * Helper to resolve the authoritative conversationId from channelId & sender.
   */
  public resolveConversationId(
    channelOrType: string,
    senderTeam: string,
    senderId: string,
    recipientId?: string
  ): { conversationId: string; channelId: string; recipientType: ChatRecipientType } | null {
    const upper = channelOrType.toUpperCase();

    if (upper === 'PUBLIC' || upper === 'ALL') {
      return { conversationId: 'PUBLIC', channelId: 'PUBLIC', recipientType: 'ALL' };
    }

    if (upper === 'SQUAD' || upper === 'TEAM') {
      if (senderTeam === 'RUNNERS') {
        return { conversationId: 'SQUAD:RUNNERS', channelId: 'SQUAD', recipientType: 'TEAM' };
      }
      if (senderTeam === 'CHASERS') {
        return { conversationId: 'SQUAD:CHASERS', channelId: 'SQUAD', recipientType: 'TEAM' };
      }
      return null;
    }

    if (upper === 'RUNNERS') {
      return { conversationId: 'SQUAD:RUNNERS', channelId: 'RUNNERS', recipientType: 'TEAM' };
    }

    if (upper === 'CHASERS') {
      return { conversationId: 'SQUAD:CHASERS', channelId: 'CHASERS', recipientType: 'TEAM' };
    }

    if (upper === 'DIRECT' || upper.startsWith('DM:')) {
      if (!recipientId) return null;
      const sortedPair = [senderId, recipientId].sort().join(':');
      return { conversationId: `DM:${sortedPair}`, channelId: `DM:${recipientId}`, recipientType: 'DIRECT' };
    }

    return null;
  }

  /**
   * Send a validated, sanitized chat message respecting role & recipient rules.
   */
  public sendMessage(
    roomCode: string,
    senderId: string,
    channelOrRecipientType: string,
    text: string,
    recipientId?: string
  ): { success: boolean; message?: ChatMessage; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const sender = room.members[senderId];
    if (!sender) return { success: false, error: 'Sender not in room' };

    // Rate limiting: max 5 messages per 3 seconds
    const now = Date.now();
    const rateKey = `${roomCode}:${senderId}`;
    const rateInfo = this.rateLimits.get(rateKey) || { count: 0, windowStart: now };
    if (now - rateInfo.windowStart > 3000) {
      rateInfo.count = 1;
      rateInfo.windowStart = now;
    } else {
      rateInfo.count += 1;
      if (rateInfo.count > 5) {
        return { success: false, error: 'Slow down! Rate limit exceeded.' };
      }
    }
    this.rateLimits.set(rateKey, rateInfo);

    // Sanitize message: strip HTML tags, trim, enforce max length (300 chars)
    const sanitizedText = text
      .replace(/<[^>]*>?/gm, '')
      .replace(/[\r\n]+/g, ' ')
      .trim();

    if (!sanitizedText || sanitizedText.length === 0) {
      return { success: false, error: 'Message cannot be empty' };
    }
    if (sanitizedText.length > 300) {
      return { success: false, error: 'Message exceeds maximum 300 characters' };
    }

    const resolved = this.resolveConversationId(
      channelOrRecipientType,
      sender.team,
      senderId,
      recipientId
    );

    if (!resolved) {
      if (channelOrRecipientType.toUpperCase() === 'SQUAD' && sender.team === 'NONE') {
        return { success: false, error: 'Unassigned players cannot send team messages' };
      }
      return { success: false, error: 'Invalid or unauthorized chat channel' };
    }

    const { conversationId, channelId, recipientType } = resolved;

    // Validate recipient existence for DIRECT
    if (recipientType === 'DIRECT') {
      if (!recipientId || !room.members[recipientId]) {
        return { success: false, error: 'Direct message recipient not found' };
      }
    }

    // Role/team enforcement for Squad channels
    if (conversationId === 'SQUAD:RUNNERS' && sender.team !== 'RUNNERS' && sender.role !== 'REFEREE') {
      return { success: false, error: 'Only Runners can communicate on this channel' };
    }
    if (conversationId === 'SQUAD:CHASERS' && sender.team !== 'CHASERS' && sender.role !== 'REFEREE') {
      return { success: false, error: 'Only Chasers can communicate on this channel' };
    }

    const message: ChatMessage = {
      id: uuidv4(),
      roomCode: room.roomCode,
      channelId,
      conversationId,
      senderId,
      senderNickname: sender.nickname,
      senderTeam: sender.team,
      recipientType,
      recipientId: recipientType === 'DIRECT' ? recipientId : undefined,
      text: sanitizedText,
      timestamp: now,
    };

    // Store in separate conversation history (max 100 per conversation)
    const convKey = `${room.roomCode}:${conversationId}`;
    const history = this.conversationMessages.get(convKey) || [];
    history.push(message);
    if (history.length > 100) {
      history.shift();
    }
    this.conversationMessages.set(convKey, history);

    // Broadcast only to authorized recipients
    if (conversationId === 'PUBLIC') {
      this.io.to(room.roomCode).emit('chat:message', message);
    } else if (conversationId === 'SQUAD:RUNNERS') {
      for (const m of Object.values(room.members)) {
        if (m.team === 'RUNNERS' || m.role === 'REFEREE') {
          this.io.to(m.socketId).emit('chat:message', message);
        }
      }
    } else if (conversationId === 'SQUAD:CHASERS') {
      for (const m of Object.values(room.members)) {
        if (m.team === 'CHASERS' || m.role === 'REFEREE') {
          this.io.to(m.socketId).emit('chat:message', message);
        }
      }
    } else if (recipientType === 'DIRECT') {
      const recipient = room.members[recipientId!];
      if (recipient) {
        this.io.to(recipient.socketId).emit('chat:message', message);
      }
      this.io.to(sender.socketId).emit('chat:message', message);
    }

    return { success: true, message };
  }

  /**
   * Returns conversation history for an explicit channel, verifying viewer eligibility.
   */
  public getHistoryForChannel(
    room: RoomState,
    channelId: string,
    viewerId: string,
    targetDmId?: string
  ): ChatMessage[] {
    const viewer = room.members[viewerId];
    if (!viewer) return [];

    let targetConv = channelId.toUpperCase();
    if (targetConv === 'PUBLIC' || targetConv === 'ALL') {
      targetConv = 'PUBLIC';
    } else if (targetConv === 'SQUAD' || targetConv === 'TEAM') {
      if (viewer.team === 'NONE') return [];
      targetConv = `SQUAD:${viewer.team}`;
    } else if (targetConv === 'RUNNERS') {
      if (viewer.team !== 'RUNNERS' && viewer.role !== 'REFEREE') return [];
      targetConv = 'SQUAD:RUNNERS';
    } else if (targetConv === 'CHASERS') {
      if (viewer.team !== 'CHASERS' && viewer.role !== 'REFEREE') return [];
      targetConv = 'SQUAD:CHASERS';
    } else if (targetConv === 'DIRECT' || targetConv.startsWith('DM:')) {
      const dmTarget = targetDmId || (channelId.startsWith('DM:') ? channelId.slice(3) : undefined);
      if (!dmTarget) return [];
      targetConv = `DM:${[viewerId, dmTarget].sort().join(':')}`;
    }

    const convKey = `${room.roomCode}:${targetConv}`;
    return this.conversationMessages.get(convKey) || [];
  }

  /**
   * Returns aggregated chat history visible to a specific player across all authorized channels.
   */
  public getHistoryForPlayer(room: RoomState, viewerId: string): ChatMessage[] {
    const viewer = room.members[viewerId];
    if (!viewer) return [];

    const result: ChatMessage[] = [];

    // 1. PUBLIC
    const pubKey = `${room.roomCode}:PUBLIC`;
    result.push(...(this.conversationMessages.get(pubKey) || []));

    // 2. SQUAD
    if (viewer.team === 'RUNNERS' || viewer.role === 'REFEREE') {
      result.push(...(this.conversationMessages.get(`${room.roomCode}:SQUAD:RUNNERS`) || []));
    }
    if (viewer.team === 'CHASERS' || viewer.role === 'REFEREE') {
      result.push(...(this.conversationMessages.get(`${room.roomCode}:SQUAD:CHASERS`) || []));
    }

    // 3. DIRECT
    for (const [key, msgs] of this.conversationMessages.entries()) {
      if (key.startsWith(`${room.roomCode}:DM:`) && key.includes(viewerId)) {
        result.push(...msgs);
      }
    }

    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
  }

  public clearRoom(roomCode: string): void {
    for (const key of this.conversationMessages.keys()) {
      if (key.startsWith(`${roomCode}:`)) {
        this.conversationMessages.delete(key);
      }
    }
  }
}
