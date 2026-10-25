import Pusher from 'pusher';

let pusherInstance: Pusher | null = null;

export function getPusherServer(): Pusher | null {
  if (pusherInstance) return pusherInstance;
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY || process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER || process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'mt1';

  if (appId && key && secret) {
    try {
      pusherInstance = new Pusher({
        appId,
        key,
        secret,
        cluster,
        useTLS: true,
      });
      return pusherInstance;
    } catch (err) {
      console.warn('[Pusher] Failed to initialize Pusher server:', err);
    }
  }
  return null;
}

export async function broadcastToRoom(roomCode: string, event: string, data: any): Promise<void> {
  const pusher = getPusherServer();
  if (pusher) {
    try {
      await pusher.trigger(`room-${roomCode.toUpperCase()}`, event, data);
    } catch (err) {
      console.warn(`[Pusher] Error broadcasting ${event} to room-${roomCode}:`, err);
    }
  }
}
