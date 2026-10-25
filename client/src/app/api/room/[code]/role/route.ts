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
    const targetPlayerId = body.targetPlayerId || body.playerId;
    const requesterId = body.requesterId || body.hostPlayerId || body.hostId;
    const { role, team } = body;

    if (!targetPlayerId) {
      return jsonResponse({ success: false, error: 'Target Player ID required' }, 400);
    }

    let res;
    if (requesterId && role) {
      res = await GameStateStore.setPlayerRole(code, requesterId, targetPlayerId, role);
    } else {
      res = await GameStateStore.setRole(code, targetPlayerId, role, team);
    }

    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, targetPlayerId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update role' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
