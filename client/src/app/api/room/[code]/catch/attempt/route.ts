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
    const { chaserId, runnerId, catchCode } = body;

    if (!chaserId || !runnerId || !catchCode) {
      return jsonResponse({ success: false, error: 'Chaser ID, Runner ID, and Catch Code required' }, 400);
    }

    const res = await GameStateStore.attemptCatchWithCode(code, chaserId, runnerId, catchCode);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
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
