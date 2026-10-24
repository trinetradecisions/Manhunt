'use client';

import { useState } from 'react';
import {
  RoomState,
  PlayerLocation,
  CatchAttempt,
  RadioTransmission,
} from '../types/game';
import { RadioRecordingState } from '../hooks/useRadio';

interface ActiveGameHUDProps {
  roomState: RoomState;
  myPlayerId: string;
  myLocation: PlayerLocation | null;
  isGpsStale: boolean;
  pendingCatch: CatchAttempt | null;
  incomingRadio: RadioTransmission | null;
  // Radio controls
  radioRecordingState: RadioRecordingState;
  radioElapsedSeconds: number;
  radioPreviewUrl: string | null;
  isPlayingPreview: boolean;
  radioError: string | null;
  onStartRadio: () => void;
  onStopRadio: () => void;
  onCancelRadio: () => void;
  onSendRadio: () => void;
  onPlayPreview: () => void;
  onStopPreview: () => void;
  onPlayIncomingRadio: (t: RadioTransmission) => void;
  onDismissIncomingRadio: () => void;
  // Catch & Pause controls
  onAttemptCatch: (targetRunnerId: string) => void;
  onAttemptCatchWithCode: (targetRunnerId: string, catchCode: string) => void;
  onRespondCatch: (attemptId: string, response: 'CONFIRM' | 'DISPUTE') => void;
  onSafetyPause: () => void;
  onResumeMatch: () => void;
}

export default function ActiveGameHUD({
  roomState,
  myPlayerId,
  myLocation,
  isGpsStale,
  pendingCatch,
  incomingRadio,
  radioRecordingState,
  radioElapsedSeconds,
  radioPreviewUrl,
  isPlayingPreview,
  radioError,
  onStartRadio,
  onStopRadio,
  onCancelRadio,
  onSendRadio,
  onPlayPreview,
  onStopPreview,
  onPlayIncomingRadio,
  onDismissIncomingRadio,
  onAttemptCatch,
  onAttemptCatchWithCode,
  onRespondCatch,
  onSafetyPause,
  onResumeMatch,
}: ActiveGameHUDProps) {
  const [showTagModal, setShowTagModal] = useState(false);
  const [selectedRunnerId, setSelectedRunnerId] = useState<string>('');
  const [enteredCatchCode, setEnteredCatchCode] = useState<string>('');
  const [tagError, setTagError] = useState<string | null>(null);

  const myMember = roomState.members[myPlayerId];
  const isHostOrReferee = myMember?.role === 'HOST' || myMember?.role === 'REFEREE';
  const isChaser = myMember?.team === 'CHASERS';
  const isRunner = myMember?.team === 'RUNNERS';

  const remainingSeconds = roomState.match?.remainingSeconds ?? 0;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;

  const uncaughtRunners = Object.values(roomState.members).filter(
    (m) => m.team === 'RUNNERS' && !m.isCaught
  );

  const handleClaimTagWithCode = () => {
    if (!selectedRunnerId) {
      setTagError('Please select a runner.');
      return;
    }
    if (enteredCatchCode.length !== 4) {
      setTagError('Catch code must be exactly 4 digits.');
      return;
    }
    setTagError(null);
    onAttemptCatchWithCode(selectedRunnerId, enteredCatchCode);
    setShowTagModal(false);
    setEnteredCatchCode('');
  };

  return (
    <>
      {/* Top Floating Command HUD */}
      <div className="absolute top-3 left-3 right-3 z-[450] flex items-center justify-between pointer-events-none">
        {/* Match Clock & Tactical Status */}
        <div className="bg-surface/95 backdrop-blur-md border border-neutral-700/80 px-3.5 py-1.5 rounded-2xl shadow-xl flex items-center gap-3 pointer-events-auto">
          <div className="flex flex-col">
            <span className="text-[9px] uppercase font-bold tracking-widest text-neutral-400">
              {roomState.state === 'RUNNER_HEADSTART'
                ? 'Head Start'
                : roomState.state === 'SAFETY_PAUSED'
                ? 'SAFETY PAUSED'
                : 'Match Clock'}
            </span>
            <span className="text-xl font-black font-mono tracking-tight text-white">
              {timeFormatted}
            </span>
          </div>

          <div
            className={`w-2.5 h-2.5 rounded-full ${
              roomState.state === 'ACTIVE'
                ? 'bg-tactical-chaser animate-ping'
                : roomState.state === 'RUNNER_HEADSTART'
                ? 'bg-tactical-runner'
                : 'bg-tactical-danger'
            }`}
          />
        </div>

        {/* GPS Health Indicator & Emergency Controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* GPS Accuracy Pill */}
          <div
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 shadow-md ${
              isGpsStale
                ? 'bg-tactical-danger/20 border-tactical-danger text-tactical-danger animate-pulse'
                : 'bg-surface/90 border-neutral-700 text-tactical-runner'
            }`}
          >
            <span>🛰️</span>
            <span>{isGpsStale ? 'GPS STALE' : `±${myLocation?.accuracy ?? 0}m`}</span>
          </div>

          {/* Safety Pause / Resume */}
          {isHostOrReferee && (
            <button
              onClick={
                roomState.state === 'SAFETY_PAUSED'
                  ? onResumeMatch
                  : onSafetyPause
              }
              className={`px-3 py-1.5 rounded-xl font-bold text-xs uppercase shadow-lg active:scale-95 transition-all border ${
                roomState.state === 'SAFETY_PAUSED'
                  ? 'bg-tactical-runner text-neutral-900 border-tactical-runner'
                  : 'bg-tactical-danger text-white border-red-500'
              }`}
            >
              {roomState.state === 'SAFETY_PAUSED' ? '▶ Resume' : '🚨 Pause'}
            </button>
          )}
        </div>
      </div>

      {/* Runner Catch Code Banner */}
      {isRunner && !myMember?.isCaught && (
        <div className="absolute top-16 left-4 right-4 z-[450] pointer-events-none flex justify-center">
          <div className="bg-surface/95 backdrop-blur-md border border-tactical-runner/70 px-4 py-2 rounded-2xl shadow-runner-glow flex items-center gap-3 pointer-events-auto">
            <span className="text-xs text-neutral-300 font-medium">Your Catch Code:</span>
            <span className="font-mono text-xl font-black text-tactical-runner tracking-widest">
              {myMember?.catchCode || '----'}
            </span>
          </div>
        </div>
      )}

      {/* Runner Caught Banner */}
      {isRunner && myMember?.isCaught && (
        <div className="absolute top-16 left-4 right-4 z-[450] pointer-events-none flex justify-center">
          <div className="bg-tactical-danger/90 backdrop-blur-md text-white font-bold text-xs px-4 py-2 rounded-2xl shadow-xl pointer-events-auto">
            💀 YOU WERE CAUGHT! Spectating remainder of match...
          </div>
        </div>
      )}

      {/* Emergency Safety Pause Modal Overlay */}
      {roomState.state === 'SAFETY_PAUSED' && (
        <div className="fixed inset-0 z-[800] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface border-2 border-tactical-danger w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl space-y-4">
            <span className="text-4xl">🚨</span>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">
              Safety Pause Active
            </h2>
            <p className="text-xs text-neutral-300 leading-relaxed">
              Match timers and catch actions are frozen. Please stop running, check your physical surroundings, and regroup if necessary.
            </p>
            {isHostOrReferee && (
              <button
                onClick={onResumeMatch}
                className="w-full py-3 bg-tactical-runner hover:brightness-110 active:scale-95 text-neutral-950 font-black rounded-xl text-xs uppercase tracking-wider shadow-lg"
              >
                ▶ Resume Match
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom Controls Deck */}
      <div className="absolute bottom-4 left-3 right-3 z-[450] flex flex-col gap-2.5 pointer-events-none max-w-md mx-auto">
        {/* Chaser "Tag Runner" Floating Action Button */}
        {isChaser && roomState.state === 'ACTIVE' && (
          <div className="pointer-events-auto flex justify-center">
            <button
              onClick={() => {
                setShowTagModal(true);
                setTagError(null);
              }}
              className="w-full bg-tactical-chaser hover:brightness-110 active:scale-95 text-neutral-950 font-black px-6 py-3.5 rounded-2xl shadow-tactical-glow text-sm flex items-center justify-center gap-2 transition-all uppercase tracking-wider"
            >
              <span>⚡ Tag Nearby Runner ({uncaughtRunners.length} left)</span>
            </button>
          </div>
        )}

        {/* Team Walkie-Talkie Radio Bar */}
        {roomState.config.radioEnabled && myMember?.team !== 'NONE' && (
          <div className="pointer-events-auto bg-surface/90 backdrop-blur-md border border-neutral-700/80 p-2.5 rounded-2xl shadow-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 pl-2">
              <span className="text-sm">📻</span>
              <span className="text-xs font-semibold text-neutral-200">
                Team Radio ({myMember?.team})
              </span>
            </div>

            <div className="flex items-center gap-2">
              {radioRecordingState === 'recording' ? (
                <button
                  onClick={onStopRadio}
                  className="px-4 py-2 bg-tactical-danger text-white rounded-xl text-xs font-bold animate-pulse"
                >
                  ⏹ Stop ({radioElapsedSeconds}s)
                </button>
              ) : (
                <button
                  onClick={onStartRadio}
                  className="px-4 py-2 bg-tactical-radio/20 text-tactical-radio border border-tactical-radio/40 hover:bg-tactical-radio/30 active:scale-95 rounded-xl text-xs font-bold transition-all"
                >
                  🎙️ Record Voice
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Audio Review / Pre-Send Modal */}
      {radioRecordingState === 'reviewing' && (
        <div className="fixed inset-0 z-[750] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-tactical-radio w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <h3 className="font-bold text-sm text-neutral-200">Review Transmission</h3>
              <span className="text-xs text-neutral-400 font-mono">
                {Math.round(radioElapsedSeconds)}s
              </span>
            </div>

            <p className="text-xs text-neutral-300">
              Listen to your recorded transmission before broadcasting to your team.
            </p>

            {radioError && (
              <p className="text-xs text-tactical-danger font-semibold">{radioError}</p>
            )}

            <div className="flex gap-2">
              {isPlayingPreview ? (
                <button
                  onClick={onStopPreview}
                  className="flex-1 py-2.5 bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-xl text-xs font-bold"
                >
                  ⏸ Pause
                </button>
              ) : (
                <button
                  onClick={onPlayPreview}
                  className="flex-1 py-2.5 bg-surface-elevated border border-tactical-radio text-tactical-radio rounded-xl text-xs font-bold hover:bg-tactical-radio/10"
                >
                  ▶ Play Preview
                </button>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-neutral-800">
              <button
                onClick={onCancelRadio}
                className="flex-1 py-2.5 bg-neutral-800 text-neutral-400 hover:text-white rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                onClick={onSendRadio}
                className="flex-1 py-2.5 bg-tactical-radio hover:brightness-110 active:scale-95 text-white font-bold rounded-xl text-xs shadow-lg"
              >
                Broadcast 📡
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chaser Tag Runner Modal (Proximity OR Catch Code) */}
      {showTagModal && (
        <div className="fixed inset-0 z-[600] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface border border-neutral-700 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="font-bold text-sm text-neutral-200">Claim Runner Tag</h3>
              <button
                onClick={() => setShowTagModal(false)}
                className="text-neutral-400 hover:text-white text-xs px-2 py-1"
              >
                ✕ Cancel
              </button>
            </div>

            {tagError && (
              <div className="bg-tactical-danger/20 border border-tactical-danger text-tactical-danger p-2.5 rounded-xl text-xs font-semibold">
                ⚠️ {tagError}
              </div>
            )}

            {/* Step 1: Select Runner */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                Target Runner
              </label>
              <select
                value={selectedRunnerId}
                onChange={(e) => setSelectedRunnerId(e.target.value)}
                className="w-full bg-surface-elevated border border-neutral-700 rounded-xl px-3 py-2.5 text-xs text-neutral-200 focus:outline-none focus:border-tactical-chaser"
              >
                <option value="">Select a runner...</option>
                {uncaughtRunners.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nickname}
                  </option>
                ))}
              </select>
            </div>

            {/* Option A: Proximity Tag */}
            <button
              onClick={() => {
                if (!selectedRunnerId) {
                  setTagError('Select a runner to tag.');
                  return;
                }
                onAttemptCatch(selectedRunnerId);
                setShowTagModal(false);
              }}
              className="w-full py-2.5 bg-surface-elevated border border-neutral-700 hover:border-tactical-chaser text-neutral-200 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5"
            >
              <span>📍 Proximity Tag (&lt;25m check)</span>
            </button>

            <div className="flex items-center gap-2 text-[10px] text-neutral-500 uppercase tracking-widest font-mono">
              <span className="flex-1 border-t border-neutral-800" />
              <span>OR ENTER CODE</span>
              <span className="flex-1 border-t border-neutral-800" />
            </div>

            {/* Option B: Enter 4-Digit Catch Code */}
            <div className="space-y-2">
              <input
                type="text"
                maxLength={4}
                value={enteredCatchCode}
                onChange={(e) => setEnteredCatchCode(e.target.value.replace(/\D/g, ''))}
                placeholder="4-DIGIT PIN"
                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-center text-lg font-mono font-black tracking-widest text-tactical-chaser focus:outline-none focus:border-tactical-chaser"
              />
              <button
                onClick={handleClaimTagWithCode}
                className="w-full py-2.5 bg-tactical-chaser hover:brightness-110 active:scale-95 text-neutral-950 font-black rounded-xl text-xs shadow transition-all"
              >
                Verify Code Tag ⚡
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Catch Confirmation Prompt (Triggered on Runner's screen) */}
      {pendingCatch && pendingCatch.runnerId === myPlayerId && (
        <div className="fixed inset-0 z-[700] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface border-2 border-tactical-danger w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl space-y-4">
            <span className="text-3xl">🚨</span>
            <h3 className="font-black text-lg text-white">TAG CLAIMED!</h3>
            <p className="text-xs text-neutral-300 leading-relaxed">
              Chaser <span className="font-bold text-tactical-chaser">{pendingCatch.chaserNickname}</span> claims they caught you ({pendingCatch.distanceMeters}m away).
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => onRespondCatch(pendingCatch.id, 'DISPUTE')}
                className="flex-1 py-3 bg-neutral-800 border border-neutral-700 rounded-xl text-neutral-300 font-bold text-xs hover:bg-neutral-700"
              >
                Dispute Tag
              </button>
              <button
                onClick={() => onRespondCatch(pendingCatch.id, 'CONFIRM')}
                className="flex-1 py-3 bg-tactical-danger border border-red-500 rounded-xl text-white font-bold text-xs hover:brightness-110 shadow-lg"
              >
                Confirm Caught
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incoming Radio Transmission Overlay with LISTEN / IGNORE */}
      {incomingRadio && (
        <div className="fixed top-20 left-4 right-4 z-[700] flex justify-center">
          <div className="bg-surface-elevated/95 border-2 border-tactical-radio backdrop-blur-md rounded-2xl p-4 shadow-2xl max-w-sm w-full flex items-center justify-between gap-3 animate-pulse">
            <div>
              <span className="text-[10px] font-bold text-tactical-radio uppercase tracking-wider block">
                Incoming Team Radio
              </span>
              <span className="text-xs font-bold text-white">
                {incomingRadio.senderNickname} ({Math.round(incomingRadio.durationMs / 1000)}s)
              </span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => onPlayIncomingRadio(incomingRadio)}
                className="px-3 py-1.5 bg-tactical-radio hover:brightness-110 active:scale-95 text-white font-bold text-xs rounded-xl shadow"
              >
                LISTEN
              </button>
              <button
                onClick={onDismissIncomingRadio}
                className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-neutral-400 font-semibold text-xs rounded-xl"
              >
                IGNORE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
