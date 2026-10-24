'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  RoomState,
  CatchAttempt,
  RadioTransmission,
  ChatMessage,
  ChatRecipientType,
  ScheduledRunnerSnapshot,
  PlayerLocation,
} from '../types/game';
import { getBackendUrl } from '../utils/networkConfig';

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
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);

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
  const [roomJoinError, setRoomJoinError] = useState<string | null>(null);

  // Scheduled 120s runner snapshots for Chasers
  const [scheduledSnapshot, setScheduledSnapshot] = useState<ScheduledRunnerSnapshot | null>(null);

  // Live teammate updates
  const [teammateLocations, setTeammateLocations] = useState<Record<string, PlayerLocation>>({});

  // Countdown tick (5, 4, 3, 2, 1)
  const [countdownTick, setCountdownTick] = useState<number | null>(null);

  // Tactical In-Game Chat state (Distinct channels)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [channelMessages, setChannelMessages] = useState<Record<string, ChatMessage[]>>({
    PUBLIC: [],
    SQUAD: [],
    RUNNERS: [],
    CHASERS: [],
  });
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({
    PUBLIC: 0,
    SQUAD: 0,
    RUNNERS: 0,
    CHASERS: 0,
  });
  const [activeChatChannel, setActiveChatChannel] = useState<string>('PUBLIC');
  const activeChatChannelRef = useRef<string>('PUBLIC');
  activeChatChannelRef.current = activeChatChannel;
  const isChatOpenRef = useRef<boolean>(false);

  // Legacy chaser pings (fallback)
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
    serverUrl: getBackendUrl(),
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
    const backendUrl = getBackendUrl();
    setDiagnostics((prev) => ({ ...prev, status: 'CONNECTING', serverUrl: backendUrl }));

    const socket = io(backendUrl, {
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 25,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketRef.current = socket;
    setSocketInstance(socket);

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
              setRoomJoinError(null);
            } else {
              setRoomJoinError(res?.error || 'Room not found or expired');
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
      if (updatedState.match?.lastScheduledSnapshot) {
        setScheduledSnapshot(updatedState.match.lastScheduledSnapshot);
      }
    });

    socket.on('match:alert', (alert) => {
      setRecentAlert(alert);
      if (alert.type !== 'SAFETY_PAUSE') {
        setTimeout(() => setRecentAlert(null), 6000);
      }
    });

    socket.on('match:countdown_tick', ({ remainingSeconds }) => {
      setCountdownTick(remainingSeconds);
      if (remainingSeconds <= 0) {
        setCountdownTick(null);
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

    socket.on('location:scheduled_snapshot', (snapshot: ScheduledRunnerSnapshot) => {
      setScheduledSnapshot(snapshot);
      // Map to legacy chaserPings format for tactical map compatibility
      setChaserPings(
        snapshot.runners.map((r) => ({
          playerId: r.playerId,
          nickname: r.nickname,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracy: r.accuracy,
          ageSeconds: r.snapshotAgeSeconds,
        }))
      );
    });

    socket.on('location:teammate_update', ({ playerId: tId, location: tLoc }) => {
      setTeammateLocations((prev) => ({
        ...prev,
        [tId]: tLoc,
      }));
    });

    socket.on('location:batch_pings', ({ pings }) => {
      setChaserPings(pings);
    });

    // Chat listeners (multi-channel isolation)
    socket.on('chat:message', (message: ChatMessage) => {
      // 1. Update aggregated list
      setChatMessages((prev) => [...prev, message]);

      // 2. Resolve destination channel key
      let chKey = message.channelId?.toUpperCase() || 'PUBLIC';
      if (chKey === 'ALL') chKey = 'PUBLIC';
      if (chKey === 'TEAM') chKey = 'SQUAD';

      setChannelMessages((prev) => ({
        ...prev,
        [chKey]: [...(prev[chKey] || []), message],
      }));

      // 3. Track unread badges per channel
      const isViewingThisChannel =
        isChatOpenRef.current && activeChatChannelRef.current === chKey;
      if (!isViewingThisChannel && message.senderId !== playerIdRef.current) {
        setUnreadChatCount((prev) => prev + 1);
        setUnreadByChannel((prev) => ({
          ...prev,
          [chKey]: (prev[chKey] || 0) + 1,
        }));
      }
    });

    socket.on('chat:history', (history: ChatMessage[]) => {
      setChatMessages(history);
      // Partition history by channel
      const partitioned: Record<string, ChatMessage[]> = {
        PUBLIC: [],
        SQUAD: [],
        RUNNERS: [],
        CHASERS: [],
      };
      history.forEach((msg) => {
        let ch = msg.channelId?.toUpperCase() || (msg.recipientType === 'ALL' ? 'PUBLIC' : 'SQUAD');
        if (!partitioned[ch]) partitioned[ch] = [];
        partitioned[ch].push(msg);
      });
      setChannelMessages((prev) => ({ ...prev, ...partitioned }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Separate effect to join room when roomCode/playerId becomes available or changes
  useEffect(() => {
    const socket = socketRef.current;
    if (socket && socket.connected && roomCode && playerId) {
      socket.emit('room:join', { roomCode, playerId, nickname }, (res: any) => {
        if (res?.success && res.room) {
          setRoomState(res.room);
          setRoomJoinError(null);
        } else {
          setRoomJoinError(res?.error || 'Room not found or expired');
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

  // Send Chat message across explicit channels (PUBLIC, SQUAD, RUNNERS, CHASERS, DIRECT)
  const sendChatMessage = useCallback(
    (recipientTypeOrChannel: string, text: string, recipientId?: string) => {
      if (!roomCodeRef.current || !playerIdRef.current) return;
      emit('chat:send', {
        roomCode: roomCodeRef.current,
        senderId: playerIdRef.current,
        channelId: recipientTypeOrChannel,
        recipientType:
          recipientTypeOrChannel === 'DIRECT'
            ? 'DIRECT'
            : recipientTypeOrChannel === 'PUBLIC' || recipientTypeOrChannel === 'ALL'
            ? 'ALL'
            : 'TEAM',
        text,
        recipientId,
      });
    },
    [emit]
  );

  // Mark chat as read (entirely or for specific channel)
  const markChatRead = useCallback((open: boolean = true, channelId?: string) => {
    isChatOpenRef.current = open;
    if (open) {
      if (channelId) {
        setUnreadByChannel((prev) => ({ ...prev, [channelId]: 0 }));
      } else {
        setUnreadChatCount(0);
        setUnreadByChannel({
          PUBLIC: 0,
          SQUAD: 0,
          RUNNERS: 0,
          CHASERS: 0,
        });
      }
    }
  }, []);

  const selectChatChannel = useCallback((channelId: string) => {
    setActiveChatChannel(channelId);
    activeChatChannelRef.current = channelId;
    setUnreadByChannel((prev) => ({ ...prev, [channelId]: 0 }));
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

  const leaveRoom = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || !roomCode || !playerId) {
      setRoomState(null);
      return true;
    }
    return new Promise<boolean>((resolve) => {
      socket.emit('room:leave', { roomCode, playerId }, (res: any) => {
        setRoomState(null);
        resolve(res?.success ?? true);
      });
      setTimeout(() => {
        setRoomState(null);
        resolve(true);
      }, 1500);
    });
  }, [roomCode, playerId]);

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

  const requestCatchCode = useCallback(async (): Promise<{ success: boolean; catchCode?: string; expiresAt?: number; error?: string }> => {
    const socket = socketRef.current;
    if (!socket || !roomCode || !playerId) {
      return { success: false, error: 'Not connected' };
    }
    return new Promise((resolve) => {
      socket.emit('catch:request_code', { roomCode, runnerId: playerId }, (res: any) => {
        resolve(res || { success: false, error: 'No response from server' });
      });
      setTimeout(() => resolve({ success: false, error: 'Request timeout' }), 5000);
    });
  }, [roomCode, playerId]);

  const submitCatchCode = useCallback(async (targetRunnerId: string, catchCode: string): Promise<{ success: boolean; error?: string; attempt?: any }> => {
    const socket = socketRef.current;
    if (!socket || !roomCode || !playerId) {
      return { success: false, error: 'Not connected' };
    }
    return new Promise((resolve) => {
      socket.emit('catch:attempt_code', { roomCode, chaserId: playerId, targetRunnerId, catchCode }, (res: any) => {
        resolve(res || { success: false, error: 'No response from server' });
      });
      setTimeout(() => resolve({ success: false, error: 'Verification timeout' }), 5000);
    });
  }, [roomCode, playerId]);

  const answerLandmarkClue = useCallback(async (answer: string): Promise<{ success: boolean; completed?: boolean; error?: string }> => {
    const socket = socketRef.current;
    if (!socket || !roomCode || !playerId) {
      return { success: false, error: 'Not connected' };
    }
    return new Promise((resolve) => {
      socket.emit('mission:answer_landmark', { roomCode, playerId, answer }, (res: any) => {
        resolve(res || { success: false, error: 'No response from server' });
      });
      setTimeout(() => resolve({ success: false, error: 'Request timeout' }), 5000);
    });
  }, [roomCode, playerId]);

  return {
    socket: socketInstance || socketRef.current,
    isConnected,
    roomState,
    roomJoinError,
    recentAlert,
    pendingCatch,
    incomingRadio,
    scheduledSnapshot,
    teammateLocations,
    countdownTick,
    chatMessages,
    channelMessages,
    unreadChatCount,
    unreadByChannel,
    activeChatChannel,
    selectChatChannel,
    sendChatMessage,
    markChatRead,
    chaserPings,
    diagnostics,
    measurePing,
    manualReconnect,
    leaveRoom,
    requestCatchCode,
    submitCatchCode,
    answerLandmarkClue,
    clearAlert: () => setRecentAlert(null),
    dismissRadio: () => setIncomingRadio(null),
    emit,
  };
}
