export class VoiceService {
    io;
    roomService;
    // roomCode -> channelId -> Map<playerId, VoiceParticipant>
    roomVoiceChannels = new Map();
    constructor(io, roomService) {
        this.io = io;
        this.roomService = roomService;
    }
    getOrCreateChannel(roomCode, channelId) {
        const code = roomCode.toUpperCase();
        if (!this.roomVoiceChannels.has(code)) {
            this.roomVoiceChannels.set(code, new Map());
        }
        const roomChannels = this.roomVoiceChannels.get(code);
        if (!roomChannels.has(channelId)) {
            roomChannels.set(channelId, new Map());
        }
        return roomChannels.get(channelId);
    }
    /**
     * Helper to determine if two members are permitted to communicate in a channel.
     */
    canCommunicate(channelId, memberA, memberB) {
        if (channelId === 'PUBLIC') {
            return true;
        }
        if (channelId === 'SQUAD') {
            // Referees can hear both squads
            if (memberA.role === 'REFEREE' || memberB.role === 'REFEREE') {
                return true;
            }
            // Otherwise strictly isolated to teammates (RUNNERS <-> RUNNERS, CHASERS <-> CHASERS)
            return memberA.team !== 'NONE' && memberA.team === memberB.team;
        }
        return true;
    }
    /**
     * Joins a voice channel with strict team & room validation.
     */
    joinVoiceChannel(roomCode, playerId, channelId) {
        const code = roomCode.toUpperCase();
        const room = this.roomService.getRoom(code);
        if (!room)
            return { success: false, error: 'Room not found' };
        const member = room.members[playerId];
        if (!member)
            return { success: false, error: 'Player not in room' };
        // Squad channel requires active squad assignment
        if (channelId === 'SQUAD') {
            if (member.team === 'NONE' && member.role !== 'REFEREE') {
                return {
                    success: false,
                    error: 'Only assigned Runners or Chasers can join Squad Radio',
                };
            }
        }
        // Leave any currently active voice channel first
        this.leaveVoiceChannel(code, playerId);
        const channelMap = this.getOrCreateChannel(code, channelId);
        const participant = {
            playerId,
            nickname: member.nickname,
            team: member.team,
            isSpeaking: false,
            isMuted: false,
            channelId,
            joinedAt: Date.now(),
        };
        console.log(`[Voice] Operative ${member.nickname} (${playerId}) joined ${channelId} in room ${code}`);
        // Notify existing participants in the channel
        for (const other of channelMap.values()) {
            const otherMember = room.members[other.playerId];
            if (!otherMember || !otherMember.socketId)
                continue;
            if (!this.canCommunicate(channelId, member, otherMember)) {
                continue;
            }
            this.io.to(otherMember.socketId).emit('voice:user_joined', participant);
        }
        channelMap.set(playerId, participant);
        // Return visible existing participants to the joining client
        const visibleParticipants = [];
        for (const other of channelMap.values()) {
            if (other.playerId === playerId)
                continue;
            const otherMember = room.members[other.playerId];
            if (!otherMember)
                continue;
            if (!this.canCommunicate(channelId, member, otherMember)) {
                continue;
            }
            visibleParticipants.push(other);
        }
        return {
            success: true,
            participants: visibleParticipants,
        };
    }
    /**
     * Leaves any current voice channel in the room.
     */
    leaveVoiceChannel(roomCode, playerId) {
        const code = roomCode.toUpperCase();
        const room = this.roomService.getRoom(code);
        const roomChannels = this.roomVoiceChannels.get(code);
        if (!roomChannels)
            return;
        for (const [channelId, channelMap] of roomChannels.entries()) {
            if (channelMap.has(playerId)) {
                const participant = channelMap.get(playerId);
                channelMap.delete(playerId);
                console.log(`[Voice] Operative ${playerId} left ${channelId} in room ${code}`);
                // Broadcast user_left to remaining channel members
                if (room) {
                    const leavingMember = room.members[playerId] || {
                        team: participant.team,
                        role: 'RUNNER',
                    };
                    for (const other of channelMap.values()) {
                        const otherMember = room.members[other.playerId];
                        if (!otherMember || !otherMember.socketId)
                            continue;
                        if (!this.canCommunicate(channelId, leavingMember, otherMember)) {
                            continue;
                        }
                        this.io.to(otherMember.socketId).emit('voice:user_left', {
                            playerId,
                            channelId,
                        });
                    }
                }
            }
        }
    }
    /**
     * Updates speaking status (Push-to-Talk active/inactive).
     */
    setSpeaking(roomCode, playerId, channelId, isSpeaking) {
        const code = roomCode.toUpperCase();
        const room = this.roomService.getRoom(code);
        if (!room)
            return;
        const channelMap = this.getOrCreateChannel(code, channelId);
        const participant = channelMap.get(playerId);
        if (!participant)
            return;
        participant.isSpeaking = isSpeaking;
        const speakerMember = room.members[playerId];
        if (!speakerMember)
            return;
        // Broadcast speaking status to other channel participants
        for (const other of channelMap.values()) {
            if (other.playerId === playerId)
                continue;
            const otherMember = room.members[other.playerId];
            if (!otherMember || !otherMember.socketId)
                continue;
            if (!this.canCommunicate(channelId, speakerMember, otherMember)) {
                continue;
            }
            this.io.to(otherMember.socketId).emit('voice:speaking_changed', {
                playerId,
                channelId,
                isSpeaking,
            });
        }
    }
    /**
     * Forwards WebRTC peer signaling (SDP offer, answer, ICE candidate).
     */
    relaySignal(roomCode, senderId, targetPlayerId, channelId, signal) {
        const code = roomCode.toUpperCase();
        const room = this.roomService.getRoom(code);
        if (!room)
            return { success: false, error: 'Room not found' };
        const channelMap = this.getOrCreateChannel(code, channelId);
        const senderPart = channelMap.get(senderId);
        const targetPart = channelMap.get(targetPlayerId);
        if (!senderPart || !targetPart) {
            return { success: false, error: 'One or both participants not in channel' };
        }
        const senderMember = room.members[senderId];
        const targetMember = room.members[targetPlayerId];
        if (!senderMember || !targetMember) {
            return { success: false, error: 'Member record missing' };
        }
        if (!this.canCommunicate(channelId, senderMember, targetMember)) {
            return { success: false, error: 'Cross-squad communication between these operatives is forbidden in this channel' };
        }
        if (!targetMember.socketId) {
            return { success: false, error: 'Target member has no active socket connection' };
        }
        this.io.to(targetMember.socketId).emit('voice:signal', {
            senderId,
            channelId,
            signal,
        });
        return { success: true };
    }
    /**
     * Cleanup on player disconnect.
     */
    handlePlayerDisconnect(playerId) {
        for (const [roomCode, channels] of this.roomVoiceChannels.entries()) {
            for (const channelMap of channels.values()) {
                if (channelMap.has(playerId)) {
                    this.leaveVoiceChannel(roomCode, playerId);
                }
            }
        }
    }
    getChannelParticipants(roomCode, channelId, viewerId) {
        const code = roomCode.toUpperCase();
        const room = this.roomService.getRoom(code);
        if (!room)
            return [];
        const viewer = room.members[viewerId];
        if (!viewer)
            return [];
        const channelMap = this.getOrCreateChannel(code, channelId);
        const result = [];
        for (const part of channelMap.values()) {
            const partMember = room.members[part.playerId];
            if (!partMember)
                continue;
            if (!this.canCommunicate(channelId, viewer, partMember))
                continue;
            result.push(part);
        }
        return result;
    }
}
