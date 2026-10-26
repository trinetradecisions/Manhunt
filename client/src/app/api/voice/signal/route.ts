import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../server/response';
import { GameStateStore } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { roomCode, senderId, targetPlayerId, channelId, signal, fromPlayerId, toPlayerId, existingRoom, room } = body;
    const resolvedSender = senderId || fromPlayerId;
    const resolvedTarget = targetPlayerId || toPlayerId;

    if (!roomCode || !resolvedSender || !signal) {
      return jsonResponse({ success: false, error: 'Room code, sender ID, and signal required' }, 400);
    }

    if (existingRoom || room) {
      await GameStateStore.hydrateRoom(existingRoom || room, resolvedSender);
    }

    const res = await GameStateStore.recordVoiceSignal(roomCode, {
      senderId: resolvedSender,
      fromPlayerId: resolvedSender,
      targetPlayerId: resolvedTarget,
      toPlayerId: resolvedTarget,
      channelId: channelId || 'SQUAD',
      signal,
    });

    return jsonResponse(res);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to process voice signal' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
