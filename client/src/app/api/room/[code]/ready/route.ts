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
    const { playerId, gpsStatus, accuracy } = body;
    const isReady = body.ready !== undefined ? body.ready : body.isReady;

    if (!playerId) {
      return jsonResponse({ success: false, error: 'Player ID required' }, 400);
    }

    if (body.existingRoom || body.room) {
      const existing = await GameStateStore.getRoom(code);
      if (!existing) {
        await GameStateStore.hydrateRoom(body.existingRoom || body.room, playerId);
      }
    }

    const res = await GameStateStore.setReady(code, playerId, isReady, gpsStatus, accuracy);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, playerId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update ready state' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
