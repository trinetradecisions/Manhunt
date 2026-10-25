import { NextRequest } from 'next/server';
import { jsonResponse, handleOptions } from '../../../../server/response';
import { GameStateStore } from '../../../../server/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    let roomCode = '';
    let senderId = '';
    let senderNickname = 'Agent';
    let team: any = 'NONE';
    let audioUrl = '';
    let durationMs = 3000;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      roomCode = (formData.get('roomCode') as string) || '';
      senderId = (formData.get('senderId') as string) || '';
      senderNickname = (formData.get('senderNickname') as string) || 'Agent';
      team = (formData.get('team') as any) || 'NONE';
      const file = formData.get('audio') as File | null;
      const duration = formData.get('durationMs') as string | null;
      if (duration) durationMs = parseInt(duration, 10);

      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mime = file.type || 'audio/webm';
        audioUrl = `data:${mime};base64,${buffer.toString('base64')}`;
      }
    } else {
      const body = await req.json().catch(() => ({}));
      roomCode = body.roomCode || '';
      senderId = body.senderId || '';
      senderNickname = body.senderNickname || 'Agent';
      team = body.team || 'NONE';
      audioUrl = body.audioUrl || body.audioDataUrl || '';
      if (body.durationMs) durationMs = body.durationMs;
    }

    if (!roomCode || !senderId || !audioUrl) {
      return jsonResponse({ success: false, error: 'Room code, sender ID, and audio content required' }, 400);
    }

    const res = await GameStateStore.uploadRadioTransmission(roomCode, {
      senderId,
      senderNickname,
      team,
      audioUrl,
      durationMs,
    });

    return jsonResponse(res);
  } catch (err: any) {
    return jsonResponse({ success: false, error: err.message || 'Failed to upload radio transmission' }, 500);
  }
}

export async function OPTIONS() {
  return handleOptions();
}
