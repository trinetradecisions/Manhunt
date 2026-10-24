'use client';

import { useState, useEffect } from 'react';
import { Clock, Shield, Compass, Navigation, AlertOctagon } from 'lucide-react';
import { RoomState } from '../types/game';

interface HeadStartCountdownOverlayProps {
  roomState: RoomState;
  myPlayerId: string;
}

export default function HeadStartCountdownOverlay({
  roomState,
  myPlayerId,
}: HeadStartCountdownOverlayProps) {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  const headStartEndsAt = roomState.match?.headStartEndsAt || 0;
  const myMember = roomState.members[myPlayerId];
  const isRunner = myMember?.team === 'RUNNERS';
  const isChaser = myMember?.team === 'CHASERS';

  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((headStartEndsAt - now) / 1000));
      setRemainingSeconds(remaining);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 250);
    return () => clearInterval(interval);
  }, [headStartEndsAt]);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-[600] bg-[#0F1923]/98 flex flex-col justify-between p-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] select-none overflow-hidden">
      {/* Background Subtle Radar Ring */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
        <div className="w-[500px] h-[500px] rounded-full border border-[#39BDE8]/30 animate-ping" />
        <div className="absolute w-[350px] h-[350px] rounded-full border border-[#3B4652]" />
        <div className="absolute w-[200px] h-[200px] rounded-full border border-[#3B4652]/60" />
      </div>

      {/* Header Badge */}
      <div className="text-center space-y-2 relative z-10">
        <div className="inline-flex items-center gap-2 bg-[#1F2731] border border-[#3B4652] px-4 py-1.5 rounded-full text-xs font-mono font-bold tracking-widest uppercase">
          <span className="w-2.5 h-2.5 rounded-full bg-[#39BDE8] animate-pulse" />
          <span className="text-[#39BDE8]">Tactical Phase: Head Start</span>
        </div>
        <h1 className="text-xl font-black font-mono tracking-tight text-[#ECE8E1]">
          RUNNERS&apos; DISPERSAL WINDOW
        </h1>
      </div>

      {/* Massive Central Countdown Display */}
      <div className="text-center space-y-4 my-auto relative z-10">
        <div className="inline-block p-6 rounded-3xl bg-[#1F2731] border border-[#3B4652] backdrop-blur-md shadow-2xl">
          <span className="block text-[11px] uppercase font-mono font-bold tracking-widest text-[#A8B0BA] mb-2">
            Time Remaining to Release
          </span>
          <div className="text-7xl sm:text-8xl font-black font-mono tracking-wider tabular-nums text-white">
            {formattedTime}
          </div>
        </div>

        {/* Phase State Indicator */}
        <div className="max-w-md mx-auto">
          {isRunner ? (
            <div className="bg-[#39BDE8]/15 border border-[#39BDE8]/50 rounded-2xl p-4 text-[#ECE8E1] text-xs space-y-1.5 shadow-lg">
              <div className="font-bold uppercase tracking-wider flex items-center justify-center gap-2 text-[#39BDE8]">
                <Navigation className="w-4 h-4" />
                <span>Runner Directive: Scatter &amp; Conceal</span>
              </div>
              <p className="text-[#A8B0BA] text-[11px] leading-relaxed">
                Chasers are currently locked in staging. Move quickly to favorable terrain within the designated Play Zone boundary.
              </p>
            </div>
          ) : isChaser ? (
            <div className="bg-[#FF4655]/15 border border-[#FF4655]/50 rounded-2xl p-4 text-[#ECE8E1] text-xs space-y-1.5 shadow-lg">
              <div className="font-bold uppercase tracking-wider flex items-center justify-center gap-2 text-[#FF4655]">
                <Shield className="w-4 h-4" />
                <span>Chaser Directive: Standby at Staging</span>
              </div>
              <p className="text-[#A8B0BA] text-[11px] leading-relaxed">
                Hold your ground. Satellite tracking will release your pursuit as soon as the countdown completes.
              </p>
            </div>
          ) : (
            <div className="bg-[#1F2731] border border-[#3B4652] rounded-2xl p-4 text-[#ECE8E1] text-xs">
              Observer mode active. Monitoring tactical countdown.
            </div>
          )}
        </div>
      </div>

      {/* Footer System Status */}
      <div className="text-center text-[10px] text-[#A8B0BA] font-mono relative z-10 space-y-1">
        <div className="flex items-center justify-center gap-3">
          <span>ZONE RADIUS: {roomState.config.playZone.radiusMeters}M</span>
          <span>&bull;</span>
          <span>MATCH LENGTH: {Math.round(roomState.config.durationSeconds / 60)}M</span>
        </div>
        <p>Live GPS telemetry will initialize upon chaser release.</p>
      </div>
    </div>
  );
}
