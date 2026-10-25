'use client';

import { Trophy, Flag, RotateCcw, ShieldCheck, CheckCircle2, Clock, Users } from 'lucide-react';
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

  const totalRunners = Object.values(roomState.members).filter(
    (m) => m.team === 'RUNNERS'
  ).length;
  const caughtRunners = Object.values(roomState.members).filter(
    (m) => m.team === 'RUNNERS' && m.isCaught
  ).length;
  const survivedCount = Math.max(0, totalRunners - caughtRunners);

  return (
    <div className="fixed inset-0 z-[800] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="bg-[#1F2731] border border-[#3B4652] w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl space-y-4">
        {/* Victory Icon and Banner */}
        <div className="space-y-2">
          <div
            className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center border shadow-lg ${
              isRunnerVictory
                ? 'bg-[#39BDE8]/20 border-[#39BDE8]/60 text-[#39BDE8]'
                : 'bg-[#FF4655]/20 border-[#FF4655]/60 text-[#FF4655]'
            }`}
          >
            {isRunnerVictory ? (
              <Flag className="w-8 h-8" />
            ) : (
              <Trophy className="w-8 h-8" />
            )}
          </div>

          <h2
            className={`text-2xl font-black font-mono uppercase tracking-tight ${
              isRunnerVictory ? 'text-[#39BDE8]' : 'text-[#FF4655]'
            }`}
          >
            {isRunnerVictory ? 'RUNNERS VICTORIOUS' : 'CHASERS VICTORIOUS'}
          </h2>

          <p className="text-xs text-[#ECE8E1] font-mono leading-relaxed font-semibold">
            {roomState.match?.victoryReason ||
              (isRunnerVictory
                ? `${survivedCount} runner(s) evaded capture until the match clock expired.`
                : 'All runners were hunted down before the clock expired.')}
          </p>
        </div>

        {/* Final Scores & Tactical Stats Grid */}
        <div className="grid grid-cols-2 gap-2 text-left">
          <div className="bg-[#293440] border border-[#3B4652] p-2.5 rounded-xl">
            <span className="text-[10px] text-[#A8B0BA] font-mono uppercase block">
              Runners Score
            </span>
            <span className="text-base font-black font-mono text-[#39BDE8]">
              {roomState.match?.scoreLedger?.teamScores?.RUNNERS ?? 0} PTS
            </span>
          </div>
          <div className="bg-[#293440] border border-[#3B4652] p-2.5 rounded-xl">
            <span className="text-[10px] text-[#A8B0BA] font-mono uppercase block">
              Chasers Score
            </span>
            <span className="text-base font-black font-mono text-[#FF4655]">
              {roomState.match?.scoreLedger?.teamScores?.CHASERS ?? 0} PTS
            </span>
          </div>
          <div className="bg-[#293440] border border-[#3B4652] p-2.5 rounded-xl">
            <span className="text-[10px] text-[#A8B0BA] font-mono uppercase block">
              Tags Confirmed
            </span>
            <span className="text-sm font-black font-mono text-white">
              {catches.length} / {totalRunners}
            </span>
          </div>
          <div className="bg-[#293440] border border-[#3B4652] p-2.5 rounded-xl">
            <span className="text-[10px] text-[#A8B0BA] font-mono uppercase block">
              Shared Missions
            </span>
            <span className="text-sm font-black font-mono text-[#FFB800]">
              {(roomState.match?.sharedMissions || []).filter((m) => m.status === 'COMPLETED').length} / {(roomState.match?.sharedMissions || []).length}
            </span>
          </div>
        </div>

        {/* Catches Highlights Log */}
        <div className="bg-[#293440] border border-[#3B4652] rounded-2xl p-3.5 text-left space-y-2 max-h-48 overflow-y-auto">
          <h4 className="text-[10px] font-bold uppercase font-mono tracking-wider text-[#A8B0BA] mb-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#4CC38A]" />
            <span>Verified Catch Log ({catches.length})</span>
          </h4>
          {catches.length === 0 ? (
            <p className="text-xs text-[#A8B0BA] italic py-1">No runners were tagged this match.</p>
          ) : (
            catches.map((c, i) => (
              <div
                key={i}
                className="text-xs flex items-center justify-between py-2 border-b border-[#3B4652] last:border-0"
              >
                <div>
                  <div className="text-[#ECE8E1] font-semibold flex items-center gap-1">
                    <span className="text-[#FF4655] font-bold">{c.chaserNickname}</span>
                    <span className="text-neutral-500 text-[10px]">&rarr;</span>
                    <span className="text-[#39BDE8] font-bold">{c.runnerNickname}</span>
                  </div>
                  <div className="text-[10px] text-[#A8B0BA] font-mono flex items-center gap-2 mt-0.5">
                    <span>Dist: {Math.round(c.distanceMeters)}m</span>
                    {c.verificationType === 'CODE_VERIFIED' && (
                      <span className="text-[#39BDE8] font-bold">[PIN Verified]</span>
                    )}
                    {c.verificationType === 'PROXIMITY_CONFIRMED' && (
                      <span className="text-[#4CC38A] font-bold">[GPS Confirmed]</span>
                    )}
                  </div>
                </div>
                <CheckCircle2 className="w-3.5 h-3.5 text-[#4CC38A] shrink-0" />
              </div>
            ))
          )}
        </div>

        {/* Rematch Controls */}
        <div className="pt-1">
          {isHost ? (
            <button
              onClick={onRematch}
              className="w-full min-h-[48px] py-3.5 bg-[#FF4655] hover:brightness-110 active:scale-95 text-white font-black rounded-2xl text-xs uppercase tracking-wider shadow-tactical-glow transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Rematch (Return to Staging)</span>
            </button>
          ) : (
            <p className="text-xs text-[#A8B0BA] italic py-2">
              Awaiting Host to initiate rematch...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
