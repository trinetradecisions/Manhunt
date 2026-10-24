'use client';

import { LogOut, AlertTriangle, X } from 'lucide-react';

interface LeaveRoomModalProps {
  isOpen: boolean;
  isHost: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function LeaveRoomModal({
  isOpen,
  isHost,
  onConfirm,
  onCancel,
}: LeaveRoomModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-fadeIn"
      onClick={onCancel}
    >
      <div
        className="bg-[#1F2731] border border-[#3B4652] w-full max-w-sm rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#3B4652] pb-3">
          <div className="flex items-center gap-2 text-[#FF4655]">
            <div className="w-8 h-8 rounded-xl bg-[#FF4655]/20 border border-[#FF4655]/50 flex items-center justify-center">
              <LogOut className="w-4 h-4 text-[#FF4655]" />
            </div>
            <h3 className="font-mono font-bold text-sm uppercase text-white tracking-wider">
              Leave this room?
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-[#A8B0BA] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#A8B0BA] font-mono leading-relaxed">
          You will disconnect from the current session and return to the Manhunt home screen.
        </p>

        {isHost && (
          <div className="bg-amber-950/40 border border-amber-600/50 rounded-2xl p-3 text-[11px] font-mono text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Host Notice:</strong> Host authority will automatically transfer to the next eligible operative in the lobby.
            </span>
          </div>
        )}

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] flex-1 py-2.5 bg-[#293440] hover:bg-[#3B4652] active:scale-95 text-[#ECE8E1] font-mono font-bold rounded-2xl text-xs uppercase tracking-wider transition-all"
          >
            Stay in Room
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] flex-1 py-2.5 bg-[#FF4655] hover:brightness-110 active:scale-95 text-white font-mono font-black rounded-2xl text-xs uppercase tracking-wider shadow-tactical-glow transition-all"
          >
            Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}
