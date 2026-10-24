'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { RoomState, CatchAttempt, RadioTransmission } from '../types/game';

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';

export function useSocket(roomCode?: string, playerId?: string, nickname?: string) {
  const socketRef = useRef<Socket | null>(null);
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
  const [chaserPings, setChaserPings] = useState<Array<{
    playerId: string;
    nickname: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    ageSeconds: number;
  }>>([]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      if (roomCode && playerId) {
        socket.emit('room:join', { roomCode, playerId, nickname }, (res: any) => {
          if (res?.success && res.room) {
            setRoomState(res.room);
          }
        });
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

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

  return {
    socket: socketRef.current,
    isConnected,
    roomState,
    recentAlert,
    pendingCatch,
    incomingRadio,
    chaserPings,
    clearAlert: () => setRecentAlert(null),
    dismissRadio: () => setIncomingRadio(null),
    emit,
  };
}
