import { jsonResponse, handleOptions } from '../../server/response';

export const dynamic = 'force-dynamic';

export async function GET() {
  return jsonResponse({
    status: 'healthy',
    timestamp: Date.now(),
    uptimeSeconds: Math.floor(process.uptime()),
    engine: 'serverless-vercel',
    realtime: process.env.PUSHER_KEY || process.env.NEXT_PUBLIC_PUSHER_KEY ? 'pusher' : 'smart-polling',
    storage: (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) ? 'redis' : 'memory-warm-cache',
  });
}

export async function OPTIONS() {
  return handleOptions();
}
