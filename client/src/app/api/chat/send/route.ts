import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../server/response';
import { GameStateStore } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { roomCode, senderId, senderNickname, senderTeam, channelId, text, recipientType, recipientId } = body;

    if (!roomCode || !senderId || !text) {
      return jsonResponse({ success: false, error: 'Room code, sender ID, and message text required' }, 400);
    }

    const res = await GameStateStore.sendChatMessage(roomCode, {
      senderId,
      senderNickname: senderNickname || 'Agent',
      senderTeam: senderTeam || 'NONE',
      channelId: channelId || 'PUBLIC',
      text,
      recipientType,
      recipientId,
    });

    return jsonResponse(res);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to send chat message' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
