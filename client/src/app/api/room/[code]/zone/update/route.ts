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
    const requesterId = body.requesterId || body.hostId || body.playerId;
    const playZone = body.playZone;

    if (!requesterId || !playZone) {
      return jsonResponse({ success: false, error: 'Requester ID and playZone required' }, 400);
    }

    const res = await GameStateStore.updateConfig(code, requesterId, { playZone });
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, requesterId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update play zone' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
