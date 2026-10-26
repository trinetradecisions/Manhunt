import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../server/response';
import { GameStateStore } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { roomCode, playerId, channelId, isSpeaking, existingRoom, room } = body;

    if (!roomCode || !playerId || !channelId) {
      return jsonResponse({ success: false, error: 'Room code, player ID, and channel ID required' }, 400);
    }

    if (existingRoom || room) {
      await GameStateStore.hydrateRoom(existingRoom || room, playerId);
    }

    const res = await GameStateStore.setVoiceSpeaking(roomCode, playerId, channelId, !!isSpeaking);
    return jsonResponse(res);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update speaking state' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
