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
    const { playerId, location } = body;

    if (!playerId || !location) {
      return jsonResponse({ success: false, error: 'Player ID and location required' }, 400);
    }

    const res = await GameStateStore.updateLocation(code, playerId, location);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      alert: res.alert,
      completedMissions: res.completedMissions,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, playerId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update location' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
