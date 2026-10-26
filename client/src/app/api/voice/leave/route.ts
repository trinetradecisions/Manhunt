import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../server/response';
import { GameStateStore } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { roomCode, playerId, existingRoom, room } = body;

    if (!roomCode || !playerId) {
      return jsonResponse({ success: false, error: 'Room code and player ID required' }, 400);
    }

    if (existingRoom || room) {
      await GameStateStore.hydrateRoom(existingRoom || room, playerId);
    }

    const res = await GameStateStore.leaveVoiceChannel(roomCode, playerId);
    return jsonResponse(res);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to leave voice channel' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
