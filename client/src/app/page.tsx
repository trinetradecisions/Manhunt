'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSocket } from '../hooks/useSocket';
import { useGeolocation } from '../hooks/useGeolocation';
import { useRadio } from '../hooks/useRadio';
import LobbyView from '../components/LobbyView';
import ActiveGameHUD from '../components/ActiveGameHUD';
import MatchResultsModal from '../components/MatchResultsModal';
import { PlayerRole } from '../types/game';

// Dynamic import of Leaflet map to prevent SSR window reference crashes
const TacticalMap = dynamic(() => import('../components/TacticalMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[300px] flex items-center justify-center bg-background text-neutral-500 text-xs font-mono">
      INITIALIZING SATELLITE RADAR...
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

  // Initialize or restore guest session
  useEffect(() => {
    let storedId = localStorage.getItem('manhunt_player_id');
    if (!storedId) {
      storedId = 'p_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('manhunt_player_id', storedId);
    }
    setPlayerId(storedId);

    const storedNick = localStorage.getItem('manhunt_nickname') || 'Operative_' + storedId.slice(-4);
    setNickname(storedNick);

    // Auto-detect room code from URL query parameter ?room=XXXXXX
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
  const { location, isStale, refreshGps } = useGeolocation({
    onLocationUpdate: (loc) => {
      if (roomCode && playerId) {
        emit('location:update', { roomCode, playerId, location: loc });
      }
    },
  });

  // Radio hook for push-to-talk voice
  const {
    isRecording,
    audioError,
    startRecording,
    stopRecording,
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
      <main className="min-h-screen bg-background text-neutral-100 flex flex-col justify-between p-6 max-w-md mx-auto">
        <div className="space-y-6 pt-8">
          {/* Brand Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 bg-surface-elevated/80 border border-neutral-700 px-3 py-1 rounded-full text-[11px] font-bold text-tactical-chaser uppercase tracking-wider">
              <span>●</span> Real-World GPS Pursuit
            </div>
            <h1 className="text-4xl font-black tracking-tight font-mono text-white">
              MANHUNT<span className="text-tactical-chaser">.WEB</span>
            </h1>
            <p className="text-xs text-neutral-400 max-w-xs mx-auto leading-relaxed">
              Step into the real world. Split into Runners and Chasers. Play timed GPS hide-and-seek with live radio.
            </p>
          </div>

          {errorMsg && (
            <div className="bg-tactical-danger/20 border border-tactical-danger text-tactical-danger p-3 rounded-xl text-xs font-semibold">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Player Nickname Card */}
          <div className="bg-surface border border-neutral-800 p-5 rounded-2xl shadow-xl space-y-3">
            <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider block">
              Operative Nickname
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter your nickname"
              className="w-full bg-surface-elevated border border-neutral-700 rounded-xl px-4 py-3 text-sm font-semibold text-white focus:outline-none focus:border-tactical-chaser transition-all"
            />
          </div>

          {/* Action Tabs: Create or Join */}
          <div className="space-y-3">
            <button
              onClick={handleCreateRoom}
              disabled={isCreating}
              className="w-full py-4 bg-tactical-chaser hover:brightness-110 active:scale-95 text-neutral-950 font-black rounded-2xl text-sm shadow-tactical-glow transition-all uppercase tracking-wider"
            >
              {isCreating ? 'Deploying Session...' : 'Create Private Game Room ⚡'}
            </button>

            <div className="flex items-center gap-3 my-3 text-xs text-neutral-500 uppercase tracking-widest font-mono">
              <span className="flex-1 border-t border-neutral-800" />
              <span>OR JOIN WITH CODE</span>
              <span className="flex-1 border-t border-neutral-800" />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="6-CHAR CODE"
                maxLength={6}
                className="flex-1 bg-surface border border-neutral-700 rounded-2xl px-4 py-3 text-center text-base font-black font-mono tracking-widest text-tactical-chaser focus:outline-none focus:border-tactical-chaser"
              />
              <button
                onClick={handleJoinRoom}
                className="px-6 py-3 bg-surface-elevated hover:bg-neutral-800 active:scale-95 text-neutral-100 font-bold rounded-2xl text-sm border border-neutral-700 transition-all"
              >
                Join
              </button>
            </div>
          </div>
        </div>

        {/* Footer Rules Note */}
        <div className="text-center text-[11px] text-neutral-500 py-4 space-y-1">
          <p>Requires browser GPS and microphone for tactical team radio.</p>
          <p className="text-neutral-600">Built for outdoor parks, campuses & safe open zones.</p>
        </div>
      </main>
    );
  }

  // 2. Active Game Screen: Lobby vs Pursuit vs Results
  const isInLobby = roomState.state === 'LOBBY' || roomState.state === 'READY_CHECK';
  const isMatchCompleted = roomState.state === 'COMPLETED';

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-background select-none">
      {/* Toast Alert Banner */}
      {recentAlert && (
        <div className="absolute top-3 left-4 right-4 z-[900] flex justify-center">
          <div
            className={`p-3.5 rounded-2xl shadow-2xl max-w-sm w-full border text-xs font-bold flex items-center justify-between ${
              recentAlert.type === 'SAFETY_PAUSE'
                ? 'bg-tactical-danger border-red-500 text-white'
                : recentAlert.type === 'BOUNDARY_WARNING'
                ? 'bg-tactical-danger/90 border-red-500 text-white animate-pulse'
                : 'bg-surface-elevated border-neutral-700 text-neutral-200'
            }`}
          >
            <div>
              <span className="block font-black text-sm">{recentAlert.title}</span>
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

      {/* Lobby View Screen */}
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
        /* Fullscreen Tactical Map View with Active HUD */
        <div className="relative w-full h-full">
          <TacticalMap
            playZone={roomState.config.playZone}
            myLocation={location}
            myRole={roomState.members[playerId]?.role || 'RUNNER'}
            members={roomState.members}
            myPlayerId={playerId}
            chaserPings={chaserPings}
          />

          <ActiveGameHUD
            roomState={roomState}
            myPlayerId={playerId}
            myLocation={location}
            isGpsStale={isStale}
            pendingCatch={pendingCatch}
            incomingRadio={incomingRadio}
            isRecordingRadio={isRecording}
            onStartRadio={startRecording}
            onStopRadio={stopRecording}
            onPlayRadio={(t) => playIncomingRadio(t, dismissRadio)}
            onDismissRadio={dismissRadio}
            onAttemptCatch={(targetRunnerId) =>
              emit('catch:attempt', {
                roomCode,
                chaserId: playerId,
                targetRunnerId,
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
