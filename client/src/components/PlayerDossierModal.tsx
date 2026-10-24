'use client';

import { useState, useEffect } from 'react';
import {
  Shield,
  X,
  Compass,
  Clock,
  Trophy,
  Activity,
  Award,
  Zap,
  RotateCcw,
  Footprints,
  Calendar,
} from 'lucide-react';
import { PlayerStats, PlayerRole, PlayerTeam } from '../types/game';
import PlayerAvatar from './PlayerAvatar';

interface PlayerDossierModalProps {
  playerId: string;
  nickname: string;
  currentRole?: PlayerRole;
  currentTeam?: PlayerTeam;
  isMe?: boolean;
  onClose: () => void;
  socket?: any;
}

export default function PlayerDossierModal({
  playerId,
  nickname,
  currentRole = 'RUNNER',
  currentTeam = 'NONE',
  isMe = false,
  onClose,
  socket,
}: PlayerDossierModalProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchStats = async () => {
      setIsLoading(true);

      // 1. Try socket query first
      if (socket && socket.connected) {
        socket.emit('player:get_stats', { playerId }, (res: any) => {
          if (isMounted && res?.success && res.stats) {
            setStats(res.stats);
            setIsLoading(false);
          }
        });
        return;
      }

      // 2. Fallback to REST endpoint
      const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
      try {
        const resp = await fetch(`${serverUrl}/api/player/${playerId}/stats`);
        const data = await resp.json();
        if (isMounted && data?.success && data.stats) {
          setStats(data.stats);
        }
      } catch (err) {
        console.warn('Failed to fetch player stats:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchStats();
    return () => {
      isMounted = false;
    };
  }, [playerId, socket]);

  // Format meters to km with 2 decimals
  const formatKm = (meters?: number) => {
    if (!meters || meters <= 0) return '0.00 km';
    return `${(meters / 1000).toFixed(2)} km`;
  };

  // Format playtime seconds to "X h Y min"
  const formatPlaytime = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '0 min';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs} h ${mins} min`;
    return `${mins} min`;
  };

  const winRate =
    stats && stats.matchesPlayed > 0
      ? Math.round((stats.matchesWon / stats.matchesPlayed) * 100)
      : 0;

  return (
    <div
      className="fixed inset-0 z-[1100] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-[#1F2731] border border-[#3B4652] w-full max-w-md rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tactical Dossier Header */}
        <div className="flex items-center justify-between border-b border-[#3B4652] pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#293440] border border-[#3B4652] flex items-center justify-center text-[#4CC38A]">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[#4CC38A] block">
                Operative Dossier
              </span>
              <h2 className="text-sm sm:text-base font-black uppercase text-white font-mono tracking-wider">
                {nickname} {isMe && <span className="text-[#4CC38A] text-xs font-bold">(YOU)</span>}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-[#293440] hover:bg-[#3B4652] text-[#A8B0BA] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Profile Card Banner */}
        <div className="bg-[#293440] border border-[#3B4652] rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PlayerAvatar nickname={nickname} team={currentTeam} size="lg" />
            <div className="min-w-0 truncate">
              <span className="text-base font-black text-white font-mono truncate block">
                {nickname}
              </span>
              <div className="flex items-center gap-2 text-[10px] font-mono mt-0.5">
                <span className="text-[#A8B0BA]">Current Role:</span>
                <span
                  className={`font-bold uppercase ${
                    currentTeam === 'RUNNERS'
                      ? 'text-[#39BDE8]'
                      : currentTeam === 'CHASERS'
                      ? 'text-[#FF4655]'
                      : 'text-[#A8B0BA]'
                  }`}
                >
                  {currentTeam === 'RUNNERS'
                    ? 'Runner (Evade)'
                    : currentTeam === 'CHASERS'
                    ? 'Chaser (Hunt)'
                    : 'Bench (Waiting)'}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right font-mono shrink-0">
            <span className="text-[9px] text-[#A8B0BA] uppercase block">Win Rate</span>
            <span className="text-base font-black text-[#4CC38A]">{winRate}%</span>
          </div>
        </div>

        {/* Grid Stats Deck */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Distance Walked (Total) */}
          <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[#39BDE8]">
              <Footprints className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
                Lifetime Distance
              </span>
            </div>
            <span className="text-base font-black font-mono text-white block">
              {isLoading ? '...' : formatKm(stats?.totalDistanceMeters)}
            </span>
            <span className="text-[9px] text-[#A8B0BA] font-mono block">
              GPS tracked distance
            </span>
          </div>

          {/* Current Match Distance */}
          <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[#4CC38A]">
              <Activity className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
                Current Match
              </span>
            </div>
            <span className="text-base font-black font-mono text-white block">
              {isLoading ? '...' : formatKm(stats?.currentMatchDistanceMeters)}
            </span>
            <span className="text-[9px] text-[#A8B0BA] font-mono block">
              Active match tracking
            </span>
          </div>

          {/* Matches & Wins */}
          <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-amber-400">
              <Trophy className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
                Matches / Wins
              </span>
            </div>
            <span className="text-base font-black font-mono text-white block">
              {isLoading
                ? '...'
                : `${stats?.matchesPlayed || 0} / ${stats?.matchesWon || 0}`}
            </span>
            <span className="text-[9px] text-[#A8B0BA] font-mono block">
              Victories recorded
            </span>
          </div>

          {/* Total Playtime */}
          <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[#8b5cf6]">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
                Playtime
              </span>
            </div>
            <span className="text-base font-black font-mono text-white block">
              {isLoading ? '...' : formatPlaytime(stats?.totalPlaytimeSeconds)}
            </span>
            <span className="text-[9px] text-[#A8B0BA] font-mono block">
              Active in-game duration
            </span>
          </div>

          {/* Escapes / Evaded */}
          <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[#39BDE8]">
              <Award className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
                Runner Escapes
              </span>
            </div>
            <span className="text-base font-black font-mono text-white block">
              {isLoading ? '...' : stats?.escapes || 0}
            </span>
            <span className="text-[9px] text-[#A8B0BA] font-mono block">
              Survivals as Runner
            </span>
          </div>

          {/* Catches / Caught */}
          <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[#FF4655]">
              <Zap className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
                Times Tagged
              </span>
            </div>
            <span className="text-base font-black font-mono text-white block">
              {isLoading ? '...' : stats?.timesCaught || 0}
            </span>
            <span className="text-[9px] text-[#A8B0BA] font-mono block">
              Apprehended by Chaser
            </span>
          </div>
        </div>

        {/* Recent Match History */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#A8B0BA] flex items-center gap-1">
              <Calendar className="w-3 h-3 text-[#A8B0BA]" />
              Recent Operations
            </span>
            <span className="text-[9px] font-mono text-[#A8B0BA]">
              {stats?.matchHistory?.length || 0} recorded
            </span>
          </div>

          {!stats?.matchHistory || stats.matchHistory.length === 0 ? (
            <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3.5 text-center text-[11px] font-mono text-[#A8B0BA]">
              No previous match history recorded for this operative.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {stats.matchHistory.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-[#161e27] border border-[#3B4652] rounded-xl p-2.5 flex items-center justify-between text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        item.won ? 'bg-[#4CC38A]' : 'bg-[#FF4655]'
                      }`}
                    />
                    <div>
                      <span className="font-bold text-white block text-[11px]">
                        Room {item.roomCode} &bull;{' '}
                        <span
                          className={
                            item.team === 'RUNNERS'
                              ? 'text-[#39BDE8]'
                              : 'text-[#FF4655]'
                          }
                        >
                          {item.team}
                        </span>
                      </span>
                      <span className="text-[9px] text-[#A8B0BA]">
                        {new Date(item.timestamp).toLocaleDateString()} &bull;{' '}
                        {formatPlaytime(item.durationSeconds)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-[10px] font-bold block ${
                        item.won ? 'text-[#4CC38A]' : 'text-[#FF4655]'
                      }`}
                    >
                      {item.won ? 'VICTORY' : 'DEFEAT'}
                    </span>
                    <span className="text-[9px] text-[#A8B0BA]">
                      {formatKm(item.distanceMeters)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Button */}
        <button
          onClick={onClose}
          className="w-full min-h-[44px] py-2.5 bg-[#293440] hover:bg-[#3B4652] text-white font-mono font-bold rounded-2xl text-xs uppercase tracking-wider transition-colors"
        >
          Close Dossier
        </button>
      </div>
    </div>
  );
}
