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
    const hostId = body.hostId || body.requesterId || body.playerId;
    const config = body.config;

    if (!hostId) {
      return jsonResponse({ success: false, error: 'Host ID required' }, 400);
    }

    if (body.existingRoom || body.room) {
      const existing = await GameStateStore.getRoom(code);
      if (!existing) {
        await GameStateStore.hydrateRoom(body.existingRoom || body.room, hostId);
      }
    }

    const res = await GameStateStore.updateConfig(code, hostId, config || {});
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, hostId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update config' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
