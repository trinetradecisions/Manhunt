import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../server/response';
import { GameStateStore } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(req.url);
    const playerId = searchParams.get('playerId') || undefined;

    const room = await GameStateStore.getRoom(code);
    if (!room) {
      return jsonResponse({ success: false, error: 'Room not found' }, 404);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(room, playerId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Error fetching room' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
