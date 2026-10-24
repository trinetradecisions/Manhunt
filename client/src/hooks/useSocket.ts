'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { RoomState, CatchAttempt, RadioTransmission } from '../types/game';

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';

export type SocketConnectionStatus =
  | 'INITIALIZING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'ERROR';

export interface SocketDiagnostics {
  status: SocketConnectionStatus;
  socketId: string | null;
  serverUrl: string;
  activeTransport: string;
  reconnectAttempts: number;
  lastError: string | null;
  lastErrorTimestamp: number | null;
  disconnectReason: string | null;
  disconnectTimestamp: number | null;
  latencyMs: number | null;
}

export function useSocket(roomCode?: string, playerId?: string, nickname?: string) {
  const socketRef = useRef<Socket | null>(null);

  // Core gameplay states
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [recentAlert, setRecentAlert] = useState<{
    type: string;
    title: string;
    message: string;
    timestamp: number;
  } | null>(null);
  const [pendingCatch, setPendingCatch] = useState<CatchAttempt | null>(null);
  const [incomingRadio, setIncomingRadio] = useState<RadioTransmission | null>(null);
  const [chaserPings, setChaserPings] = useState<
    Array<{
      playerId: string;
      nickname: string;
      latitude: number;
      longitude: number;
      accuracy: number;
      ageSeconds: number;
    }>
  >([]);

  // Diagnostics states
  const [diagnostics, setDiagnostics] = useState<SocketDiagnostics>({
    status: 'INITIALIZING',
    socketId: null,
    serverUrl: SOCKET_URL,
    activeTransport: 'none',
    reconnectAttempts: 0,
    lastError: null,
    lastErrorTimestamp: null,
    disconnectReason: null,
    disconnectTimestamp: null,
    latencyMs: null,
  });

  // Keep latest parameters in refs so socket listeners always access current values without reconnecting
  const roomCodeRef = useRef(roomCode);
  const playerIdRef = useRef(playerId);
  const nicknameRef = useRef(nickname);

  roomCodeRef.current = roomCode;
  playerIdRef.current = playerId;
  nicknameRef.current = nickname;

  // Single persistent socket connection lifecycle
  useEffect(() => {
    setDiagnostics((prev) => ({ ...prev, status: 'CONNECTING' }));

    // Standard Socket.IO transport order: starts with polling for instant compatibility, upgrades to websocket
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 25,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketRef.current = socket;

    const updateTransport = () => {
      try {
        const transport = (socket.io?.engine as any)?.transport?.name || 'unknown';
        setDiagnostics((prev) => ({ ...prev, activeTransport: transport }));
      } catch {
        // Safe fallback
      }
    };

    socket.on('connect', () => {
      setIsConnected(true);
      const transport = (socket.io?.engine as any)?.transport?.name || 'unknown';

      setDiagnostics((prev) => ({
        ...prev,
        status: 'CONNECTED',
        socketId: socket.id || null,
        activeTransport: transport,
        lastError: null,
        disconnectReason: null,
      }));

      // Listen for transport upgrade (e.g. polling -> websocket)
      if (socket.io?.engine) {
        socket.io.engine.on('upgrade', () => {
          updateTransport();
        });
      }

      // Re-join active room if player identity is set
      const curRoom = roomCodeRef.current;
      const curPlayer = playerIdRef.current;
      const curNick = nicknameRef.current;

      if (curRoom && curPlayer) {
        socket.emit(
          'room:join',
          { roomCode: curRoom, playerId: curPlayer, nickname: curNick },
          (res: any) => {
            if (res?.success && res.room) {
              setRoomState(res.room);
            }
          }
        );
      }
    });

    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      setDiagnostics((prev) => ({
        ...prev,
        status: 'DISCONNECTED',
        socketId: null,
        disconnectReason: reason,
        disconnectTimestamp: Date.now(),
      }));
    });

    socket.on('connect_error', (err) => {
      setIsConnected(false);
      setDiagnostics((prev) => ({
        ...prev,
        status: 'ERROR',
        lastError: err.message || 'Connection error',
        lastErrorTimestamp: Date.now(),
      }));
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      setDiagnostics((prev) => ({
        ...prev,
        status: 'RECONNECTING',
        reconnectAttempts: attempt,
      }));
    });

    socket.io.on('reconnect', () => {
      setDiagnostics((prev) => ({
        ...prev,
        status: 'CONNECTED',
        reconnectAttempts: 0,
        lastError: null,
      }));
    });

    socket.io.on('reconnect_error', (err) => {
      setDiagnostics((prev) => ({
        ...prev,
        lastError: `Reconnect failed: ${err.message}`,
        lastErrorTimestamp: Date.now(),
      }));
    });

    socket.io.on('reconnect_failed', () => {
      setDiagnostics((prev) => ({
        ...prev,
        status: 'ERROR',
        lastError: 'Max reconnection attempts reached',
        lastErrorTimestamp: Date.now(),
      }));
    });

    // Game state listeners
    socket.on('room:state', (updatedState: RoomState) => {
      setRoomState(updatedState);
    });

    socket.on('match:alert', (alert) => {
      setRecentAlert(alert);
      if (alert.type !== 'SAFETY_PAUSE') {
        setTimeout(() => setRecentAlert(null), 6000);
      }
    });

    socket.on('catch:pending', (attempt: CatchAttempt) => {
      setPendingCatch(attempt);
    });

    socket.on('catch:resolved', () => {
      setPendingCatch(null);
    });

    socket.on('radio:incoming', (transmission: RadioTransmission) => {
      setIncomingRadio(transmission);
    });

    socket.on('location:batch_pings', ({ pings }) => {
      setChaserPings(pings);
    });

    return () => {
      socket.disconnect();
    };
  }, []); // Only runs once on mount, preventing premature connection tears

  // Separate effect to join room when roomCode/playerId becomes available or changes
  useEffect(() => {
    const socket = socketRef.current;
    if (socket && socket.connected && roomCode && playerId) {
      socket.emit('room:join', { roomCode, playerId, nickname }, (res: any) => {
        if (res?.success && res.room) {
          setRoomState(res.room);
        }
      });
    }
  }, [roomCode, playerId, nickname]);

  const emit = useCallback((event: string, payload: any, callback?: (res: any) => void) => {
    if (socketRef.current?.connected) {
      if (callback) {
        socketRef.current.emit(event, payload, callback);
      } else {
        socketRef.current.emit(event, payload);
      }
    }
  }, []);

  // Measure round-trip ping latency
  const measurePing = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return null;

    const start = performance.now();
    return new Promise<number>((resolve) => {
      socket.emit('diagnostics:ping', { timestamp: Date.now() }, () => {
        const roundTrip = Math.round(performance.now() - start);
        setDiagnostics((prev) => ({ ...prev, latencyMs: roundTrip }));
        resolve(roundTrip);
      });

      // Timeout fallback
      setTimeout(() => {
        resolve(-1);
      }, 3000);
    });
  }, []);

  const manualReconnect = useCallback(() => {
    if (socketRef.current) {
      setDiagnostics((prev) => ({
        ...prev,
        status: 'CONNECTING',
        lastError: null,
      }));
      socketRef.current.disconnect();
      socketRef.current.connect();
    }
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    roomState,
    recentAlert,
    pendingCatch,
    incomingRadio,
    chaserPings,
    diagnostics,
    measurePing,
    manualReconnect,
    clearAlert: () => setRecentAlert(null),
    dismissRadio: () => setIncomingRadio(null),
    emit,
  };
}
