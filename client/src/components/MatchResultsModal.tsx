'use client';

import { RoomState } from '../types/game';

interface MatchResultsModalProps {
  roomState: RoomState;
  myPlayerId: string;
  onRematch: () => void;
}

export default function MatchResultsModal({
  roomState,
  myPlayerId,
  onRematch,
}: MatchResultsModalProps) {
  const isHost = roomState.hostId === myPlayerId;
  const winner = roomState.match?.winnerTeam;
  const catches = roomState.match?.catches || [];

  const isRunnerVictory = winner === 'RUNNERS';

  return (
    <div className="fixed inset-0 z-[800] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface border border-neutral-700 w-full max-w-md rounded-3xl p-6 text-center shadow-2xl space-y-6">
        <div className="space-y-2">
          <span className="text-4xl">{isRunnerVictory ? '🏃‍♂️' : '🎯'}</span>
          <h2
            className={`text-2xl font-black uppercase tracking-tight ${
              isRunnerVictory ? 'text-tactical-runner' : 'text-tactical-chaser'
            }`}
          >
            {isRunnerVictory ? 'RUNNERS SURVIVED!' : 'CHASERS VICTORIOUS!'}
          </h2>
          <p className="text-xs text-neutral-400">
            {isRunnerVictory
              ? 'At least one runner evaded capture until the match clock expired.'
              : 'All runners were hunted down before time ran out.'}
          </p>
        </div>

        {/* Catches Timeline */}
        <div className="bg-surface-elevated/70 border border-neutral-800 rounded-2xl p-4 text-left space-y-2 max-h-48 overflow-y-auto">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-2">
            Match Highlights ({catches.length} Tags)
          </h4>
          {catches.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">No runners were caught!</p>
          ) : (
            catches.map((c, i) => (
              <div
                key={i}
                className="text-xs flex items-center justify-between py-1 border-b border-neutral-800/60 last:border-0"
              >
                <span className="text-neutral-200">
                  <span className="font-bold text-tactical-chaser">{c.chaserNickname}</span> tagged{' '}
                  <span className="font-bold text-tactical-runner">{c.runnerNickname}</span>
                </span>
                <span className="text-[10px] text-neutral-500">{c.distanceMeters}m tag</span>
              </div>
            ))
          )}
        </div>

        {/* Rematch Controls */}
        <div className="pt-2">
          {isHost ? (
            <button
              onClick={onRematch}
              className="w-full py-3.5 bg-tactical-chaser hover:brightness-110 active:scale-95 text-neutral-950 font-black rounded-2xl text-sm shadow-tactical-glow transition-all uppercase tracking-wider"
            >
              🔄 Rematch (Back to Lobby)
            </button>
          ) : (
            <p className="text-xs text-neutral-500 italic">
              Waiting for Host to start rematch...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
