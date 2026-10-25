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
    const roomState = body.room || body;
    const requesterId = body.requesterId || body.playerId || roomState?.hostId;

    if (!roomState) {
      return jsonResponse({ success: false, error: 'Room state required' }, 400);
    }

    const res = await GameStateStore.hydrateRoom(roomState, requesterId);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, requesterId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to hydrate room' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
