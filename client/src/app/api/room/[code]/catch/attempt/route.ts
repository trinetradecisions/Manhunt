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
    const chaserId = body.chaserId || body.playerId;
    const runnerId = body.runnerId || body.targetRunnerId;
    const catchCode = body.catchCode;

    if (!chaserId || !runnerId) {
      return jsonResponse({ success: false, error: 'Chaser ID and Runner ID required' }, 400);
    }

    if (body.existingRoom || body.room) {
      await GameStateStore.hydrateRoom(body.existingRoom || body.room, chaserId);
    }

    let res;
    if (catchCode && typeof catchCode === 'string' && catchCode.trim().length > 0) {
      res = await GameStateStore.attemptCatchWithCode(code, chaserId, runnerId, catchCode);
    } else {
      res = await GameStateStore.attemptCatchProximity(code, chaserId, runnerId);
    }

    if (!res.success) {
      return jsonResponse(
        {
          success: false,
          error: res.error,
          attemptsRemaining: (res as any).attemptsRemaining,
        },
        400
      );
    }

    return jsonResponse({
      success: true,
      catchAttempt: res.catchAttempt,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, chaserId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to attempt catch' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
