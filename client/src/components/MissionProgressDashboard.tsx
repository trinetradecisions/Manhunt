'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Crosshair,
  ChevronDown,
  ChevronUp,
  MapPin,
  Trophy,
  Shield,
  Zap,
  Check,
  Send,
  Flag,
  Navigation,
} from 'lucide-react';
import { SharedMission, ScoreLedger, PlayerTeam, PlayerLocation } from '../types/game';
import { calculateHaversineDistance } from '../utils/geoUtils';

interface MissionProgressDashboardProps {
  sharedMissions: SharedMission[];
  scoreLedger?: ScoreLedger | null;
  myPlayerId: string;
  myTeam: PlayerTeam;
  myLocation: PlayerLocation | null;
  onAnswerLandmarkClue?: (answer: string) => Promise<{ success: boolean; completed?: boolean; error?: string }>;
}

export default function MissionProgressDashboard({
  sharedMissions = [],
  scoreLedger,
  myPlayerId,
  myTeam,
  myLocation,
  onAnswerLandmarkClue,
}: MissionProgressDashboardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [clueInput, setClueInput] = useState<{ [missionId: string]: string }>({});
  const [clueSubmitting, setClueSubmitting] = useState<string | null>(null);
  const [clueError, setClueError] = useState<{ [missionId: string]: string }>({});

  const totalMissions = sharedMissions.length;
  const completedMissions = sharedMissions.filter((m) => m.status === 'COMPLETED').length;
  const progressPct = totalMissions > 0 ? Math.round((completedMissions / totalMissions) * 100) : 0;
  const allCompleted = totalMissions > 0 && completedMissions === totalMissions;

  // Resolve scores
  const runnerTeamScore = scoreLedger?.teamScores?.RUNNERS || 0;
  const chaserTeamScore = scoreLedger?.teamScores?.CHASERS || 0;
  const myIndividualScore = scoreLedger?.individualScores?.[myPlayerId] ?? scoreLedger?.playerScores?.[myPlayerId] ?? 0;

  const handleClueSubmit = async (missionId: string) => {
    const val = (clueInput[missionId] || '').trim();
    if (!val || !onAnswerLandmarkClue) return;

    setClueSubmitting(missionId);
    setClueError((prev) => ({ ...prev, [missionId]: '' }));

    try {
      const res = await onAnswerLandmarkClue(val);
      if (!res.success) {
        setClueError((prev) => ({ ...prev, [missionId]: res.error || 'Incorrect code' }));
      } else {
        setClueInput((prev) => ({ ...prev, [missionId]: '' }));
      }
    } catch (err: any) {
      setClueError((prev) => ({ ...prev, [missionId]: err.message || 'Submission failed' }));
    } finally {
      setClueSubmitting(null);
    }
  };

  if (totalMissions === 0) return null;

  return (
    <div className="pointer-events-auto max-w-md w-full select-none">
      {/* Victory Notification Banner if all shared missions are completed */}
      {allCompleted && (
        <div className="mb-2 p-3 bg-[#4CC38A]/20 border-2 border-[#4CC38A] rounded-2xl shadow-lime-glow animate-bounce text-center">
          <div className="flex items-center justify-center gap-1.5 text-xs font-mono font-black text-[#4CC38A] uppercase tracking-wider">
            <Trophy className="w-4 h-4" />
            <span>ALL SHARED OBJECTIVES COMPLETE!</span>
          </div>
          <span className="text-[10px] text-white font-mono block mt-0.5">
            Runners have secured full match victory via objective clearance!
          </span>
        </div>
      )}

      {/* Main Container Card */}
      <div className="bg-[#0F1923]/95 border border-[#3B4652] rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden">
        {/* Header / Collapsed Summary Bar */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-3 flex items-center justify-between cursor-pointer hover:bg-[#1F2731]/70 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#FFB800]/20 border border-[#FFB800]/50 rounded-xl text-[#FFB800]">
              <Crosshair className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-black text-white uppercase tracking-wider">
                  Shared Missions
                </span>
                <span className="text-[10px] font-mono font-bold text-[#FFB800] bg-[#FFB800]/10 px-1.5 py-0.5 rounded border border-[#FFB800]/30">
                  {completedMissions} / {totalMissions}
                </span>
              </div>
              {/* Scores bar */}
              <div className="flex items-center gap-2 text-[10px] font-mono text-[#A8B0BA] mt-0.5">
                <span className="text-[#39BDE8]">Runners: {runnerTeamScore}</span>
                <span>•</span>
                <span className="text-[#FF4655]">Chasers: {chaserTeamScore}</span>
                <span>•</span>
                <span className="text-[#4CC38A]">Solo: +{myIndividualScore}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Circular or Mini Progress */}
            <div className="text-right">
              <span className="text-xs font-mono font-black text-[#FFB800] block">{progressPct}%</span>
              <span className="text-[8px] font-mono text-[#A8B0BA] uppercase">CLEARANCE</span>
            </div>
            <button
              type="button"
              className="p-1 text-[#A8B0BA] hover:text-white rounded-lg"
              aria-label="Toggle mission dashboard"
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Tactical Progress Bar */}
        <div className="h-1.5 w-full bg-[#161e27]">
          <div
            className={`h-full transition-all duration-500 ${
              allCompleted ? 'bg-[#4CC38A]' : 'bg-[#FFB800]'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Expanded View: Full Mission List & Actions */}
        {isExpanded && (
          <div className="p-3 sm:p-4 space-y-3 max-h-[50vh] sm:max-h-[60vh] overflow-y-auto border-t border-[#3B4652]/60">
            {sharedMissions.map((mission, idx) => {
              const isCompleted = mission.status === 'COMPLETED';
              const rawType = (mission.type || mission.templateType || '').toUpperCase();

              // Distance calculation to target waypoint if available
              let distMeters: number | null = null;
              if (myLocation && mission.targetLocation) {
                const targetLat = mission.targetLocation.latitude ?? mission.targetLocation.lat;
                const targetLng = mission.targetLocation.longitude ?? mission.targetLocation.lng;
                distMeters = Math.round(
                  calculateHaversineDistance(
                    myLocation.latitude,
                    myLocation.longitude,
                    targetLat,
                    targetLng
                  )
                );
              }

              return (
                <div
                  key={mission.id || idx}
                  className={`p-3 rounded-2xl border transition-all ${
                    isCompleted
                      ? 'bg-[#4CC38A]/10 border-[#4CC38A]/40'
                      : 'bg-[#161e27] border-[#3B4652]'
                  }`}
                >
                  {/* Mission Top Row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 rounded-lg ${
                          isCompleted
                            ? 'bg-[#4CC38A] text-[#0F1923]'
                            : 'bg-[#FFB800] text-[#0F1923]'
                        }`}
                      >
                        {rawType.replace(/_/g, ' ')}
                      </span>
                      <span
                        className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                          isCompleted
                            ? 'text-[#4CC38A] border-[#4CC38A]/40'
                            : 'text-[#FFB800] border-[#FFB800]/40'
                        }`}
                      >
                        {isCompleted ? 'COMPLETED' : 'ACTIVE OBJECTIVE'}
                      </span>
                    </div>

                    <span className="text-[10px] font-mono font-bold text-[#FFB800] shrink-0">
                      +{mission.rewardIndividual} Solo / +{mission.rewardTeam} Team
                    </span>
                  </div>

                  {/* Title & Description */}
                  <div className="mt-1.5">
                    <h4 className="text-xs font-mono font-bold text-white uppercase">{mission.title}</h4>
                    <p className="text-[11px] text-[#A8B0BA] font-mono mt-0.5 leading-snug">
                      {mission.description}
                    </p>
                  </div>

                  {/* Waypoint distance badge */}
                  {distMeters !== null && !isCompleted && (
                    <div className="mt-2 flex items-center justify-between text-[10px] font-mono bg-[#1F2731] px-2.5 py-1.5 rounded-xl border border-[#3B4652]">
                      <span className="text-[#A8B0BA] flex items-center gap-1">
                        <Navigation className="w-3 h-3 text-[#FFB800]" />
                        <span>Distance to Objective:</span>
                      </span>
                      <strong className="text-white">{distMeters}m</strong>
                    </div>
                  )}

                  {/* Checkpoint list for CHECKPOINT_RUN */}
                  {rawType === 'CHECKPOINT_RUN' && mission.checkpoints && (
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      {mission.checkpoints.map((cp, cpIdx) => (
                        <span
                          key={cpIdx}
                          className={`text-[9px] font-mono px-2 py-0.5 rounded-lg border flex items-center gap-1 ${
                            cp.completed || cp.isCompleted
                              ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                              : cpIdx === mission.currentCheckpointIndex
                              ? 'bg-[#FFB800]/20 border-[#FFB800] text-[#FFB800] animate-pulse'
                              : 'bg-[#1F2731] border-[#3B4652] text-[#A8B0BA]'
                          }`}
                        >
                          <Flag className="w-2.5 h-2.5" />
                          <span>CP {cpIdx + 1}</span>
                          {(cp.completed || cp.isCompleted) && <Check className="w-2.5 h-2.5" />}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Stay timer progress bar for SECURE_THE_POINT */}
                  {rawType === 'SECURE_THE_POINT' && !isCompleted && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className={mission.isInRadius ? 'text-[#4CC38A] font-bold' : 'text-[#A8B0BA]'}>
                          {mission.isInRadius ? 'HOLDING ZONE (CONTESTING)' : 'ENTER 25M RADIUS'}
                        </span>
                        <span className="text-white font-bold">
                          {mission.currentStaySeconds || mission.stayDurationSeconds || 0}s /{' '}
                          {mission.requiredStaySeconds || 90}s
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-[#1F2731] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            mission.isInRadius ? 'bg-[#4CC38A]' : 'bg-[#FFB800]'
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              (((mission.currentStaySeconds || mission.stayDurationSeconds || 0) /
                                (mission.requiredStaySeconds || 90)) *
                                100)
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Landmark clue verification input */}
                  {rawType === 'LANDMARK_RECON' && !isCompleted && mission.landmarkClue && (
                    <div className="mt-2 p-2.5 rounded-xl bg-[#1F2731] border border-[#3B4652] space-y-1.5">
                      <span className="text-[10px] font-mono font-bold text-white block">
                        {mission.landmarkClue.question}
                      </span>
                      {myTeam === 'RUNNERS' ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={clueInput[mission.id] || ''}
                            onChange={(e) =>
                              setClueInput({ ...clueInput, [mission.id]: e.target.value })
                            }
                            placeholder="Enter 4-digit PIN..."
                            maxLength={8}
                            className="flex-1 bg-[#161e27] border border-[#3B4652] rounded-xl px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[#FFB800]"
                          />
                          <button
                            type="button"
                            onClick={() => handleClueSubmit(mission.id)}
                            disabled={clueSubmitting === mission.id || !(clueInput[mission.id] || '').trim()}
                            className="px-3 py-1.5 bg-[#FFB800] text-[#0F1923] font-mono font-bold rounded-xl text-xs uppercase disabled:opacity-40"
                          >
                            {clueSubmitting === mission.id ? 'Verifying...' : 'Submit'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-[#A8B0BA] block">
                          Intelligence waypoint verification restricted to Runners.
                        </span>
                      )}
                      {clueError[mission.id] && (
                        <span className="text-[10px] font-mono text-[#FF4655] block">
                          {clueError[mission.id]}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Completed info banner */}
                  {isCompleted && (
                    <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-[#4CC38A] bg-[#4CC38A]/10 px-2.5 py-1.5 rounded-xl border border-[#4CC38A]/30">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-[#4CC38A]" />
                        <span>Completed by {mission.completedByNickname || 'Runners Team'}</span>
                      </span>
                      {mission.completedAt && (
                        <span className="text-neutral-400">
                          {new Date(mission.completedAt).toLocaleTimeString([], {
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
