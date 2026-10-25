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

    if (!requesterId) {
      return jsonResponse({ success: false, error: 'Requester ID required' }, 400);
    }

    if (body.existingRoom || body.room) {
      const existing = await GameStateStore.getRoom(code);
      if (!existing) {
        await GameStateStore.hydrateRoom(body.existingRoom || body.room, requesterId);
      }
    }

    const res = await GameStateStore.autoAssignTeams(code, requesterId);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      chasersCount: res.chasersCount,
      runnersCount: res.runnersCount,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, requesterId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to auto-assign teams' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
