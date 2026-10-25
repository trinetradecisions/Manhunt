import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../../../server/response';
import { GameStateStore } from '../../../../../../server/store';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await req.json().catch(() => ({}));
    const requesterId = body.requesterId || body.hostPlayerId || body.hostId || body.playerId;
    const targetPlayerId = body.targetPlayerId || body.playerId;
    const team = body.team;

    if (!requesterId || !targetPlayerId || !team) {
      return jsonResponse({ success: false, error: 'Requester ID, Target Player ID, and Team required' }, 400);
    }

    if (body.existingRoom || body.room) {
      const existing = await GameStateStore.getRoom(code);
      if (!existing) {
        await GameStateStore.hydrateRoom(body.existingRoom || body.room, requesterId);
      }
    }

    const res = await GameStateStore.assignPlayerTeam(code, requesterId, targetPlayerId, team);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, requesterId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to assign team' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
