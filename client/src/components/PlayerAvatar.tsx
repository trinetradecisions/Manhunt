'use client';

import { PlayerTeam } from '../types/game';

interface PlayerAvatarProps {
  nickname: string;
  team: PlayerTeam;
  isHost?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function PlayerAvatar({
  nickname,
  team,
  isHost = false,
  size = 'md',
}: PlayerAvatarProps) {
  // Generate deterministic geometric seeds from nickname
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = nickname.charCodeAt(i) + ((hash << 5) - hash);
  }

  const shapes = ['polygon', 'diamond', 'hexagon', 'shield'];
  const shape = shapes[Math.abs(hash) % shapes.length];

  // Palette selection
  const accentColor =
    team === 'RUNNERS'
      ? '#39BDE8' // Accessible Cyan
      : team === 'CHASERS'
      ? '#FF4655' // Crimson
      : '#A8B0BA'; // Slate

  const bgColor =
    team === 'RUNNERS'
      ? 'bg-[#39BDE8]/20 border-[#39BDE8]/60 text-[#39BDE8]'
      : team === 'CHASERS'
      ? 'bg-[#FF4655]/20 border-[#FF4655]/60 text-[#FF4655]'
      : 'bg-[#293440] border-[#3B4652] text-[#ECE8E1]';

  const sizeClasses = {
    sm: 'w-7 h-7 text-[10px]',
    md: 'w-9 h-9 text-xs',
    lg: 'w-12 h-12 text-sm',
  }[size];

  const initials = (nickname.slice(0, 2) || 'OP').toUpperCase();

  return (
    <div
      className={`relative rounded-xl border flex items-center justify-center font-mono font-black shadow-inner shrink-0 ${bgColor} ${sizeClasses}`}
    >
      {/* Tactical Emblem Glyph */}
      <span className="tracking-tighter select-none">{initials}</span>

      {/* Decorative corner pip */}
      <span
        className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: accentColor }}
      />
    </div>
  );
}
