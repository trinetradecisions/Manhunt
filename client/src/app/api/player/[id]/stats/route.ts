import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../../server/response';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const stats = {
      playerId: id,
      nickname: 'Agent',
      totalDistanceMeters: 0,
      currentMatchDistanceMeters: 0,
      totalPlaytimeSeconds: 0,
      matchesPlayed: 0,
      matchesWon: 0,
      timesCaught: 0,
      escapes: 0,
      matchHistory: [],
    };

    return jsonResponse({
      success: true,
      stats,
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to fetch player stats' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
