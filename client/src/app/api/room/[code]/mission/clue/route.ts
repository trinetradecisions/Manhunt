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
    const { runnerId, answer } = body;

    if (!runnerId || !answer) {
      return jsonResponse({ success: false, error: 'Runner ID and answer required' }, 400);
    }

    const res = await GameStateStore.answerLandmarkClue(code, runnerId, answer);
    return jsonResponse(res);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to submit landmark clue' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
