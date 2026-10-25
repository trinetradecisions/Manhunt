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
    const initiatorId = body.initiatorId || body.playerId || body.hostId;

    if (!initiatorId) {
      return jsonResponse({ success: false, error: 'Initiator ID required' }, 400);
    }

    const res = await GameStateStore.resumeMatch(code, initiatorId);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, initiatorId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to resume match' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
