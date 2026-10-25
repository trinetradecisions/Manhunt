import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../server/response';
import { GameStateStore } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const hostId = body.hostPlayerId || body.hostId || 'host_' + Math.random().toString(36).substring(2, 9);
    const nickname = body.nickname || 'Host';

    const room = await GameStateStore.createRoom({
      id: hostId,
      nickname,
      role: body.role || 'HOST',
      team: body.team || 'NONE',
    });

    return jsonResponse({
      success: true,
      roomCode: room.roomCode,
      room: GameStateStore.sanitizeRoomForPlayer(room, hostId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to create room' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
