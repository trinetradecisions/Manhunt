import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../../server/response';
import { GameStateStore } from '../../../../../server/store';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await req.json().catch(() => ({}));
    const playerId = body.playerId || body.player?.id || 'player_' + Math.random().toString(36).substring(2, 9);
    const nickname = body.nickname || body.player?.nickname || 'Operative';
    const role = body.role || body.player?.role;
    const team = body.team || body.player?.team;

    if (body.existingRoom || body.room) {
      await GameStateStore.hydrateRoom(body.existingRoom || body.room, playerId);
    }

    const res = await GameStateStore.joinRoom(code, {
      id: playerId,
      nickname,
      role,
      team,
    });

    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      member: res.member,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, playerId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to join room' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
