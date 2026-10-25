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
    const { hostId, excludedAreas } = body;

    if (!hostId) {
      return jsonResponse({ success: false, error: 'Host ID required' }, 400);
    }
    if (!Array.isArray(excludedAreas)) {
      return jsonResponse({ success: false, error: 'excludedAreas must be an array' }, 400);
    }

    const res = await GameStateStore.updateExcludedAreas(code, hostId, excludedAreas);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse({
      success: true,
      room: GameStateStore.sanitizeRoomForPlayer(res.room!, hostId),
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to update excluded areas' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
