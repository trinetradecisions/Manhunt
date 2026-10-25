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
    const playerId = body.playerId;

    if (!playerId) {
      return jsonResponse({ success: false, error: 'Player ID required' }, 400);
    }

    const res = await GameStateStore.leaveRoom(code, playerId);
    return jsonResponse(res);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to leave room' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
