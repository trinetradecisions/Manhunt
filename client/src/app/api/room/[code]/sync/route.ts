import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../../server/response';
import { GameStateStore } from '../../../../../server/store';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(req.url);
    const playerId = searchParams.get('playerId') || undefined;
    const sinceVersion = parseInt(searchParams.get('since') || '0', 10);

    const syncState = await GameStateStore.getSyncState(code, playerId, sinceVersion);
    return jsonResponse({
      success: true,
      ...syncState,
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to sync room state' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
