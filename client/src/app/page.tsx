'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  Crosshair,
  Radio,
  Zap,
  Shield,
  Users,
  Compass,
  Wifi,
  WifiOff,
  AlertTriangle,
  AlertOctagon,
  Info,
  X,
  ArrowRight,
} from 'lucide-react';
import { useSocket } from '../hooks/useSocket';
import { useGeolocation } from '../hooks/useGeolocation';
import { useRadio } from '../hooks/useRadio';
import { useVoice } from '../hooks/useVoice';
import { PlayerRole, PlayerTeam } from '../types/game';
import LobbyView from '../components/LobbyView';
import ActiveGameHUD from '../components/ActiveGameHUD';
import MatchResultsModal from '../components/MatchResultsModal';
import DevDiagnosticsPanel from '../components/DevDiagnosticsPanel';
import HeadStartCountdownOverlay from '../components/HeadStartCountdownOverlay';
import TacticalChatDrawer from '../components/TacticalChatDrawer';
import { getBackendUrl } from '../utils/networkConfig';


// Dynamic import of TacticalMap (Leaflet + OpenStreetMap) to prevent SSR window reference crashes
const TacticalMap = dynamic(() => import('../components/TacticalMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[350px] flex items-center justify-center bg-[#0F1923] text-neutral-500 text-xs font-mono">
      INITIALIZING TACTICAL RADAR MAP...
    </div>
  ),
});

export default function Home() {
  const [playerId, setPlayerId] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [inputCode, setInputCode] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);

  // Initialize or restore guest session from localStorage & URL
  useEffect(() => {
    let storedId = localStorage.getItem('manhunt_player_id');
    if (!storedId) {
      storedId = 'p_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('manhunt_player_id', storedId);
    }
    setPlayerId(storedId);

    const storedNick =
      localStorage.getItem('manhunt_nickname') || 'Operative_' + storedId.slice(-4);
    setNickname(storedNick);

    const params = new URLSearchParams(window.location.search);
    const queryRoom = params.get('room');
    const storedActiveRoom = localStorage.getItem('manhunt_active_room_code');

    const roomToRestore = (queryRoom || storedActiveRoom || '').trim().toUpperCase();
    if (roomToRestore) {
      setInputCode(roomToRestore);
      setRoomCode(roomToRestore);
      setIsRestoringSession(true);
    } else {
      setIsRestoringSession(false);
    }
  }, []);

  const {
    socket,
    isConnected,
    roomState,
    roomJoinError,
    recentAlert,
    pendingCatch,
    incomingRadio,
    scheduledSnapshot,
    chaserPings,
    chatMessages,
    channelMessages,
    unreadChatCount,
    unreadByChannel,
    activeChatChannel,
    selectChatChannel,
    sendChatMessage,
    markChatRead,
    diagnostics: socketDiagnostics,
    measurePing,
    manualReconnect,
    leaveRoom,
    requestCatchCode,
    submitCatchCode,
    answerLandmarkClue,
    clearAlert,
    dismissRadio,
    emit,
  } = useSocket(roomCode, playerId, nickname);

  // Synchronize active session state and clear restoration loader
  useEffect(() => {
    if (roomState) {
      setIsRestoringSession(false);
      localStorage.setItem('manhunt_active_room_code', roomState.roomCode);
    }
  }, [roomState]);

  // Handle room join error (e.g. room closed or expired)
  useEffect(() => {
    if (roomJoinError) {
      setIsRestoringSession(false);
      localStorage.removeItem('manhunt_active_room_code');
      setErrorMsg(`Session expired or room unavailable: ${roomJoinError}`);
      setRoomCode('');
    }
  }, [roomJoinError]);

  // Real WebRTC Push-to-Talk Voice hook
  const voice = useVoice({
    socket,
    roomCode,
    playerId,
    myNickname: nickname,
  });

  // Geolocation hook with auto socket location broadcast and one-shot diagnostics
  const {
    location,
    gpsStatus,
    errorMessage: gpsErrorMessage,
    isStale,
    accuracy: gpsAccuracy,
    lastFixTimestamp,
    isSecureContext,
    requestLocationAccess,
    browserPermissionState,
    oneShotGps,
    requestOneShotGps,
  } = useGeolocation({
    autoStart: true,
    onLocationUpdate: (loc) => {
      if (roomCode && playerId) {
        emit('location:update', { roomCode, playerId, location: loc });
      }
    },
  });

  // Auto-center play zone on Host's actual GPS when first acquired (replaces London placeholder)
  const hasAutoCenteredHostRef = useRef(false);
  useEffect(() => {
    if (
      location &&
      roomState &&
      roomState.members[playerId]?.role === 'HOST' &&
      roomState.state === 'LOBBY' &&
      roomState.config.playZone.centerLat === 51.5074 &&
      !hasAutoCenteredHostRef.current
    ) {
      hasAutoCenteredHostRef.current = true;
      emit('room:update_config', {
        roomCode,
        requesterId: playerId,
        config: {
          playZone: {
            ...roomState.config.playZone,
            centerLat: location.latitude,
            centerLng: location.longitude,
          },
        },
      });
    }
  }, [location, roomState, playerId, roomCode, emit]);

  // Upgraded Radio hook with pre-send review & cancellation
  const {
    recordingState,
    recordingElapsedSeconds,
    previewAudioUrl,
    isPlayingPreview,
    audioError,
    startRecording,
    stopRecording,
    cancelRecording,
    sendRecording,
    playPreviewAudio,
    stopPreviewAudio,
    playIncomingRadio,
    triggerVibration,
  } = useRadio({ roomCode, senderId: playerId });

  // Trigger vibration when incoming radio alert arrives
  useEffect(() => {
    if (incomingRadio) {
      triggerVibration();
    }
  }, [incomingRadio, triggerVibration]);

  const handleCreateRoom = async () => {
    setIsCreating(true);
    setErrorMsg(null);
    localStorage.setItem('manhunt_nickname', nickname);

    const serverUrl = getBackendUrl();

    // If socket is connected, try creating room directly over socket
    if (isConnected) {
      emit('room:create', { hostPlayerId: playerId, nickname }, (res: any) => {
        setIsCreating(false);
        if (res?.success && res.room) {
          localStorage.setItem('manhunt_active_room_code', res.room.roomCode);
          setRoomCode(res.room.roomCode);
        } else {
          setErrorMsg(res?.error || 'Failed to create room via socket');
        }
      });
      return;
    }

    // Otherwise use REST endpoint with clear error handling
    try {
      const res = await fetch(`${serverUrl}/api/room/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostPlayerId: playerId, nickname }),
      });
      const data = await res.json();
      if (data.success && data.room) {
        localStorage.setItem('manhunt_active_room_code', data.room.roomCode);
        setRoomCode(data.room.roomCode);
      } else {
        setErrorMsg(data.error || 'Failed to create room');
      }
    } catch {
      setErrorMsg(
        `Backend server unreachable at ${serverUrl}. Is the backend running? Run 'cd server; npm run dev'`
      );
    } finally {
      setIsCreating(false);
    }
  };

  const [showSensorBriefing, setShowSensorBriefing] = useState<boolean>(false);

  const handleJoinRoom = () => {
    const trimmed = inputCode.trim().toUpperCase();
    if (!trimmed) {
      setErrorMsg('Please enter a 6-character room code.');
      return;
    }
    if (trimmed.length !== 6) {
      setErrorMsg('Room codes must be exactly 6 characters.');
      return;
    }
    if (!nickname.trim() || nickname.trim().length < 2) {
      setErrorMsg('Call-sign must be at least 2 characters.');
      return;
    }
    setErrorMsg(null);
    localStorage.setItem('manhunt_nickname', nickname.trim());
    localStorage.setItem('manhunt_active_room_code', trimmed);
    setRoomCode(trimmed);
  };

  // 0. Mission Restoration Loading Screen (shown during page refresh / session reconnect)
  if (isRestoringSession && !roomState) {
    return (
      <main className="min-h-screen bg-[#0F1923] text-neutral-100 flex flex-col items-center justify-center p-5 select-none font-mono">
        <div className="bg-[#1F2731] border border-[#3B4652] rounded-3xl p-8 max-w-sm w-full text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-[#FF4655]/20 border border-[#FF4655] mx-auto flex items-center justify-center text-[#FF4655] shadow-tactical-glow">
            <Crosshair className="w-9 h-9 animate-spin" style={{ animationDuration: '4s' }} />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#4CC38A] block mb-1">
              Mission Session Active
            </span>
            <h2 className="text-xl font-black uppercase text-white tracking-wider">
              Restoring Mission
            </h2>
            <p className="text-xs text-[#A8B0BA] mt-1.5 leading-relaxed">
              Reconnecting operative session to room{' '}
              <strong className="text-[#FF4655] tracking-widest font-mono">{roomCode}</strong>...
            </p>
          </div>
          <div className="w-full bg-[#293440] h-2 rounded-full overflow-hidden border border-[#3B4652]">
            <div className="bg-gradient-to-r from-[#39BDE8] via-[#4CC38A] to-[#FF4655] h-full w-3/4 animate-pulse" />
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('manhunt_active_room_code');
              setRoomCode('');
              setIsRestoringSession(false);
            }}
            className="text-xs text-[#A8B0BA] hover:text-white underline pt-1 block mx-auto transition-colors"
          >
            Cancel & Return to Base
          </button>
        </div>
      </main>
    );
  }

  // 1. Landing View (Create / Join Game)
  if (!roomState) {
    return (
      <main className="min-h-screen bg-[#0F1923] text-neutral-100 flex flex-col items-center justify-between p-4 sm:p-6 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] max-w-md w-full mx-auto select-none">
        <div className="w-full space-y-5">
          {/* Tactical Header */}
          <div className="text-center space-y-2.5 pt-2">
            <div className="inline-flex items-center gap-2 bg-[#1F2731] border border-[#3B4652] px-3.5 py-1 rounded-full text-[11px] font-mono font-bold text-[#4CC38A] uppercase tracking-widest shadow-sm">
              <span className="w-2 h-2 rounded-full bg-[#4CC38A] animate-pulse" />
              <span>Real-World GPS Pursuit</span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-black tracking-tight font-mono text-white flex items-center justify-center gap-2">
              <Crosshair className="w-8 h-8 text-[#FF4655] inline-block" />
              <span>MANHUNT</span>
            </h1>

            <p className="text-xs text-[#A8B0BA] max-w-xs mx-auto leading-relaxed">
              Step outdoors with your phone. Evade chasers across a live GPS zone with tactical walkie-talkie squad radio.
            </p>
          </div>

          {/* Connection Status Pill */}
          <div className="flex items-center justify-center gap-2">
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono border ${
                isConnected
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-[#4CC38A]'
                  : 'bg-amber-950/40 border-amber-800/60 text-amber-400'
              }`}
            >
              {isConnected ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3 animate-pulse" />
              )}
              <span>
                {isConnected ? 'TACTICAL NETWORK CONNECTED' : 'CONNECTING TO SERVER...'}
              </span>
            </div>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="bg-[#FF4655]/15 border border-[#FF4655]/60 text-[#FF4655] p-3.5 rounded-2xl text-xs font-semibold flex items-start gap-2.5 shadow-lg">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 text-[11px] leading-snug">{errorMsg}</div>
              <button
                onClick={() => setErrorMsg(null)}
                className="text-[#A8B0BA] hover:text-white text-xs"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Nickname Input Card */}
          <div className="bg-[#1F2731] border border-[#3B4652] p-4.5 rounded-3xl shadow-2xl space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black text-[#A8B0BA] uppercase tracking-widest flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-neutral-400" />
                <span>Operative Call-Sign</span>
              </label>
              <span className="text-[10px] text-[#A8B0BA] font-mono">2-16 chars</span>
            </div>
            <input
              type="text"
              value={nickname}
              maxLength={16}
              onChange={(e) => {
                const val = e.target.value.replace(/[^a-zA-Z0-9_\-\s]/g, '');
                setNickname(val);
              }}
              placeholder="e.g. Ghost_01"
              className="w-full h-12 min-h-[48px] bg-[#293440] border border-[#3B4652] rounded-2xl px-4 py-3 text-sm font-semibold text-white focus:outline-none focus:border-[#FF4655] transition-all shadow-inner placeholder:text-neutral-500"
            />
          </div>

          {/* Primary Actions: Create Room & Join Room */}
          <div className="space-y-3">
            <button
              onClick={handleCreateRoom}
              disabled={isCreating}
              className="w-full h-12 min-h-[48px] bg-[#FF4655] hover:brightness-110 active:scale-98 text-white font-black rounded-2xl text-xs shadow-tactical-glow transition-all uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isCreating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Deploying Tactical Room...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-current" />
                  <span>Create Private Room</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-3 my-2 text-[10px] text-[#A8B0BA] uppercase tracking-widest font-mono">
              <span className="flex-1 border-t border-[#3B4652]" />
              <span>OR JOIN WITH CODE</span>
              <span className="flex-1 border-t border-[#3B4652]" />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={inputCode}
                onChange={(e) =>
                  setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                }
                placeholder="6-CHAR CODE"
                maxLength={6}
                className="flex-1 min-w-0 h-12 min-h-[48px] bg-[#1F2731] border border-[#3B4652] rounded-2xl px-3 sm:px-4 text-center text-sm sm:text-base font-black font-mono tracking-widest text-[#FF4655] focus:outline-none focus:border-[#FF4655] shadow-inner placeholder:text-neutral-500"
              />
              <button
                onClick={handleJoinRoom}
                className="h-12 min-h-[48px] px-5 sm:px-6 bg-[#293440] hover:bg-[#3B4652] active:scale-95 text-white font-bold rounded-2xl text-xs border border-[#3B4652] transition-all shadow flex items-center gap-1.5 shrink-0"
              >
                <span>Join</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Tactical Game Briefing Card */}
          <div className="bg-[#1F2731] border border-[#3B4652] rounded-2xl p-3.5 space-y-2 text-[11px] text-[#ECE8E1]">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-[10px] uppercase text-[#A8B0BA] tracking-wider flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-[#A8B0BA]" />
                Match Protocol
              </span>
              <button
                onClick={() => setShowSensorBriefing(true)}
                className="text-[10px] text-[#4CC38A] hover:underline font-mono flex items-center gap-1"
              >
                <Info className="w-3 h-3" />
                Sensors & Privacy
              </button>
            </div>
            <ul className="space-y-1.5 text-[#A8B0BA] text-[11px]">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4CC38A] mt-1.5 shrink-0" />
                <span>
                  <strong className="text-white">Host</strong> establishes the outdoor play-zone radius.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#39BDE8] mt-1.5 shrink-0" />
                <span>
                  <strong className="text-[#39BDE8]">Runners</strong> receive a countdown head start to disperse.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF4655] mt-1.5 shrink-0" />
                <span>
                  <strong className="text-[#FF4655]">Chasers</strong> hunt via GPS radar pings and proximity tags.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] mt-1.5 shrink-0" />
                <span>
                  <strong className="text-white">Squad Radio</strong> delivers encrypted push-to-talk voice comms.
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer Guidance */}
        <div className="text-center text-[10px] text-neutral-500 py-3 space-y-1">
          <p>Requires device GPS and microphone access.</p>
          <p className="text-neutral-600">Built for outdoor parks, campuses & safe open zones.</p>
        </div>

        {/* Sensor Briefing Modal */}
        {showSensorBriefing && (
          <div className="fixed inset-0 z-[800] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-surface border border-neutral-700 w-full max-w-sm rounded-3xl p-5 text-left shadow-2xl space-y-3.5">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-tactical-lime" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-white">
                    Sensor Requirements & Privacy
                  </h3>
                </div>
                <button
                  onClick={() => setShowSensorBriefing(false)}
                  className="text-neutral-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5 text-xs text-neutral-300 leading-relaxed">
                <div>
                  <h4 className="font-bold text-neutral-100 flex items-center gap-1.5 text-[11px] mb-1">
                    <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
                    GPS Geolocation
                  </h4>
                  <p className="text-[11px] text-neutral-400">
                    High-accuracy GPS positions you within the match boundary and calculates proximity tags. Coordinates are transmitted only to your active room over secure WebSockets during live play and are never stored or logged permanently.
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-neutral-100 flex items-center gap-1.5 text-[11px] mb-1">
                    <Radio className="w-3.5 h-3.5 text-tactical-radio" />
                    Microphone Access
                  </h4>
                  <p className="text-[11px] text-neutral-400">
                    Used strictly when you hold the team radio button to broadcast tactical voice clips to your teammates. Microphones are automatically released as soon as recording completes.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowSensorBriefing(false)}
                className="w-full py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider"
              >
                Understood
              </button>
            </div>
          </div>
        )}

        {/* Development-Only Diagnostics Panel */}
        <DevDiagnosticsPanel
          oneShotGps={oneShotGps}
          onRequestOneShotGps={requestOneShotGps}
          activeLocation={location}
          gpsStatus={gpsStatus}
          browserPermissionState={browserPermissionState}
          isGpsStale={isStale}
          gpsErrorMessage={gpsErrorMessage}
          socketDiagnostics={socketDiagnostics}
          onMeasurePing={measurePing}
          onManualReconnect={manualReconnect}
          roomCode={roomCode}
          playerId={playerId}
        />
      </main>
    );
  }

  // 2. Active Session Screen
  const isInLobby = roomState.state === 'LOBBY' || roomState.state === 'READY_CHECK';
  const isMatchCompleted = roomState.state === 'COMPLETED';

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-background select-none">
      {/* Toast Alert Banner */}
      {recentAlert && (
        <div className="absolute top-3 left-4 right-4 z-[900] flex justify-center pointer-events-auto">
          <div
            className={`p-3.5 rounded-2xl shadow-2xl max-w-sm w-full border text-xs font-bold flex items-center justify-between gap-3 ${
              recentAlert.type === 'SAFETY_PAUSE'
                ? 'bg-tactical-danger border-red-500 text-white animate-pulse'
                : recentAlert.type === 'BOUNDARY_WARNING'
                ? 'bg-tactical-danger/95 border-red-500 text-white'
                : 'bg-surface border-neutral-700 text-neutral-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {recentAlert.type === 'SAFETY_PAUSE' ? (
                <AlertOctagon className="w-5 h-5 text-white shrink-0" />
              ) : recentAlert.type === 'BOUNDARY_WARNING' ? (
                <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0" />
              ) : (
                <Info className="w-5 h-5 text-tactical-lime shrink-0" />
              )}
              <div>
                <span className="block font-black text-xs uppercase tracking-wide">{recentAlert.title}</span>
                <span className="text-[11px] font-normal opacity-90">{recentAlert.message}</span>
              </div>
            </div>
            <button
              onClick={clearAlert}
              className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Viewport Router: Lobby vs Tactical Game Map */}
      {isInLobby ? (
        <LobbyView
          roomState={roomState}
          myPlayerId={playerId}
          myLocation={location}
          gpsStatus={gpsStatus}
          gpsAccuracy={gpsAccuracy}
          lastFixTimestamp={lastFixTimestamp}
          gpsErrorMessage={gpsErrorMessage}
          isSecureContext={isSecureContext}
          onRequestLocationAccess={requestLocationAccess}
          socket={socket}
          onUpdateConfig={(config) =>
            emit('room:update_config', { roomCode, requesterId: playerId, config })
          }
          onUpdatePlayZone={(playZone) =>
            emit('room:update_play_zone', {
              roomCode,
              requesterId: playerId,
              playZone,
            })
          }
          onAssignTeam={(targetPlayerId, team) =>
            emit('team:assign', {
              roomCode,
              requesterId: playerId,
              hostPlayerId: playerId,
              targetPlayerId,
              team,
            })
          }
          onSetTargetChasers={(count) =>
            emit('team:set_target_chasers', {
              roomCode,
              requesterId: playerId,
              hostPlayerId: playerId,
              targetCount: count,
            })
          }
          onAutoAssignTeams={() =>
            emit('team:auto_assign', {
              roomCode,
              requesterId: playerId,
              hostPlayerId: playerId,
            })
          }
          onSetRole={(targetPlayerId, role) =>
            emit('player:set_role', {
              roomCode,
              requesterId: playerId,
              targetPlayerId,
              role,
            })
          }
          onToggleReady={(ready) =>
            emit('player:set_ready', {
              roomCode,
              playerId,
              ready,
              gpsStatus: location ? 'GRANTED' : 'PROMPT',
            })
          }
          onStartMatch={() =>
            emit('match:start', { roomCode, initiatorId: playerId })
          }
          chatMessages={chatMessages}
          channelMessages={channelMessages}
          activeChatChannel={activeChatChannel}
          unreadByChannel={unreadByChannel}
          onSelectChatChannel={selectChatChannel}
          onSendMessage={sendChatMessage}
          onMarkChatRead={markChatRead}
          voice={voice}
          onLeaveRoom={async () => {
            await leaveRoom();
            localStorage.removeItem('manhunt_active_room_code');
            setRoomCode('');
          }}
        />
      ) : (
        /* Fullscreen Interactive Leaflet Tactical Map & HUD */
        <div className="relative w-full h-full">
          {/* Full-Screen Head-Start Countdown Overlay */}
          {roomState.state === 'RUNNER_HEADSTART' && (
            <HeadStartCountdownOverlay
              roomState={roomState}
              myPlayerId={playerId}
            />
          )}

          <TacticalMap
            playZone={roomState.config.playZone}
            myLocation={location}
            myRole={roomState.members[playerId]?.role || 'RUNNER'}
            members={roomState.members}
            myPlayerId={playerId}
            gpsStatus={gpsStatus}
            gpsErrorMessage={gpsErrorMessage}
            isGpsStale={isStale}
            dynamicZoneState={roomState.match?.dynamicZoneState}
            dynamicZoneConfig={roomState.config.dynamicZone}
            chaserPings={chaserPings}
            activeMission={roomState.match?.activeMissions?.[playerId]}
          />

          <ActiveGameHUD
            roomState={roomState}
            myPlayerId={playerId}
            myLocation={location}
            isGpsStale={isStale}
            gpsStatus={gpsStatus}
            gpsAccuracy={gpsAccuracy}
            lastFixTimestamp={lastFixTimestamp}
            gpsErrorMessage={gpsErrorMessage}
            isSecureContext={isSecureContext}
            onRequestLocationAccess={requestLocationAccess}
            pendingCatch={pendingCatch}
            incomingRadio={incomingRadio}
            scheduledSnapshot={scheduledSnapshot}
            unreadChatCount={unreadChatCount}
            voice={voice}
            socket={socket}
            onLeaveRoom={async () => {
              await leaveRoom();
              localStorage.removeItem('manhunt_active_room_code');
              setRoomCode('');
            }}
            onOpenChat={() => {
              setIsChatOpen(true);
              markChatRead(true);
            }}
            radioRecordingState={recordingState}
            radioElapsedSeconds={recordingElapsedSeconds}
            radioPreviewUrl={previewAudioUrl}
            isPlayingPreview={isPlayingPreview}
            radioError={audioError}
            onStartRadio={startRecording}
            onStopRadio={stopRecording}
            onCancelRadio={cancelRecording}
            onSendRadio={sendRecording}
            onPlayPreview={playPreviewAudio}
            onStopPreview={stopPreviewAudio}
            onPlayIncomingRadio={(t) => playIncomingRadio(t, dismissRadio)}
            onDismissIncomingRadio={dismissRadio}
            onAttemptCatch={(targetRunnerId) =>
              emit('catch:attempt', {
                roomCode,
                chaserId: playerId,
                targetRunnerId,
              })
            }
            onRequestCatchCode={requestCatchCode}
            onSubmitCatchCode={submitCatchCode}
            onAnswerLandmarkClue={answerLandmarkClue}
            onAttemptCatchWithCode={(targetRunnerId, catchCode) =>
              emit('catch:attempt_code', {
                roomCode,
                chaserId: playerId,
                targetRunnerId,
                catchCode,
              })
            }
            onRespondCatch={(attemptId, response) =>
              emit('catch:respond', { attemptId, runnerId: playerId, response })
            }
            onSafetyPause={() =>
              emit('match:safety_pause', {
                roomCode,
                initiatorId: playerId,
                reason: 'Safety pause requested by operative.',
              })
            }
            onResumeMatch={() =>
              emit('match:resume', { roomCode, initiatorId: playerId })
            }
          />

          {/* Tactical In-Game Comms Drawer */}
          <TacticalChatDrawer
            isOpen={isChatOpen}
            onClose={() => {
              setIsChatOpen(false);
              markChatRead(false);
            }}
            roomState={roomState}
            myPlayerId={playerId}
            messages={chatMessages}
            channelMessages={channelMessages}
            activeChatChannel={activeChatChannel}
            unreadByChannel={unreadByChannel}
            onSelectChatChannel={selectChatChannel}
            onSendMessage={sendChatMessage}
          />
        </div>
      )}

      {/* Match Results Victory Modal */}
      {isMatchCompleted && (
        <MatchResultsModal
          roomState={roomState}
          myPlayerId={playerId}
          onRematch={() =>
            emit('room:update_config', {
              roomCode,
              requesterId: playerId,
              config: {},
            })
          }
        />
      )}

      {/* Development-Only Diagnostics Panel */}
      <DevDiagnosticsPanel
        oneShotGps={oneShotGps}
        onRequestOneShotGps={requestOneShotGps}
        activeLocation={location}
        gpsStatus={gpsStatus}
        browserPermissionState={browserPermissionState}
        isGpsStale={isStale}
        gpsErrorMessage={gpsErrorMessage}
        socketDiagnostics={socketDiagnostics}
        onMeasurePing={measurePing}
        onManualReconnect={manualReconnect}
        roomCode={roomCode}
        playerId={playerId}
      />
    </div>
  );
}
