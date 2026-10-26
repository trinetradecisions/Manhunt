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
    const { runnerId } = body;

    if (!runnerId) {
      return jsonResponse({ success: false, error: 'Runner ID required' }, 400);
    }

    if (body.existingRoom || body.room) {
      await GameStateStore.hydrateRoom(body.existingRoom || body.room, runnerId);
    }

    const res = await GameStateStore.requestCatchCode(code, runnerId);
    if (!res.success) {
      return jsonResponse({ success: false, error: res.error }, 400);
    }

    return jsonResponse(res);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to request catch code' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
