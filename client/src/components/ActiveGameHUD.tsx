'use client';

import { useState } from 'react';
import {
  RoomState,
  PlayerLocation,
  CatchAttempt,
  RadioTransmission,
} from '../types/game';

interface ActiveGameHUDProps {
  roomState: RoomState;
  myPlayerId: string;
  myLocation: PlayerLocation | null;
  isGpsStale: boolean;
  pendingCatch: CatchAttempt | null;
  incomingRadio: RadioTransmission | null;
  isRecordingRadio: boolean;
  onStartRadio: () => void;
  onStopRadio: () => void;
  onPlayRadio: (t: RadioTransmission) => void;
  onDismissRadio: () => void;
  onAttemptCatch: (targetRunnerId: string) => void;
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
  isRecordingRadio,
  onStartRadio,
  onStopRadio,
  onPlayRadio,
  onDismissRadio,
  onAttemptCatch,
  onRespondCatch,
  onSafetyPause,
  onResumeMatch,
}: ActiveGameHUDProps) {
  const [showTagModal, setShowTagModal] = useState(false);
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

  return (
    <>
      {/* Top HUD Floating Bar */}
      <div className="absolute top-4 left-4 right-4 z-[450] flex items-center justify-between pointer-events-none">
        {/* Match Timer & State Badge */}
        <div className="bg-surface/95 backdrop-blur-md border border-neutral-700/80 px-3.5 py-1.5 rounded-2xl shadow-xl flex items-center gap-3 pointer-events-auto">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-400">
              {roomState.state === 'RUNNER_HEADSTART'
                ? 'Head Start'
                : roomState.state === 'SAFETY_PAUSED'
                ? 'Safety Paused'
                : 'Match Clock'}
            </span>
            <span className="text-xl font-black font-mono tracking-tight text-white">
              {timeFormatted}
            </span>
          </div>

          <div
            className={`w-2 h-2 rounded-full ${
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
          {/* GPS Status Badge */}
          <div
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 shadow-md ${
              isGpsStale
                ? 'bg-tactical-danger/20 border-tactical-danger text-tactical-danger animate-pulse'
                : 'bg-surface/90 border-neutral-700 text-tactical-runner'
            }`}
          >
            <span>🛰️</span>
            <span>{isGpsStale ? 'GPS STALE' : `${myLocation?.accuracy ?? 0}m`}</span>
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

      {/* Runner Special Banner: Dynamic Catch Code */}
      {isRunner && !myMember.isCaught && (
        <div className="absolute top-20 left-4 right-4 z-[450] pointer-events-none flex justify-center">
          <div className="bg-surface/95 backdrop-blur-md border border-tactical-runner/60 px-4 py-2 rounded-2xl shadow-runner-glow flex items-center gap-3 pointer-events-auto">
            <span className="text-xs text-neutral-300">Your Catch Code:</span>
            <span className="font-mono text-lg font-black text-tactical-runner tracking-widest">
              {myMember.catchCode || '----'}
            </span>
          </div>
        </div>
      )}

      {/* Runner Caught Elimination Banner */}
      {isRunner && myMember.isCaught && (
        <div className="absolute top-20 left-4 right-4 z-[450] pointer-events-none flex justify-center">
          <div className="bg-tactical-danger/90 backdrop-blur-md text-white font-bold text-xs px-4 py-2 rounded-2xl shadow-xl pointer-events-auto">
            💀 YOU HAVE BEEN CAUGHT! Spectating match...
          </div>
        </div>
      )}

      {/* Bottom Controls Deck */}
      <div className="absolute bottom-4 left-4 right-4 z-[450] flex flex-col gap-3 pointer-events-none max-w-md mx-auto">
        {/* Chaser "Tag Runner" Floating Action Button */}
        {isChaser && roomState.state === 'ACTIVE' && (
          <div className="pointer-events-auto flex justify-center">
            <button
              onClick={() => setShowTagModal(true)}
              className="bg-tactical-chaser hover:brightness-110 active:scale-95 text-neutral-950 font-black px-6 py-3.5 rounded-2xl shadow-tactical-glow text-sm flex items-center gap-2 transition-all uppercase tracking-wider"
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
              <span className="text-xs font-semibold text-neutral-300">
                Team Radio ({myMember?.team})
              </span>
            </div>

            <button
              onMouseDown={onStartRadio}
              onMouseUp={onStopRadio}
              onTouchStart={onStartRadio}
              onTouchEnd={onStopRadio}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                isRecordingRadio
                  ? 'bg-tactical-danger text-white border-red-500 animate-pulse'
                  : 'bg-tactical-radio/20 text-tactical-radio border-tactical-radio/40 hover:bg-tactical-radio/30 active:scale-95'
              }`}
            >
              {isRecordingRadio ? '🎙️ Transmitting...' : 'Hold to Talk'}
            </button>
          </div>
        )}
      </div>

      {/* Chaser Tag Runner Modal */}
      {showTagModal && (
        <div className="fixed inset-0 z-[600] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface border border-neutral-700 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="font-bold text-sm text-neutral-200">Select Runner to Tag</h3>
              <button
                onClick={() => setShowTagModal(false)}
                className="text-neutral-400 hover:text-white text-xs px-2 py-1"
              >
                ✕ Cancel
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {uncaughtRunners.map((runner) => (
                <div
                  key={runner.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-surface-elevated border border-neutral-700"
                >
                  <span className="font-semibold text-xs text-neutral-200">
                    {runner.nickname}
                  </span>
                  <button
                    onClick={() => {
                      onAttemptCatch(runner.id);
                      setShowTagModal(false);
                    }}
                    className="bg-tactical-chaser hover:brightness-110 active:scale-95 text-neutral-900 font-bold px-3 py-1.5 rounded-lg text-xs"
                  >
                    Claim Tag
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Catch Confirmation Prompt (Triggered on Runner's screen) */}
      {pendingCatch && pendingCatch.runnerId === myPlayerId && (
        <div className="fixed inset-0 z-[700] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface border-2 border-tactical-danger w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl space-y-4 animate-bounce">
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
                Incoming Voice Radio
              </span>
              <span className="text-xs font-bold text-white">
                {incomingRadio.senderNickname} ({Math.round(incomingRadio.durationMs / 1000)}s)
              </span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => onPlayRadio(incomingRadio)}
                className="px-3 py-1.5 bg-tactical-radio hover:brightness-110 active:scale-95 text-white font-bold text-xs rounded-xl shadow"
              >
                LISTEN
              </button>
              <button
                onClick={onDismissRadio}
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
