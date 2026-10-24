'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSocket } from '../hooks/useSocket';
import { useGeolocation } from '../hooks/useGeolocation';
import { useRadio } from '../hooks/useRadio';
import LobbyView from '../components/LobbyView';
import ActiveGameHUD from '../components/ActiveGameHUD';
import MatchResultsModal from '../components/MatchResultsModal';

// Dynamic import of TacticalMap (Leaflet + OpenStreetMap) to prevent SSR window reference crashes
const TacticalMap = dynamic(() => import('../components/TacticalMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[350px] flex items-center justify-center bg-background text-neutral-500 text-xs font-mono">
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

  // Initialize or restore guest session from localStorage
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
    if (queryRoom) {
      setInputCode(queryRoom.toUpperCase());
    }
  }, []);

  const {
    isConnected,
    roomState,
    recentAlert,
    pendingCatch,
    incomingRadio,
    chaserPings,
    clearAlert,
    dismissRadio,
    emit,
  } = useSocket(roomCode, playerId, nickname);

  // Geolocation hook with auto socket location broadcast
  const { location, isStale } = useGeolocation({
    onLocationUpdate: (loc) => {
      if (roomCode && playerId) {
        emit('location:update', { roomCode, playerId, location: loc });
      }
    },
  });

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

    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
    try {
      const res = await fetch(`${serverUrl}/api/room/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostPlayerId: playerId, nickname }),
      });
      const data = await res.json();
      if (data.success && data.room) {
        setRoomCode(data.room.roomCode);
      } else {
        setErrorMsg(data.error || 'Failed to create room');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error connecting to backend server');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = () => {
    if (!inputCode.trim()) return;
    localStorage.setItem('manhunt_nickname', nickname);
    setRoomCode(inputCode.trim().toUpperCase());
  };

  // 1. Landing View (Create / Join Game)
  if (!roomState) {
    return (
      <main className="min-h-screen bg-background text-neutral-100 flex flex-col justify-between p-5 max-w-md mx-auto select-none">
        <div className="space-y-6 pt-6">
          {/* Tactical Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 bg-surface-elevated/90 border border-neutral-700/80 px-3 py-1 rounded-full text-[10px] font-bold text-tactical-chaser uppercase tracking-widest shadow">
              <span className="w-2 h-2 rounded-full bg-tactical-chaser animate-pulse" />
              Outdoor Real-World Pursuit
            </div>
            <h1 className="text-4xl font-black tracking-tight font-mono text-white">
              MANHUNT<span className="text-tactical-chaser">.WEB</span>
            </h1>
            <p className="text-xs text-neutral-400 max-w-xs mx-auto leading-relaxed">
              Step outdoors with your phone. Evade chasers across a live GPS zone with tactical walkie-talkie radio.
            </p>
          </div>

          {errorMsg && (
            <div className="bg-tactical-danger/20 border border-tactical-danger text-tactical-danger p-3 rounded-2xl text-xs font-semibold">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Nickname Input Card */}
          <div className="bg-surface border border-neutral-800 p-5 rounded-3xl shadow-2xl space-y-2.5">
            <label className="text-[11px] font-black text-neutral-400 uppercase tracking-widest block">
              Operative Call-Sign
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter your call-sign"
              className="w-full bg-surface-elevated border border-neutral-700 rounded-2xl px-4 py-3 text-sm font-semibold text-white focus:outline-none focus:border-tactical-chaser transition-all shadow-inner"
            />
          </div>

          {/* Actions: Create & Join */}
          <div className="space-y-3.5">
            <button
              onClick={handleCreateRoom}
              disabled={isCreating}
              className="w-full py-4 bg-tactical-chaser hover:brightness-110 active:scale-95 text-neutral-950 font-black rounded-2xl text-xs shadow-tactical-glow transition-all uppercase tracking-wider"
            >
              {isCreating ? 'Deploying Session...' : 'Create Private Game Room ⚡'}
            </button>

            <div className="flex items-center gap-3 my-2 text-[10px] text-neutral-500 uppercase tracking-widest font-mono">
              <span className="flex-1 border-t border-neutral-800" />
              <span>OR ENTER CODE</span>
              <span className="flex-1 border-t border-neutral-800" />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="6-CHAR CODE"
                maxLength={6}
                className="flex-1 bg-surface border border-neutral-700 rounded-2xl px-4 py-3 text-center text-base font-black font-mono tracking-widest text-tactical-chaser focus:outline-none focus:border-tactical-chaser shadow-inner"
              />
              <button
                onClick={handleJoinRoom}
                className="px-6 py-3 bg-surface-elevated hover:bg-neutral-800 active:scale-95 text-neutral-100 font-bold rounded-2xl text-xs border border-neutral-700 transition-all shadow"
              >
                Join
              </button>
            </div>
          </div>
        </div>

        {/* Footer Guidance */}
        <div className="text-center text-[10px] text-neutral-500 py-4 space-y-1">
          <p>Requires browser GPS and microphone permissions.</p>
          <p className="text-neutral-600">Built for outdoor parks, campuses & safe open zones.</p>
        </div>
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
            className={`p-3.5 rounded-2xl shadow-2xl max-w-sm w-full border text-xs font-bold flex items-center justify-between ${
              recentAlert.type === 'SAFETY_PAUSE'
                ? 'bg-tactical-danger border-red-500 text-white animate-bounce'
                : recentAlert.type === 'BOUNDARY_WARNING'
                ? 'bg-tactical-danger/90 border-red-500 text-white animate-pulse'
                : 'bg-surface-elevated border-neutral-700 text-neutral-200'
            }`}
          >
            <div>
              <span className="block font-black text-xs uppercase">{recentAlert.title}</span>
              <span className="text-[11px] font-normal">{recentAlert.message}</span>
            </div>
            <button
              onClick={clearAlert}
              className="text-xs px-2 py-1 text-white/70 hover:text-white"
            >
              ✕
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
          onUpdateConfig={(config) =>
            emit('room:update_config', { roomCode, requesterId: playerId, config })
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
        />
      ) : (
        /* Fullscreen Interactive Leaflet Tactical Map & HUD */
        <div className="relative w-full h-full">
          <TacticalMap
            playZone={roomState.config.playZone}
            myLocation={location}
            myRole={roomState.members[playerId]?.role || 'RUNNER'}
            members={roomState.members}
            myPlayerId={playerId}
            isGpsStale={isStale}
            chaserPings={chaserPings}
          />

          <ActiveGameHUD
            roomState={roomState}
            myPlayerId={playerId}
            myLocation={location}
            isGpsStale={isStale}
            pendingCatch={pendingCatch}
            incomingRadio={incomingRadio}
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
    </div>
  );
}
