'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Pusher from 'pusher-js';
import {
  RoomState,
  CatchAttempt,
  RadioTransmission,
  ChatMessage,
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

  // Scheduled runner snapshots for Chasers
  const [scheduledSnapshot, setScheduledSnapshot] = useState<ScheduledRunnerSnapshot | null>(null);

  // Live teammate updates
  const [teammateLocations, setTeammateLocations] = useState<Record<string, PlayerLocation>>({});

  // Countdown tick (5, 4, 3, 2, 1)
  const [countdownTick, setCountdownTick] = useState<number | null>(null);

  // Tactical In-Game Chat state
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

  // Legacy chaser pings
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
    activeTransport: 'serverless-sync',
    reconnectAttempts: 0,
    lastError: null,
    lastErrorTimestamp: null,
    disconnectReason: null,
    disconnectTimestamp: null,
    latencyMs: null,
  });

  const roomCodeRef = useRef(roomCode);
  const playerIdRef = useRef(playerId);
  const nicknameRef = useRef(nickname);
  const lastSyncVersionRef = useRef<number>(0);
  const roomStateRef = useRef<RoomState | null>(null);

  roomCodeRef.current = roomCode;
  playerIdRef.current = playerId;
  nicknameRef.current = nickname;
  roomStateRef.current = roomState;

  // Event listener registry for custom events (e.g., voice, alerts)
  const listenersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  const addListener = useCallback((event: string, callback: (data: any) => void) => {
    let set = listenersRef.current.get(event);
    if (!set) {
      set = new Set();
      listenersRef.current.set(event, set);
    }
    set.add(callback);
  }, []);

  const removeListener = useCallback((event: string, callback: (data: any) => void) => {
    const set = listenersRef.current.get(event);
    if (set) {
      set.delete(callback);
    }
  }, []);

  const dispatchEvent = useCallback((event: string, data: any) => {
    const set = listenersRef.current.get(event);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in socket listener for ${event}:`, err);
        }
      });
    }
  }, []);

  // Update room state and derived views with monotonic version check
  const applyRoomState = useCallback((state: RoomState) => {
    if (!state) return;

    setRoomState((prev) => {
      // Guard against stale state reverting a newer version
      if (prev?.version && state.version && state.version < prev.version) {
        return prev;
      }

      // If in lobby, protect against transient roster truncation from stale instances
      if (prev?.state === 'LOBBY' && state.state === 'LOBBY' && prev.members && state.members) {
        const prevCount = Object.keys(prev.members).length;
        const nextCount = Object.keys(state.members).length;
        if (nextCount < prevCount && state.version && prev.version && state.version <= prev.version) {
          return prev;
        }
      }

      return state;
    });

    if (state.version) {
      lastSyncVersionRef.current = Math.max(lastSyncVersionRef.current, state.version);
    }
    roomStateRef.current = state;

    if (state.match?.lastScheduledSnapshot) {
      setScheduledSnapshot(state.match.lastScheduledSnapshot);
      setChaserPings(
        state.match.lastScheduledSnapshot.runners.map((r) => ({
          playerId: r.playerId,
          nickname: r.nickname,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracy: r.accuracy,
          ageSeconds: r.snapshotAgeSeconds,
        }))
      );
    }
  }, []);


  // Ingest incoming chat message
  const handleIncomingChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });

    let chKey = msg.channelId?.toUpperCase() || 'PUBLIC';
    if (chKey === 'ALL') chKey = 'PUBLIC';
    if (chKey === 'TEAM') chKey = 'SQUAD';

    setChannelMessages((prev) => {
      const currentChannelMsgs = prev[chKey] || [];
      if (currentChannelMsgs.some((m) => m.id === msg.id)) return prev;
      return {
        ...prev,
        [chKey]: [...currentChannelMsgs, msg],
      };
    });

    const isViewing = isChatOpenRef.current && activeChatChannelRef.current === chKey;
    if (!isViewing && msg.senderId !== playerIdRef.current) {
      setUnreadChatCount((prev) => prev + 1);
      setUnreadByChannel((prev) => ({
        ...prev,
        [chKey]: (prev[chKey] || 0) + 1,
      }));
    }
  }, []);

  // Initial Health Check
  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      const backendUrl = getBackendUrl();
      const start = performance.now();
      try {
        const res = await fetch(`${backendUrl}/api/health`);
        const data = await res.json();
        if (mounted && data.status === 'healthy') {
          const latency = Math.round(performance.now() - start);
          setIsConnected(true);
          setDiagnostics((prev) => ({
            ...prev,
            status: 'CONNECTED',
            activeTransport: data.realtime === 'pusher' ? 'pusher+http' : 'serverless-sync',
            serverUrl: backendUrl,
            latencyMs: latency,
            lastError: null,
          }));
        }
      } catch (err: any) {
        if (mounted) {
          setIsConnected(false);
          setDiagnostics((prev) => ({
            ...prev,
            status: 'ERROR',
            lastError: err.message || 'Health check failed',
            lastErrorTimestamp: Date.now(),
          }));
        }
      }
    };

    checkHealth();
    return () => {
      mounted = false;
    };
  }, []);

  // Pusher Realtime Subscription (if NEXT_PUBLIC_PUSHER_KEY is provided)
  useEffect(() => {
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'mt1';
    if (!pusherKey || !roomCode) return;

    let pusherClient: Pusher | null = null;
    try {
      pusherClient = new Pusher(pusherKey, {
        cluster: pusherCluster,
      });

      const channel = pusherClient.subscribe(`room-${roomCode.toUpperCase()}`);

      channel.bind('room:update', (data: RoomState) => {
        applyRoomState(data);
        dispatchEvent('room:state', data);
      });

      channel.bind('match:countdown_tick', (data: { remainingSeconds: number }) => {
        setCountdownTick(data.remainingSeconds);
        if (data.remainingSeconds <= 0) setCountdownTick(null);
        dispatchEvent('match:countdown_tick', data);
      });

      channel.bind('location:teammate_update', (data: { playerId: string; location: PlayerLocation }) => {
        setTeammateLocations((prev) => ({ ...prev, [data.playerId]: data.location }));
        dispatchEvent('location:teammate_update', data);
      });

      channel.bind('catch:confirmed', (data: CatchAttempt) => {
        dispatchEvent('catch:confirmed', data);
      });

      channel.bind('catch:pending', (data: CatchAttempt) => {
        setPendingCatch(data);
        dispatchEvent('catch:pending', data);
      });

      channel.bind('chat:message', (data: ChatMessage) => {
        handleIncomingChatMessage(data);
        dispatchEvent('chat:message', data);
      });

      channel.bind('radio:transmission', (data: RadioTransmission) => {
        setIncomingRadio(data);
        dispatchEvent('radio:incoming', data);
      });

      channel.bind('voice:signal', (data: any) => {
        dispatchEvent('voice:signal', data);
      });
    } catch (err) {
      console.warn('[Pusher] Client subscription failed:', err);
    }

    return () => {
      if (pusherClient && roomCode) {
        pusherClient.unsubscribe(`room-${roomCode.toUpperCase()}`);
        pusherClient.disconnect();
      }
    };
  }, [roomCode, applyRoomState, dispatchEvent, handleIncomingChatMessage]);

  // Serverless Smart Delta Polling Loop
  useEffect(() => {
    if (!roomCode) return;
    let mounted = true;
    let timer: NodeJS.Timeout | null = null;

    const pollSync = async () => {
      try {
        const backendUrl = getBackendUrl();
        const pId = playerIdRef.current || '';
        const since = lastSyncVersionRef.current;
        const res = await fetch(
          `${backendUrl}/api/room/${roomCode}/sync?since=${since}&playerId=${encodeURIComponent(pId)}`
        );
        const data = await res.json();

        if (mounted && data.success) {
          setIsConnected(true);

          // If instance is cold or needs hydration and we have local room state, hydrate serverless instance!
          if (data.needsHydration && roomStateRef.current) {
            fetch(`${backendUrl}/api/room/${roomCode}/hydrate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                room: roomStateRef.current,
                requesterId: pId,
              }),
            }).catch(() => {});
          }

          if (data.changed && data.room) {
            const nextVersion = data.version || data.room.version || lastSyncVersionRef.current;
            lastSyncVersionRef.current = Math.max(lastSyncVersionRef.current, nextVersion);
            applyRoomState(data.room);
            dispatchEvent('room:state', data.room);

            if (data.chatMessages && Array.isArray(data.chatMessages)) {
              data.chatMessages.forEach((msg: ChatMessage) => handleIncomingChatMessage(msg));
            }

            if (data.radioTransmissions && data.radioTransmissions.length > 0) {
              const latest = data.radioTransmissions[data.radioTransmissions.length - 1];
              setIncomingRadio(latest);
            }

            if (data.voiceSignals && Array.isArray(data.voiceSignals)) {
              data.voiceSignals.forEach((sig: any) => dispatchEvent('voice:signal', sig));
            }
          }
        }
      } catch (err: any) {
        if (mounted) {
          console.warn('[Sync] Poll error:', err.message);
        }
      } finally {
        if (mounted) {
          // Poll every 1s if match is active, 2s if in lobby with smart jitter to avoid concurrent stampedes
          const isMatchActive =
            roomStateRef.current?.state === 'ACTIVE' || roomStateRef.current?.state === 'RUNNER_HEADSTART';
          const baseInterval = isMatchActive ? 1000 : 2000;
          const jitter = Math.floor(Math.random() * 300);
          timer = setTimeout(pollSync, baseInterval + jitter);
        }
      }
    };

    pollSync();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [roomCode, applyRoomState, dispatchEvent, handleIncomingChatMessage]);

  // Join room on roomCode/playerId change with exponential backoff retry
  useEffect(() => {
    if (!roomCode || !playerId) return;
    let mounted = true;

    const doJoin = async (attempt: number = 1) => {
      const backendUrl = getBackendUrl();
      try {
        const res = await fetch(`${backendUrl}/api/room/${roomCode}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId,
            nickname: nickname || 'Operative',
          }),
        });
        const data = await res.json();
        if (mounted) {
          if (data.success && data.room) {
            applyRoomState(data.room);
            setRoomJoinError(null);
          } else {
            // Auto retry on room join error (up to 4 attempts) with exponential backoff
            if (attempt < 4) {
              const delay = attempt * 600;
              setTimeout(() => {
                if (mounted) doJoin(attempt + 1);
              }, delay);
            } else {
              setRoomJoinError(data.error || 'Failed to join room');
            }
          }
        }
      } catch (err: any) {
        if (mounted) {
          if (attempt < 4) {
            const delay = attempt * 600;
            setTimeout(() => {
              if (mounted) doJoin(attempt + 1);
            }, delay);
          } else {
            setRoomJoinError(err.message || 'Connection error joining room');
          }
        }
      }
    };

    doJoin();

    return () => {
      mounted = false;
    };
  }, [roomCode, playerId, nickname, applyRoomState]);


  // Universal dispatch method supporting both REST serverless actions and custom events
  const emit = useCallback(
    async (event: string, payload: any, callback?: (res: any) => void) => {
      const backendUrl = getBackendUrl();
      const code = payload?.roomCode || roomCodeRef.current;

      try {
        switch (event) {
          case 'room:create': {
            const res = await fetch(`${backendUrl}/api/room/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'room:join': {
            const res = await fetch(`${backendUrl}/api/room/${payload.roomCode}/join`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'room:leave': {
            const res = await fetch(`${backendUrl}/api/room/${payload.roomCode}/leave`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (callback) callback(data);
            return;
          }

          case 'team:assign': {
            const targetId = payload?.targetPlayerId || payload?.playerId;
            const targetTeam = payload?.team;
            if (targetId && targetTeam && roomStateRef.current) {
              const current = roomStateRef.current;
              const target = current.members[targetId];
              if (target) {
                const nextMembers = {
                  ...current.members,
                  [targetId]: {
                    ...target,
                    team: targetTeam,
                    role: targetTeam === 'RUNNERS' ? 'RUNNER' : targetTeam === 'CHASERS' ? 'CHASER' : (target.id === current.hostId ? 'HOST' : 'SPECTATOR'),
                  },
                };
                setRoomState({ ...current, members: nextMembers });
              }
            }

            const res = await fetch(`${backendUrl}/api/room/${code}/team/assign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'team:auto_assign': {
            const res = await fetch(`${backendUrl}/api/room/${code}/team/auto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'team:set_target_chasers': {
            if (payload?.targetCount && roomStateRef.current) {
              const current = roomStateRef.current;
              setRoomState({
                ...current,
                config: {
                  ...current.config,
                  targetChaserCount: Number(payload.targetCount),
                },
              });
            }

            const res = await fetch(`${backendUrl}/api/room/${code}/team/chasers`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }


          case 'player:set_ready':
          case 'player:ready': {
            const res = await fetch(`${backendUrl}/api/room/${code}/ready`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'player:set_role':
          case 'player:role': {
            const res = await fetch(`${backendUrl}/api/room/${code}/role`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'room:update_config':
          case 'config:update': {
            const res = await fetch(`${backendUrl}/api/room/${code}/config`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'room:update_play_zone': {
            const res = await fetch(`${backendUrl}/api/room/${code}/zone/update`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'zone:confirm': {
            const res = await fetch(`${backendUrl}/api/room/${code}/zone/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'bases:randomize': {
            const res = await fetch(`${backendUrl}/api/room/${code}/bases/randomize`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'exclusions:update': {
            const res = await fetch(`${backendUrl}/api/room/${code}/exclusions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'match:start': {
            const res = await fetch(`${backendUrl}/api/room/${code}/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'location:update': {
            const res = await fetch(`${backendUrl}/api/room/${code}/location`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success) {
              if (data.alert) setRecentAlert(data.alert);
              if (data.room) applyRoomState(data.room);
            }
            if (callback) callback(data);
            return;
          }

          case 'catch:request_code': {
            const res = await fetch(`${backendUrl}/api/room/${code}/catch/request`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (callback) callback(data);
            return;
          }

          case 'catch:attempt':
          case 'catch:attempt_code': {
            const res = await fetch(`${backendUrl}/api/room/${code}/catch/attempt`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'match:safety_pause': {
            const res = await fetch(`${backendUrl}/api/room/${code}/pause`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'match:resume': {
            const res = await fetch(`${backendUrl}/api/room/${code}/resume`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.room) applyRoomState(data.room);
            if (callback) callback(data);
            return;
          }

          case 'mission:answer_landmark': {
            const res = await fetch(`${backendUrl}/api/room/${code}/mission/clue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (callback) callback(data);
            return;
          }

          case 'chat:send': {
            const res = await fetch(`${backendUrl}/api/chat/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success && data.chatMessage) {
              handleIncomingChatMessage(data.chatMessage);
            }
            if (callback) callback(data);
            return;
          }

          case 'radio:transmit': {
            const res = await fetch(`${backendUrl}/api/radio/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (callback) callback(data);
            return;
          }

          case 'voice:signal': {
            await fetch(`${backendUrl}/api/voice/signal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (callback) callback({ success: true });
            return;
          }

          default:
            dispatchEvent(event, payload);
            if (callback) callback({ success: true });
        }
      } catch (err: any) {
        console.error(`Error emitting ${event}:`, err);
        if (callback) callback({ success: false, error: err.message });
      }
    },
    [applyRoomState, dispatchEvent, handleIncomingChatMessage]
  );

  // Synthetic socket adapter providing standard .on, .off, .emit interface for hooks like useVoice
  const socketAdapter = useRef({
    id: playerId || 'player-socket',
    connected: isConnected,
    on: (evt: string, fn: (data: any) => void) => addListener(evt, fn),
    off: (evt: string, fn: (data: any) => void) => removeListener(evt, fn),
    emit: (evt: string, data?: any, cb?: (res: any) => void) => emit(evt, data, cb),
  }).current;
  socketAdapter.connected = isConnected;
  socketAdapter.id = playerId || 'player-socket';

  const sendChatMessage = useCallback(
    (recipientTypeOrChannel: string, text: string, recipientId?: string) => {
      if (!roomCodeRef.current || !playerIdRef.current) return;
      emit('chat:send', {
        roomCode: roomCodeRef.current,
        senderId: playerIdRef.current,
        senderNickname: nicknameRef.current || 'Agent',
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

  const measurePing = useCallback(async () => {
    const start = performance.now();
    try {
      const res = await fetch(`${getBackendUrl()}/api/health`);
      if (res.ok) {
        const roundTrip = Math.round(performance.now() - start);
        setDiagnostics((prev) => ({ ...prev, latencyMs: roundTrip }));
        return roundTrip;
      }
    } catch {
      // Ignore
    }
    return -1;
  }, []);

  const leaveRoom = useCallback(async () => {
    if (!roomCode || !playerId) {
      setRoomState(null);
      return true;
    }
    return new Promise<boolean>((resolve) => {
      emit('room:leave', { roomCode, playerId }, (res: any) => {
        setRoomState(null);
        resolve(res?.success ?? true);
      });
    });
  }, [roomCode, playerId, emit]);

  const manualReconnect = useCallback(() => {
    setDiagnostics((prev) => ({ ...prev, status: 'CONNECTING', lastError: null }));
    measurePing().then((ms) => {
      if (ms >= 0) {
        setIsConnected(true);
        setDiagnostics((prev) => ({ ...prev, status: 'CONNECTED', latencyMs: ms }));
      }
    });
  }, [measurePing]);

  const requestCatchCode = useCallback(async (): Promise<{
    success: boolean;
    catchCode?: string;
    expiresAt?: number;
    error?: string;
  }> => {
    if (!roomCode || !playerId) return { success: false, error: 'Not connected' };
    return new Promise((resolve) => {
      emit('catch:request_code', { roomCode, runnerId: playerId }, (res: any) => {
        resolve(res || { success: false, error: 'No response from server' });
      });
    });
  }, [roomCode, playerId, emit]);

  const submitCatchCode = useCallback(
    async (
      targetRunnerId: string,
      catchCode: string
    ): Promise<{ success: boolean; error?: string; attempt?: any }> => {
      if (!roomCode || !playerId) return { success: false, error: 'Not connected' };
      return new Promise((resolve) => {
        emit(
          'catch:attempt_code',
          { roomCode, chaserId: playerId, targetRunnerId, catchCode },
          (res: any) => {
            resolve(res || { success: false, error: 'No response from server' });
          }
        );
      });
    },
    [roomCode, playerId, emit]
  );

  const answerLandmarkClue = useCallback(
    async (answer: string): Promise<{ success: boolean; completed?: boolean; error?: string }> => {
      if (!roomCode || !playerId) return { success: false, error: 'Not connected' };
      return new Promise((resolve) => {
        emit('mission:answer_landmark', { roomCode, runnerId: playerId, answer }, (res: any) => {
          resolve(res || { success: false, error: 'No response from server' });
        });
      });
    },
    [roomCode, playerId, emit]
  );

  return {
    socket: socketAdapter as any,
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
