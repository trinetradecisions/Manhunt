/**
 * Centralized Network & WebRTC Configuration
 * Resolves backend Socket.IO/REST URL dynamically for localhost or local-area-network mobile testing.
 */

export function getBackendUrl(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) {
    return process.env.NEXT_PUBLIC_SOCKET_URL;
  }
  // Vercel Service Binding: Injected by Vercel at runtime for internal service-to-service calls
  if (process.env.SERVER_URL) {
    return process.env.SERVER_URL;
  }
  if (typeof window !== 'undefined') {
    // If running over HTTPS (such as Vercel production deployment), use origin
    // Top-level vercel.json rewrites route /api and /socket.io directly to the server service
    if (window.location.protocol === 'https:') {
      return window.location.origin;
    }
    const hostname = window.location.hostname || 'localhost';
    if (window.location.port === '3000') {
      return `http://${hostname}:4000`;
    }
    return window.location.origin;
  }
  return 'http://localhost:4000';
}

export function getIceConfiguration(): RTCConfiguration {
  const stunUrl = process.env.NEXT_PUBLIC_STUN_URL || 'stun:stun.l.google.com:19302';
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  const iceServers: RTCIceServer[] = [
    { urls: stunUrl },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  if (turnUrl && turnUser && turnCred) {
    iceServers.push({
      urls: turnUrl,
      username: turnUser,
      credential: turnCred,
    });
  }

  return {
    iceServers,
    iceCandidatePoolSize: 2,
  };
}
