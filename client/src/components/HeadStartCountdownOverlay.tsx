'use client';

import { useState, useEffect } from 'react';
import { Clock, Shield, Navigation, ChevronUp, ChevronDown } from 'lucide-react';
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
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

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
    <div className="absolute top-[4.5rem] sm:top-20 left-3 right-3 z-[460] pointer-events-none flex justify-center">
      <div className="pointer-events-auto bg-[#1F2731]/95 border border-[#39BDE8]/70 rounded-2xl p-3 sm:p-3.5 shadow-2xl backdrop-blur-md max-w-lg w-full transition-all select-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#39BDE8] animate-pulse" />
            <div className="flex flex-col">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#39BDE8] font-bold">
                Tactical Phase: Head Start
              </span>
              <span className="text-sm sm:text-base font-black font-mono tracking-tight text-white">
                {isRunner ? 'RUNNERS DISPERSAL' : isChaser ? 'CHASERS STAGING LOCK' : 'OBSERVER MODE'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="px-3 py-1 bg-[#161E27] border border-[#3B4652] rounded-xl text-center">
              <span className="text-xl sm:text-2xl font-black font-mono tracking-wider tabular-nums text-[#39BDE8]">
                {formattedTime}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 rounded-lg bg-[#293440] hover:bg-[#3B4652] text-[#A8B0BA] hover:text-white transition-colors"
              title={isMinimized ? "Expand instructions" : "Minimize instructions"}
            >
              {isMinimized ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {!isMinimized && (
          <div className="mt-2.5 pt-2.5 border-t border-[#3B4652] text-[11px] font-mono leading-relaxed flex items-center gap-2">
            {isRunner ? (
              <>
                <Navigation className="w-4 h-4 text-[#39BDE8] shrink-0" />
                <span className="text-[#ECE8E1]">
                  Chasers are locked in staging. Disperse to tactical cover inside the boundary.
                </span>
              </>
            ) : isChaser ? (
              <>
                <Shield className="w-4 h-4 text-[#FF4655] shrink-0" />
                <span className="text-[#ECE8E1]">
                  Standby at base. Pursuit tracking unlocks when the clock hits 00:00.
                </span>
              </>
            ) : (
              <span className="text-[#A8B0BA]">Observing tactical dispersal. Telemetry unlocks upon chaser release.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
