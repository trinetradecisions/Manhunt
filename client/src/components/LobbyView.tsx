'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  Users,
  Settings,
  Play,
  Check,
  Copy,
  Clock,
  Shield,
  Crown,
  Radio,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Compass,
  Shuffle,
  AlertTriangle,
  MoveRight,
  UserCheck,
  Zap,
  MapPin,
  PenTool,
  MessageSquare,
  Send,
  X,
  ChevronDown,
  Layers,
  Crosshair,
  User,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Hash,
  Headphones,
  PhoneOff,
  LogOut,
  Activity,
} from 'lucide-react';
import {
  RoomState,
  PlayerRole,
  PlayerTeam,
  PlayerLocation,
  PlayZone,
  ChatMessage,
  ChatRecipientType,
  VoiceChannelId,
  VoiceParticipant,
  DynamicZoneConfig,
  VoiceDiagnostics,
} from '../types/game';
import PlayerAvatar from './PlayerAvatar';
import PlayerDossierModal from './PlayerDossierModal';
import LeaveRoomModal from './LeaveRoomModal';
import VoiceDiagnosticsModal from './VoiceDiagnosticsModal';
import GpsStatusIndicator from './GpsStatusIndicator';
import { ExtendedGpsStatus } from '../hooks/useGeolocation';
import { formatArea } from '../utils/geoUtils';

const HostPlayAreaEditor = dynamic(() => import('./HostPlayAreaEditor'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[1000] bg-background/95 flex items-center justify-center font-mono text-xs text-neutral-400">
      INITIALIZING TACTICAL MAP EDITOR...
    </div>
  ),
});

interface LobbyViewProps {
  roomState: RoomState;
  myPlayerId: string;
  myLocation: PlayerLocation | null;
  gpsStatus?: ExtendedGpsStatus;
  gpsAccuracy?: number | null;
  lastFixTimestamp?: number | null;
  gpsErrorMessage?: string | null;
  isSecureContext?: boolean;
  onRequestLocationAccess?: () => void;
  socket?: any;
  onUpdateConfig: (config: any) => void;
  onUpdatePlayZone: (playZone: PlayZone) => void;
  onAssignTeam: (targetPlayerId: string, team: PlayerTeam) => void;
  onSetTargetChasers: (count: number) => void;
  onAutoAssignTeams: () => void;
  onSetRole: (targetPlayerId: string, role: PlayerRole) => void;
  onToggleReady: (ready: boolean) => void;
  onStartMatch: () => void;
  // Multi-channel Chat props
  chatMessages?: ChatMessage[];
  channelMessages?: Record<string, ChatMessage[]>;
  activeChatChannel?: string;
  unreadByChannel?: Record<string, number>;
  onSelectChatChannel?: (channelId: string) => void;
  onSendMessage?: (channelOrType: string, text: string, recipientId?: string) => void;
  onMarkChatRead?: (open?: boolean, channelId?: string) => void;
  // WebRTC Walkie-Talkie Voice props
  voice?: {
    activeVoiceChannel: VoiceChannelId | null;
    participants: VoiceParticipant[];
    speakingPlayerIds: Set<string>;
    isTransmitting: boolean;
    isMuted: boolean;
    micPermission: 'prompt' | 'granted' | 'denied' | 'requesting';
    voiceError: string | null;
    autoplayBlocked?: boolean;
    enableAudioPlayback?: () => Promise<void>;
    diagnostics?: VoiceDiagnostics;
    joinVoiceChannel: (channelId: VoiceChannelId) => void;
    leaveVoiceChannel: () => void;
    startTransmitting: () => void;
    stopTransmitting: () => void;
    toggleMute: () => void;
  };
  onLeaveRoom?: () => void;
}

export default function LobbyView({
  roomState,
  myPlayerId,
  myLocation,
  gpsStatus = 'NOT_ENABLED',
  gpsAccuracy = null,
  lastFixTimestamp = null,
  gpsErrorMessage = null,
  isSecureContext = true,
  onRequestLocationAccess,
  onUpdateConfig,
  onUpdatePlayZone,
  onAssignTeam,
  onSetTargetChasers,
  onAutoAssignTeams,
  onSetRole,
  onToggleReady,
  onStartMatch,
  chatMessages = [],
  channelMessages = {},
  activeChatChannel = 'PUBLIC',
  unreadByChannel = {},
  onSelectChatChannel,
  onSendMessage,
  onMarkChatRead,
  voice,
  onLeaveRoom,
  socket,
}: LobbyViewProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [dragOverZone, setDragOverZone] = useState<PlayerTeam | null>(null);
  const [showAutoAssignConfirm, setShowAutoAssignConfirm] = useState(false);
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'MATCH' | 'DYNAMIC_ZONE' | 'PLAY_AREA' | 'RULES' | 'MISSIONS'>('MATCH');
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [selectedDossierPlayerId, setSelectedDossierPlayerId] = useState<string | null>(null);
  const [isMobileCommsOpen, setIsMobileCommsOpen] = useState(false);
  const [showVoiceDiagnostics, setShowVoiceDiagnostics] = useState(false);

  // Local chat selection state if not controlled
  const [localChannel, setLocalChannel] = useState<string>('PUBLIC');
  const currentChannel = onSelectChatChannel ? activeChatChannel : localChannel;

  const [chatDirectRecipientId, setChatDirectRecipientId] = useState<string>('');
  const [chatInputText, setChatInputText] = useState('');
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);

  // Mobile player assignment action sheet state
  const [selectedMobilePlayerId, setSelectedMobilePlayerId] = useState<string | null>(null);

  // Zone progression calculator for live settings preview
  const calculateZoneProgression = () => {
    const dz = roomState.config.dynamicZone || {
      enabled: false,
      initialRadiusMeters: roomState.config.playZone.radiusMeters || 500,
      shrinkIntervalSeconds: 180,
      shrinkPercentage: 20,
      minRadiusMeters: 100,
      initialDelaySeconds: 120,
      warningDurationSeconds: 30,
    };
    const initialR = dz.initialRadiusMeters || roomState.config.playZone.radiusMeters || 500;
    const shrinkPct = dz.shrinkPercentage || 20;
    const minR = dz.minRadiusMeters || 100;
    const intervalMins = (dz.shrinkIntervalSeconds || 180) / 60;
    const delayMins = (dz.initialDelaySeconds || 0) / 60;

    const phases = [{ phase: 0, time: delayMins > 0 ? `Start + ${delayMins}m` : 'Match Start', radius: initialR }];
    let currentR = initialR;
    let phaseNum = 1;
    let accumulatedMins = delayMins;

    while (currentR > minR && phaseNum <= 6) {
      accumulatedMins += intervalMins;
      const nextR = Math.max(minR, Math.round(currentR * (1 - shrinkPct / 100)));
      phases.push({
        phase: phaseNum,
        time: `At ${accumulatedMins}m`,
        radius: nextR,
      });
      if (nextR <= minR) break;
      currentR = nextR;
      phaseNum++;
    }
    return phases;
  };

  const myMember = roomState.members[myPlayerId];
  const isHost = roomState.hostId === myPlayerId;
  const hostMember = roomState.members[roomState.hostId];

  const waitingPlayers = Object.values(roomState.members).filter(
    (m) => m.team === 'NONE'
  );
  const runners = Object.values(roomState.members).filter(
    (m) => m.team === 'RUNNERS'
  );
  const chasers = Object.values(roomState.members).filter(
    (m) => m.team === 'CHASERS'
  );

  const totalOperatives = Object.keys(roomState.members).length;
  const targetChasers = roomState.config.targetChaserCount || 1;
  const isChaserMismatch = chasers.length !== targetChasers;
  const canStart = runners.length >= 1 && chasers.length >= 1;

  // Resolved active conversation messages
  const activeConversationMessages: ChatMessage[] =
    channelMessages[currentChannel] ||
    chatMessages.filter((msg) => {
      if (currentChannel === 'PUBLIC') return msg.recipientType === 'ALL';
      if (currentChannel === 'SQUAD') return msg.recipientType === 'TEAM';
      if (currentChannel === 'RUNNERS') return msg.senderTeam === 'RUNNERS';
      if (currentChannel === 'CHASERS') return msg.senderTeam === 'CHASERS';
      if (currentChannel.startsWith('DM:')) return msg.recipientType === 'DIRECT';
      return false;
    });

  // Auto-scroll chat on new message
  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversationMessages.length, isMobileCommsOpen]);

  const handleCopyCode = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(roomState.roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleCopyLink = () => {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}?room=${roomState.roomCode}`
        : '';
    if (navigator?.clipboard && url) {
      navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleChannelSelect = (channelId: string) => {
    if (onSelectChatChannel) {
      onSelectChatChannel(channelId);
    } else {
      setLocalChannel(channelId);
    }
    if (onMarkChatRead) {
      onMarkChatRead(true, channelId);
    }
  };

  const handleAutoAssignClick = () => {
    if (runners.length > 0 || chasers.length > 0) {
      setShowAutoAssignConfirm(true);
    } else {
      onAutoAssignTeams();
    }
  };

  const handleDragStart = (e: React.DragEvent, playerId: string) => {
    if (!isHost) return;
    e.dataTransfer.setData('text/plain', playerId);
  };

  const handleDrop = (e: React.DragEvent, targetTeam: PlayerTeam) => {
    e.preventDefault();
    setDragOverZone(null);
    if (!isHost) return;

    const playerId = e.dataTransfer.getData('text/plain');
    if (playerId) {
      onAssignTeam(playerId, targetTeam);
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInputText.trim() || !onSendMessage) return;

    onSendMessage(
      currentChannel,
      chatInputText.trim(),
      currentChannel.startsWith('DM:') ? currentChannel.slice(3) : undefined
    );
    setChatInputText('');
  };

  const totalUnread = Object.values(unreadByChannel).reduce((acc, curr) => acc + curr, 0);

  return (
    <div className="min-h-screen bg-[#0F1923] text-[#ECE8E1] flex flex-col justify-between p-3 sm:p-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(6.5rem,env(safe-area-inset-bottom))] select-none overflow-x-hidden">
      {/* 1. VALORANT-Style Staging Header */}
      <header className="max-w-6xl w-full mx-auto mb-4 bg-[#1F2731] border border-[#3B4652] rounded-3xl p-4 sm:p-5 shadow-2xl relative overflow-hidden">
        {/* Top Decorative Tactical Accent Bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#39BDE8] via-[#4CC38A] to-[#FF4655]" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#4CC38A] animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#4CC38A] font-bold">
                Tactical Match Lobby
              </span>
              <span className="text-[10px] font-mono bg-[#293440] border border-[#3B4652] px-2 py-0.5 rounded-full text-[#ECE8E1]">
                PROTOCOL: MANHUNT
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 pt-1">
              <h1 className="text-2xl sm:text-4xl font-mono font-black tracking-widest text-white flex items-center gap-2">
                <span>{roomState.roomCode}</span>
              </h1>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={handleCopyCode}
                  title="Copy room code"
                  className="min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-xs font-mono font-bold flex items-center gap-1.5 active:scale-95 transition-all text-[#ECE8E1]"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#4CC38A]" />
                      <span className="text-[#4CC38A]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Code</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleCopyLink}
                  title="Share invitation link"
                  className="min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-xs font-mono font-bold flex items-center gap-1.5 active:scale-95 transition-all text-[#ECE8E1]"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#4CC38A]" />
                      <span className="text-[#4CC38A]">Linked</span>
                    </>
                  ) : (
                    <>
                      <Share2Icon className="w-3.5 h-3.5" />
                      <span>Invite</span>
                    </>
                  )}
                </button>

                {onLeaveRoom && (
                  <button
                    onClick={() => setShowLeaveModal(true)}
                    title="Leave Room & Return to Base"
                    className="min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-xs font-mono font-bold flex items-center gap-1.5 active:scale-95 transition-all text-[#FF4655] hover:text-white"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Exit</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Header Status Badges & Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="bg-[#293440] border border-[#3B4652] px-2.5 sm:px-3 py-1.5 rounded-2xl flex items-center gap-2 min-w-0">
              <Users className="w-4 h-4 text-[#39BDE8] shrink-0" />
              <div className="text-left font-mono min-w-0">
                <span className="text-[9px] text-[#A8B0BA] block uppercase leading-none">
                  Operatives
                </span>
                <span className="text-xs font-bold text-white leading-none">
                  {totalOperatives} Connected
                </span>
              </div>
            </div>

            <div className="bg-[#293440] border border-[#3B4652] px-2.5 sm:px-3 py-1.5 rounded-2xl flex items-center gap-2 min-w-0">
              <Crown className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="text-left font-mono min-w-0">
                <span className="text-[9px] text-[#A8B0BA] block uppercase leading-none">
                  Commander
                </span>
                <span className="text-xs font-bold text-white truncate max-w-[80px] sm:max-w-[110px] block leading-none">
                  {hostMember?.nickname || 'Host'}
                </span>
              </div>
            </div>

            {/* Mobile Communications Drawer Toggle Button */}
            <button
              onClick={() => {
                setIsMobileCommsOpen(true);
                if (onMarkChatRead) onMarkChatRead(true, currentChannel);
              }}
              className="lg:hidden min-h-[40px] px-3 py-2 rounded-2xl bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-xs font-mono font-bold text-[#ECE8E1] flex items-center gap-1.5 transition-all relative shrink-0"
            >
              <Radio className="w-4 h-4 text-[#FF4655]" />
              <span>COMMS</span>
              {totalUnread > 0 && (
                <span className="bg-[#FF4655] text-white text-[10px] px-1.5 py-0.2 rounded-full font-black animate-pulse">
                  +{totalUnread}
                </span>
              )}
            </button>

            {isHost && (
              <button
                onClick={() => setShowSettingsModal(true)}
                title="Lobby Match Settings"
                className="min-h-[40px] p-2.5 rounded-2xl bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-[#ECE8E1] hover:text-white transition-all shadow flex items-center justify-center shrink-0"
              >
                <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-[#A8B0BA] hover:text-[#4CC38A]" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Staging Viewport: 2-Column Tactical War-Room Layout */}
      <div className="max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        {/* Left Column: Personal Card, Play Area Strip, Command Deck, Team Decks */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* PERSONAL OPERATIVE IDENTITY CARD ("YOU") */}
          <div className="bg-[#1F2731] border border-[#3B4652] rounded-3xl p-4 shadow-xl relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
            <div
              onClick={() => setSelectedDossierPlayerId(myPlayerId)}
              className="flex items-center gap-3 min-w-0 cursor-pointer group"
              title="Click to view your tactical profile & dossier"
            >
              <PlayerAvatar
                nickname={myMember?.nickname || 'Operative'}
                team={myMember?.team || 'NONE'}
                size="lg"
              />
              <div className="truncate">
                <div className="flex items-center gap-2">
                  <span className="text-base font-black text-white truncate font-mono group-hover:text-[#4CC38A] transition-colors">
                    {myMember?.nickname}
                  </span>
                  <span className="text-[10px] font-mono bg-[#4CC38A]/20 border border-[#4CC38A]/50 text-[#4CC38A] px-2 py-0.5 rounded-full font-bold">
                    YOU
                  </span>
                  {isHost && (
                    <span className="text-[10px] font-mono bg-amber-950/60 border border-amber-600/60 text-amber-400 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                      <Crown className="w-3 h-3" />
                      HOST
                    </span>
                  )}
                </div>

                <div className="text-xs font-mono text-[#A8B0BA] mt-0.5 flex items-center gap-2">
                  <span>Squad:</span>
                  <span
                    className={`font-black uppercase ${
                      myMember?.team === 'RUNNERS'
                        ? 'text-[#39BDE8]'
                        : myMember?.team === 'CHASERS'
                        ? 'text-[#FF4655]'
                        : 'text-[#A8B0BA]'
                    }`}
                  >
                    {myMember?.team === 'RUNNERS'
                      ? 'Runners (Evade)'
                      : myMember?.team === 'CHASERS'
                      ? 'Chasers (Hunt)'
                      : 'Bench (Waiting)'}
                  </span>
                  <span className="text-[10px] text-[#4CC38A] underline ml-1 font-mono">
                    View Dossier
                  </span>
                </div>
              </div>
            </div>

            {/* Operative Tactical Controls (GPS & Ready) */}
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <GpsStatusIndicator
                gpsStatus={gpsStatus}
                location={myLocation}
                accuracy={gpsAccuracy}
                lastFixTimestamp={lastFixTimestamp}
                isStale={false}
                errorMessage={gpsErrorMessage}
                isSecureContext={isSecureContext}
                onRequestLocationAccess={onRequestLocationAccess || (() => {})}
              />

              {/* Ready Toggle Button */}
              <button
                onClick={() => {
                  if (!myMember?.isReady && (gpsStatus === 'NOT_ENABLED' || gpsStatus === 'PERMISSION_DENIED')) {
                    if (onRequestLocationAccess) onRequestLocationAccess();
                  }
                  onToggleReady(!myMember?.isReady);
                }}
                className={`min-h-[44px] px-5 py-2.5 rounded-2xl font-mono font-bold text-xs uppercase tracking-wider transition-all active:scale-95 border flex items-center justify-center gap-2 shadow-lg ${
                  myMember?.isReady
                    ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                    : 'bg-[#293440] border-[#3B4652] text-[#A8B0BA] hover:text-white'
                }`}
              >
                {myMember?.isReady ? (
                  <>
                    <Check className="w-4 h-4 text-[#4CC38A] stroke-[3]" />
                    <span>Ready Confirmed</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-4 h-4 text-neutral-500" />
                    <span>Mark Ready</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* PLAY AREA BOUNDARY STRIP */}
          <div className="bg-[#1F2731] border border-[#3B4652] rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#293440] border border-[#3B4652] flex items-center justify-center text-[#4CC38A] shrink-0">
                <Compass className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-white uppercase">
                    Play Area: {roomState.config.playZone.shapeType || 'CIRCLE'}
                  </span>
                  <span className="text-[10px] font-mono text-[#4CC38A] font-bold">
                    ({formatArea(
                      roomState.config.playZone.areaSquareMeters ||
                        Math.PI *
                          roomState.config.playZone.radiusMeters *
                          roomState.config.playZone.radiusMeters
                    )})
                  </span>
                </div>
                <span className="text-[10px] text-[#A8B0BA] block font-mono">
                  {roomState.config.playZone.markers?.length || 0} strategic checkpoints placed
                </span>
              </div>
            </div>

            {isHost ? (
              <button
                type="button"
                onClick={() => setIsMapEditorOpen(true)}
                className="min-h-[44px] px-3.5 py-1.5 bg-[#293440] hover:bg-[#3B4652] active:scale-95 border border-[#3B4652] rounded-xl text-xs font-mono font-bold text-[#ECE8E1] hover:text-white flex items-center justify-center gap-1.5 transition-all shadow"
              >
                <PenTool className="w-3.5 h-3.5 text-[#39BDE8]" />
                <span>Configure Area</span>
              </button>
            ) : (
              <span className="text-[10px] font-mono text-[#A8B0BA] italic self-center">
                Host boundary lock active
              </span>
            )}
          </div>

          {/* HOST COMMAND DECK (Count Stepper & Auto-Assign) */}
          {isHost && (
            <div className="bg-[#1F2731] border border-[#3B4652] rounded-3xl p-4 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#4CC38A]" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-white font-mono">
                    Host Team Balance Deck
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-[#A8B0BA]">
                  Eligible Operatives: {totalOperatives}
                </span>
              </div>

              {/* Chaser Desired Count Stepper */}
              <div className="flex items-center justify-between bg-[#293440] border border-[#3B4652] rounded-2xl p-2.5">
                <div>
                  <span className="text-xs font-mono font-bold text-white block">
                    Desired Chaser Count
                  </span>
                  <span className="text-[10px] text-[#A8B0BA] font-mono">
                    Assigned: {chasers.length} / Target: {targetChasers}
                  </span>
                </div>

                {/* Stepper Control */}
                <div className="flex items-center gap-2 bg-[#1F2731] border border-[#3B4652] rounded-2xl p-1">
                  <button
                    onClick={() => onSetTargetChasers(Math.max(1, targetChasers - 1))}
                    disabled={targetChasers <= 1}
                    className="w-8 h-8 rounded-xl bg-[#293440] hover:bg-[#3B4652] disabled:opacity-30 text-white font-bold flex items-center justify-center text-sm active:scale-95 transition-all"
                  >
                    -
                  </button>
                  <span className="w-8 text-center font-mono font-black text-sm text-[#FF4655]">
                    {targetChasers}
                  </span>
                  <button
                    onClick={() =>
                      onSetTargetChasers(
                        Math.min(Math.max(1, totalOperatives - 1), targetChasers + 1)
                      )
                    }
                    disabled={totalOperatives > 1 && targetChasers >= totalOperatives - 1}
                    className="w-8 h-8 rounded-xl bg-[#293440] hover:bg-[#3B4652] disabled:opacity-30 text-white font-bold flex items-center justify-center text-sm active:scale-95 transition-all"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Auto-Assign Action Button */}
              <button
                onClick={handleAutoAssignClick}
                disabled={totalOperatives < 2}
                className="min-h-[44px] w-full py-2.5 bg-[#293440] hover:bg-[#3B4652] active:scale-98 disabled:opacity-40 text-[#ECE8E1] border border-[#3B4652] rounded-2xl text-xs font-bold font-mono uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow"
              >
                <Shuffle className="w-3.5 h-3.5 text-[#4CC38A]" />
                <span>Auto-Assign Teams ({targetChasers} Chaser{targetChasers > 1 ? 's' : ''})</span>
              </button>

              {/* Mismatch indicator */}
              {isChaserMismatch && totalOperatives >= 2 && (
                <div className="bg-amber-950/40 border border-amber-600/50 p-2.5 rounded-2xl text-amber-300 text-[11px] font-mono flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Composition mismatch ({chasers.length} assigned vs {targetChasers} target)</span>
                  </div>
                  <button
                    onClick={handleAutoAssignClick}
                    className="text-[10px] font-bold text-amber-400 underline hover:text-white shrink-0"
                  >
                    Reconcile
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 3 TACTICAL TEAM STAGING DECKS */}
          <div className="space-y-4">
            {/* ZONE 1: WAITING ROOM / BENCH */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverZone('NONE');
              }}
              onDragLeave={() => setDragOverZone(null)}
              onDrop={(e) => handleDrop(e, 'NONE')}
              className={`bg-[#1F2731] border rounded-3xl p-4 shadow-lg transition-all ${
                dragOverZone === 'NONE'
                  ? 'border-[#ECE8E1] bg-[#293440]'
                  : 'border-[#3B4652]'
              }`}
            >
              <div className="flex items-center justify-between border-b border-[#3B4652] pb-2.5 mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#A8B0BA]" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-[#ECE8E1] font-mono">
                    Waiting Room / Bench ({waitingPlayers.length})
                  </h3>
                </div>
                <span className="text-[10px] text-[#A8B0BA] font-mono font-bold uppercase">
                  Unassigned
                </span>
              </div>

              {waitingPlayers.length === 0 ? (
                <p className="text-[11px] text-[#A8B0BA] italic py-2 text-center font-mono">
                  All operatives deployed to active squads.
                </p>
              ) : (
                <div className="space-y-2">
                  {waitingPlayers.map((m) => (
                    <PlayerCard
                      key={m.id}
                      member={m}
                      myPlayerId={myPlayerId}
                      hostId={roomState.hostId}
                      isHost={isHost}
                      onDragStart={handleDragStart}
                      onAssignTeam={onAssignTeam}
                      onSelectMobilePlayer={setSelectedMobilePlayerId}
                      onSelectDossier={setSelectedDossierPlayerId}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ZONE 2: RUNNERS SQUAD (Cyan Identity) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverZone('RUNNERS');
              }}
              onDragLeave={() => setDragOverZone(null)}
              onDrop={(e) => handleDrop(e, 'RUNNERS')}
              className={`bg-[#1F2731] border rounded-3xl p-4 shadow-lg transition-all ${
                dragOverZone === 'RUNNERS'
                  ? 'border-[#39BDE8] bg-[#39BDE8]/10'
                  : 'border-[#3B4652]'
              }`}
            >
              <div className="flex items-center justify-between border-b border-[#3B4652] pb-2.5 mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#39BDE8] animate-pulse" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-[#39BDE8] font-mono">
                    Runners ({runners.length})
                  </h3>
                </div>
                <span className="text-[10px] text-[#39BDE8] font-mono font-bold uppercase tracking-wider">
                  Disperse &amp; Evade
                </span>
              </div>

              {runners.length === 0 ? (
                <p className="text-[11px] text-[#A8B0BA] italic py-2 text-center font-mono">
                  No operatives assigned to Runners yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {runners.map((m) => (
                    <PlayerCard
                      key={m.id}
                      member={m}
                      myPlayerId={myPlayerId}
                      hostId={roomState.hostId}
                      isHost={isHost}
                      onDragStart={handleDragStart}
                      onAssignTeam={onAssignTeam}
                      onSelectMobilePlayer={setSelectedMobilePlayerId}
                      onSelectDossier={setSelectedDossierPlayerId}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ZONE 3: CHASERS SQUAD (Crimson Identity) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverZone('CHASERS');
              }}
              onDragLeave={() => setDragOverZone(null)}
              onDrop={(e) => handleDrop(e, 'CHASERS')}
              className={`bg-[#1F2731] border rounded-3xl p-4 shadow-lg transition-all ${
                dragOverZone === 'CHASERS'
                  ? 'border-[#FF4655] bg-[#FF4655]/10'
                  : 'border-[#3B4652]'
              }`}
            >
              <div className="flex items-center justify-between border-b border-[#3B4652] pb-2.5 mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF4655] animate-pulse" />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-[#FF4655] font-mono">
                    Chasers ({chasers.length})
                  </h3>
                </div>
                <span className="text-[10px] text-[#FF4655] font-mono font-bold uppercase tracking-wider">
                  Hunt &amp; Apprehend
                </span>
              </div>

              {chasers.length === 0 ? (
                <p className="text-[11px] text-[#A8B0BA] italic py-2 text-center font-mono">
                  No operatives assigned to Chasers yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {chasers.map((m) => (
                    <PlayerCard
                      key={m.id}
                      member={m}
                      myPlayerId={myPlayerId}
                      hostId={roomState.hostId}
                      isHost={isHost}
                      onDragStart={handleDragStart}
                      onAssignTeam={onAssignTeam}
                      onSelectMobilePlayer={setSelectedMobilePlayerId}
                      onSelectDossier={setSelectedDossierPlayerId}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: DISCORD-STYLE COMMUNICATIONS & WALKIE-TALKIE PANEL (Desktop) */}
        <div className="hidden lg:flex lg:col-span-4 flex-col bg-[#1F2731] border border-[#3B4652] rounded-3xl overflow-hidden shadow-2xl h-[calc(100vh-170px)] min-h-[540px] max-h-[850px] sticky top-4">
          {/* Communications Header */}
          <div className="p-4 border-b border-[#3B4652] bg-[#293440] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#FF4655]" />
              <h3 className="font-mono font-bold text-xs uppercase tracking-wider text-white">
                Tactical Comms
              </h3>
            </div>
            <span className="text-[10px] font-mono text-[#A8B0BA] uppercase">
              WebRTC &bull; Discord Mesh
            </span>
          </div>

          {/* Discord-Style Channel Selector */}
          <div className="p-2 border-b border-[#3B4652] bg-[#161e27] space-y-1">
            <span className="text-[9px] font-mono uppercase text-[#A8B0BA] px-2 block font-bold tracking-wider">
              Text Channels
            </span>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => handleChannelSelect('PUBLIC')}
                className={`min-h-[36px] px-2 py-1.5 rounded-xl font-mono text-xs font-bold text-left flex items-center justify-between transition-all ${
                  currentChannel === 'PUBLIC'
                    ? 'bg-[#293440] text-white border border-[#3B4652]'
                    : 'text-[#A8B0BA] hover:text-white hover:bg-[#293440]/50'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Hash className="w-3.5 h-3.5 text-[#A8B0BA]" />
                  <span className="truncate">public</span>
                </div>
                {(unreadByChannel['PUBLIC'] || 0) > 0 && (
                  <span className="bg-[#FF4655] text-white text-[9px] px-1.5 rounded-full font-black">
                    +{unreadByChannel['PUBLIC']}
                  </span>
                )}
              </button>

              <button
                onClick={() => handleChannelSelect('SQUAD')}
                disabled={myMember?.team === 'NONE'}
                className={`min-h-[36px] px-2 py-1.5 rounded-xl font-mono text-xs font-bold text-left flex items-center justify-between transition-all disabled:opacity-30 ${
                  currentChannel === 'SQUAD'
                    ? myMember?.team === 'RUNNERS'
                      ? 'bg-[#39BDE8]/20 text-[#39BDE8] border border-[#39BDE8]/40'
                      : 'bg-[#FF4655]/20 text-[#FF4655] border border-[#FF4655]/40'
                    : 'text-[#A8B0BA] hover:text-white hover:bg-[#293440]/50'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Hash className="w-3.5 h-3.5" />
                  <span className="truncate">squad-comms</span>
                </div>
                {(unreadByChannel['SQUAD'] || 0) > 0 && (
                  <span className="bg-[#FF4655] text-white text-[9px] px-1.5 rounded-full font-black">
                    +{unreadByChannel['SQUAD']}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* REAL WALKIE-TALKIE PUSH-TO-TALK VOICE WIDGET */}
          {voice && (
            <div className="p-3 border-b border-[#3B4652] bg-[#161e27] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono uppercase text-[#A8B0BA] font-bold tracking-wider flex items-center gap-1">
                  <Headphones className="w-3 h-3 text-[#4CC38A]" />
                  <span>Voice Channels</span>
                </span>
                <div className="flex items-center gap-1.5">
                  {voice.activeVoiceChannel ? (
                    voice.diagnostics?.status === 'CONNECTED' ? (
                      <span className="text-[10px] font-mono text-[#4CC38A] font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#4CC38A] animate-pulse" />
                        {voice.activeVoiceChannel} ({voice.diagnostics.connectedPeerCount} Peer{voice.diagnostics.connectedPeerCount > 1 ? 's' : ''})
                      </span>
                    ) : voice.diagnostics?.status === 'WAITING_PEERS' ? (
                      <span className="text-[10px] font-mono text-amber-400 font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        {voice.activeVoiceChannel} (Awaiting Peers)
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-[#39BDE8] font-bold flex items-center gap-1 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#39BDE8]" />
                        {voice.diagnostics?.status || 'CONNECTING'}...
                      </span>
                    )
                  ) : (
                    <span className="text-[10px] font-mono text-[#A8B0BA]">Disconnected</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowVoiceDiagnostics(true)}
                    className="p-1 rounded bg-[#293440] hover:bg-[#3B4652] text-[#A8B0BA] hover:text-white transition-colors"
                    title="Voice Diagnostics"
                  >
                    <Activity className="w-3 h-3 text-[#39BDE8]" />
                  </button>
                </div>
              </div>

              {/* Voice Channel Join Buttons */}
              <div className="flex gap-1.5">
                <button
                  onClick={() =>
                    voice.activeVoiceChannel === 'SQUAD'
                      ? voice.leaveVoiceChannel()
                      : voice.joinVoiceChannel('SQUAD')
                  }
                  disabled={myMember?.team === 'NONE'}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-30 border ${
                    voice.activeVoiceChannel === 'SQUAD'
                      ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                      : 'bg-[#293440] border-[#3B4652] text-[#A8B0BA] hover:text-white'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Squad Radio</span>
                </button>

                <button
                  onClick={() =>
                    voice.activeVoiceChannel === 'PUBLIC'
                      ? voice.leaveVoiceChannel()
                      : voice.joinVoiceChannel('PUBLIC')
                  }
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all border ${
                    voice.activeVoiceChannel === 'PUBLIC'
                      ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                      : 'bg-[#293440] border-[#3B4652] text-[#A8B0BA] hover:text-white'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Public Radio</span>
                </button>
              </div>

              {/* Autoplay Blocked Banner */}
              {voice.autoplayBlocked && (
                <button
                  type="button"
                  onClick={voice.enableAudioPlayback}
                  className="w-full py-2 px-3 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-amber-300 font-mono text-[10px] rounded-xl font-bold flex items-center justify-center gap-1.5 animate-pulse transition-all shadow"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Audio Blocked By Browser — Tap to Enable Playback</span>
                </button>
              )}

              {/* Active Voice Controls & PTT Button */}
              {voice.activeVoiceChannel && (
                <div className="space-y-2 pt-1">
                  {/* Push-to-Talk Button */}
                  <button
                    onPointerDown={(e) => {
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // Ignored
                      }
                      voice.startTransmitting();
                    }}
                    onPointerUp={(e) => {
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        // Ignored
                      }
                      voice.stopTransmitting();
                    }}
                    onPointerCancel={(e) => {
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        // Ignored
                      }
                      voice.stopTransmitting();
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ touchAction: 'none' }}
                    className={`w-full min-h-[48px] rounded-2xl font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-95 border select-none ${
                      voice.isTransmitting
                        ? 'bg-[#FF4655] text-white border-[#FF4655] shadow-tactical-glow animate-pulse'
                        : 'bg-[#293440] border-[#3B4652] text-white hover:border-[#FF4655]'
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    <span>
                      {voice.isTransmitting
                        ? 'TRANSMITTING LIVE...'
                        : 'HOLD PTT TO TALK [V / PRESS]'}
                    </span>
                  </button>

                  {/* Voice Error Notice */}
                  {voice.voiceError && (
                    <div className="p-2 rounded-xl bg-[#FF4655]/20 border border-[#FF4655]/50 text-[#FF4655] text-[10px] font-mono flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span className="flex-1 break-words leading-tight">{voice.voiceError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[10px] font-mono text-[#A8B0BA]">
                    <button
                      onClick={voice.toggleMute}
                      className="flex items-center gap-1 hover:text-white"
                    >
                      {voice.isMuted ? (
                        <>
                          <MicOff className="w-3.5 h-3.5 text-[#FF4655]" />
                          <span>Muted</span>
                        </>
                      ) : (
                        <>
                          <Mic className="w-3.5 h-3.5 text-[#4CC38A]" />
                          <span>Mic Active</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={voice.leaveVoiceChannel}
                      className="flex items-center gap-1 text-[#FF4655] hover:underline"
                    >
                      <PhoneOff className="w-3 h-3" />
                      <span>Disconnect</span>
                    </button>
                  </div>

                  {/* Connected Voice Members Speaking Halos */}
                  {voice.participants.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      {voice.participants.map((p) => {
                        const isSpeaking = voice.speakingPlayerIds.has(p.playerId);
                        return (
                          <div
                            key={p.playerId}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                              isSpeaking
                                ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A] animate-pulse font-bold'
                                : 'bg-[#293440] border-[#3B4652] text-[#A8B0BA]'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isSpeaking ? 'bg-[#4CC38A]' : 'bg-[#A8B0BA]'
                              }`}
                            />
                            <span>{p.nickname}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Active Channel Messages Feed */}
          <div className="flex-1 p-3 overflow-y-auto space-y-2 text-xs">
            {activeConversationMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <MessageSquare className="w-6 h-6 text-[#A8B0BA] mb-2 opacity-50" />
                <p className="text-[#A8B0BA] font-mono text-xs">
                  Channel #{currentChannel.toLowerCase()} is quiet.
                </p>
                <span className="text-[10px] text-neutral-500 font-mono mt-1">
                  Send a message to coordinate with operatives.
                </span>
              </div>
            ) : (
              activeConversationMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.senderId === myPlayerId ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="text-[10px] font-mono text-[#A8B0BA] mb-0.5 flex items-center gap-1.5">
                    <span className="font-bold text-white">{msg.senderNickname}</span>
                    <span>&bull;</span>
                    <span>
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {msg.senderTeam === 'RUNNERS' && (
                      <span className="text-[#39BDE8] font-bold">[RUNNER]</span>
                    )}
                    {msg.senderTeam === 'CHASERS' && (
                      <span className="text-[#FF4655] font-bold">[CHASER]</span>
                    )}
                  </div>
                  <div
                    className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-xs break-words ${
                      msg.senderId === myPlayerId
                        ? 'bg-[#FF4655] text-white font-medium shadow'
                        : 'bg-[#293440] border border-[#3B4652] text-[#ECE8E1]'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))
            )}
            <div ref={chatMessagesEndRef} />
          </div>

          {/* Input Message Composer */}
          <form
            onSubmit={handleSendChat}
            className="p-3 border-t border-[#3B4652] bg-[#293440] flex items-center gap-2"
          >
            <input
              type="text"
              value={chatInputText}
              onChange={(e) => setChatInputText(e.target.value)}
              placeholder={`Message #${currentChannel.toLowerCase()}...`}
              maxLength={300}
              className="flex-1 min-h-[44px] bg-[#1F2731] border border-[#3B4652] rounded-xl px-4 py-2 text-xs text-white placeholder-[#A8B0BA] focus:outline-none focus:border-[#FF4655]"
            />
            <button
              type="submit"
              disabled={!chatInputText.trim()}
              className="min-h-[44px] px-4 bg-[#FF4655] text-white font-black rounded-xl text-xs flex items-center justify-center disabled:opacity-40 hover:brightness-110 active:scale-95 transition-all shadow"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* 4. Mobile Communications Drawer / Bottom Sheet */}
      {isMobileCommsOpen && (
        <div className="lg:hidden fixed inset-0 z-[700] bg-black/80 backdrop-blur-sm flex flex-col justify-end">
          <div className="w-full h-[85vh] bg-[#1F2731] border-t border-[#3B4652] rounded-t-3xl flex flex-col shadow-2xl overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))]">
            {/* Header */}
            <div className="p-4 border-b border-[#3B4652] flex items-center justify-between bg-[#293440]">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[#FF4655]" />
                <h3 className="font-mono font-bold text-xs uppercase tracking-wider text-white">
                  Lobby Tactical Comms
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsMobileCommsOpen(false);
                  if (onMarkChatRead) onMarkChatRead(false, currentChannel);
                }}
                className="p-1.5 rounded-xl bg-[#1F2731] text-[#A8B0BA] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Channels Switcher */}
            <div className="p-2 border-b border-[#3B4652] flex gap-2 bg-[#161e27]">
              <button
                onClick={() => handleChannelSelect('PUBLIC')}
                className={`flex-1 py-2 rounded-xl font-mono text-xs font-bold uppercase ${
                  currentChannel === 'PUBLIC'
                    ? 'bg-[#293440] text-white border border-[#3B4652]'
                    : 'text-[#A8B0BA]'
                }`}
              >
                Public
              </button>
              <button
                onClick={() => handleChannelSelect('SQUAD')}
                disabled={myMember?.team === 'NONE'}
                className={`flex-1 py-2 rounded-xl font-mono text-xs font-bold uppercase disabled:opacity-40 ${
                  currentChannel === 'SQUAD'
                    ? myMember?.team === 'RUNNERS'
                      ? 'bg-[#39BDE8]/20 text-[#39BDE8] border border-[#39BDE8]/50'
                      : 'bg-[#FF4655]/20 text-[#FF4655] border border-[#FF4655]/50'
                    : 'text-[#A8B0BA]'
                }`}
              >
                Squad Comms
              </button>
            </div>

            {/* Mobile PTT Voice Widget */}
            {voice && (
              <div className="p-3 border-b border-[#3B4652] bg-[#161e27] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono uppercase text-[#A8B0BA] font-bold tracking-wider flex items-center gap-1">
                    <Headphones className="w-3 h-3 text-[#4CC38A]" />
                    <span>Voice Channels</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    {voice.activeVoiceChannel ? (
                      voice.diagnostics?.status === 'CONNECTED' ? (
                        <span className="text-[10px] font-mono text-[#4CC38A] font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#4CC38A] animate-pulse" />
                          {voice.activeVoiceChannel} ({voice.diagnostics.connectedPeerCount} Peer{voice.diagnostics.connectedPeerCount > 1 ? 's' : ''})
                        </span>
                      ) : voice.diagnostics?.status === 'WAITING_PEERS' ? (
                        <span className="text-[10px] font-mono text-amber-400 font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          {voice.activeVoiceChannel} (Awaiting)
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-[#39BDE8] font-bold flex items-center gap-1 animate-pulse">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#39BDE8]" />
                          {voice.diagnostics?.status || 'CONNECTING'}
                        </span>
                      )
                    ) : (
                      <span className="text-[10px] font-mono text-[#A8B0BA]">Disconnected</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowVoiceDiagnostics(true)}
                      className="p-1 rounded bg-[#293440] hover:bg-[#3B4652] text-[#39BDE8]"
                      title="Voice Diagnostics"
                    >
                      <Activity className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      voice.activeVoiceChannel === 'SQUAD'
                        ? voice.leaveVoiceChannel()
                        : voice.joinVoiceChannel('SQUAD')
                    }
                    disabled={myMember?.team === 'NONE'}
                    className={`flex-1 min-h-[38px] rounded-xl text-xs font-mono font-bold border flex items-center justify-center gap-1 ${
                      voice.activeVoiceChannel === 'SQUAD'
                        ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                        : 'bg-[#293440] border-[#3B4652] text-[#A8B0BA]'
                    }`}
                  >
                    <span>Squad Radio</span>
                  </button>
                  <button
                    onClick={() =>
                      voice.activeVoiceChannel === 'PUBLIC'
                        ? voice.leaveVoiceChannel()
                        : voice.joinVoiceChannel('PUBLIC')
                    }
                    className={`flex-1 min-h-[38px] rounded-xl text-xs font-mono font-bold border flex items-center justify-center gap-1 ${
                      voice.activeVoiceChannel === 'PUBLIC'
                        ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                        : 'bg-[#293440] border-[#3B4652] text-[#A8B0BA]'
                    }`}
                  >
                    <span>Public Radio</span>
                  </button>
                </div>

                {voice.autoplayBlocked && (
                  <button
                    type="button"
                    onClick={voice.enableAudioPlayback}
                    className="w-full py-2 px-3 bg-amber-500/20 border border-amber-500/60 text-amber-300 font-mono text-[10px] rounded-xl font-bold flex items-center justify-center gap-1.5 animate-pulse transition-all shadow"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Audio Blocked By Browser — Tap to Enable</span>
                  </button>
                )}

                {voice.activeVoiceChannel && (
                  <button
                    onPointerDown={(e) => {
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // Ignored
                      }
                      voice.startTransmitting();
                    }}
                    onPointerUp={(e) => {
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        // Ignored
                      }
                      voice.stopTransmitting();
                    }}
                    onPointerCancel={(e) => {
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        // Ignored
                      }
                      voice.stopTransmitting();
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ touchAction: 'none' }}
                    className={`w-full min-h-[48px] rounded-2xl font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 border select-none active:scale-98 ${
                      voice.isTransmitting
                        ? 'bg-[#FF4655] text-white border-[#FF4655] shadow-tactical-glow animate-pulse'
                        : 'bg-[#293440] border-[#3B4652] text-white'
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    <span>
                      {voice.isTransmitting
                        ? 'TRANSMITTING LIVE...'
                        : 'HOLD TO TALK [TOUCH & HOLD]'}
                    </span>
                  </button>
                )}

                {/* Voice Error Notice on Mobile */}
                {voice.voiceError && (
                  <div className="p-2 rounded-xl bg-[#FF4655]/20 border border-[#FF4655]/50 text-[#FF4655] text-[10px] font-mono flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1 break-words leading-tight">{voice.voiceError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Messages Feed */}
            <div className="flex-1 p-3 overflow-y-auto space-y-2 text-xs">
              {activeConversationMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.senderId === myPlayerId ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="text-[10px] font-mono text-[#A8B0BA] mb-0.5">
                    {msg.senderNickname} &bull;{' '}
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  <div
                    className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-xs break-words ${
                      msg.senderId === myPlayerId
                        ? 'bg-[#FF4655] text-white font-bold'
                        : 'bg-[#293440] border border-[#3B4652] text-[#ECE8E1]'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatMessagesEndRef} />
            </div>

            {/* Input Composer */}
            <form
              onSubmit={handleSendChat}
              className="p-3 border-t border-[#3B4652] flex items-center gap-2 bg-[#293440]"
            >
              <input
                type="text"
                value={chatInputText}
                onChange={(e) => setChatInputText(e.target.value)}
                placeholder="Transmit message..."
                maxLength={300}
                className="flex-1 min-h-[44px] bg-[#1F2731] border border-[#3B4652] rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-[#FF4655]"
              />
              <button
                type="submit"
                disabled={!chatInputText.trim()}
                className="min-h-[44px] px-4 bg-[#FF4655] text-white font-black rounded-xl text-xs flex items-center justify-center disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 5. Mobile Player Assignment Action Sheet */}
      {selectedMobilePlayerId && isHost && (
        <div className="fixed inset-0 z-[800] bg-black/80 backdrop-blur-sm flex flex-col justify-end p-4 select-none">
          <div className="bg-[#1F2731] border border-[#3B4652] rounded-3xl p-5 shadow-2xl space-y-3.5 max-w-sm w-full mx-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between border-b border-[#3B4652] pb-2">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#4CC38A]" />
                <h3 className="font-mono font-bold text-xs uppercase tracking-wider text-white">
                  Assign {roomState.members[selectedMobilePlayerId]?.nickname}
                </h3>
              </div>
              <button
                onClick={() => setSelectedMobilePlayerId(null)}
                className="text-[#A8B0BA] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => {
                  onAssignTeam(selectedMobilePlayerId, 'RUNNERS');
                  setSelectedMobilePlayerId(null);
                }}
                className="w-full min-h-[44px] py-3 px-4 rounded-2xl bg-[#39BDE8]/20 border border-[#39BDE8]/60 text-[#39BDE8] font-mono font-bold text-xs uppercase flex items-center justify-between active:scale-98 transition-all"
              >
                <span>Deploy to Runners (Evade)</span>
                <MoveRight className="w-4 h-4 text-[#39BDE8]" />
              </button>

              <button
                onClick={() => {
                  onAssignTeam(selectedMobilePlayerId, 'CHASERS');
                  setSelectedMobilePlayerId(null);
                }}
                className="w-full min-h-[44px] py-3 px-4 rounded-2xl bg-[#FF4655]/20 border border-[#FF4655]/60 text-[#FF4655] font-mono font-bold text-xs uppercase flex items-center justify-between active:scale-98 transition-all"
              >
                <span>Deploy to Chasers (Hunt)</span>
                <MoveRight className="w-4 h-4 text-[#FF4655]" />
              </button>

              <button
                onClick={() => {
                  onAssignTeam(selectedMobilePlayerId, 'NONE');
                  setSelectedMobilePlayerId(null);
                }}
                className="w-full min-h-[44px] py-3 px-4 rounded-2xl bg-[#293440] border border-[#3B4652] text-[#ECE8E1] font-mono font-bold text-xs uppercase flex items-center justify-between active:scale-98 transition-all"
              >
                <span>Return to Waiting Room (Bench)</span>
                <Clock className="w-4 h-4 text-[#A8B0BA]" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Auto-Assign Overwrite Confirmation Modal */}
      {showAutoAssignConfirm && (
        <div className="fixed inset-0 z-[850] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1F2731] border border-[#3B4652] w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>Overwrite Manual Team Assignments?</span>
            </div>
            <p className="text-xs text-[#ECE8E1] leading-relaxed">
              Manual assignments already exist. Running Auto-Assign will randomly shuffle all connected players into {targetChasers} Chaser{targetChasers > 1 ? 's' : ''} and {Math.max(1, totalOperatives - targetChasers)} Runner{Math.max(1, totalOperatives - targetChasers) > 1 ? 's' : ''}.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAutoAssignConfirm(false)}
                className="min-h-[44px] flex-1 py-2.5 bg-[#293440] hover:bg-[#3B4652] text-[#ECE8E1] font-bold rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowAutoAssignConfirm(false);
                  onAutoAssignTeams();
                }}
                className="min-h-[44px] flex-1 py-2.5 bg-[#4CC38A] text-[#0F1923] font-black rounded-xl text-xs shadow-lime-glow uppercase"
              >
                Confirm Auto-Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Host Settings Modal */}
      {showSettingsModal && isHost && (
        <div className="fixed inset-0 z-[900] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none">
          <div className="bg-[#1F2731] border border-[#3B4652] w-full max-w-lg rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#3B4652] pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#4CC38A]" />
                <h3 className="text-xs font-black uppercase tracking-wider text-white font-mono">
                  Command Deck Settings
                </h3>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-[#A8B0BA] hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-1 bg-[#161e27] p-1 rounded-2xl border border-[#3B4652]">
              <button
                type="button"
                onClick={() => setSettingsTab('MATCH')}
                className={`flex-1 py-1.5 rounded-xl font-mono text-[10px] sm:text-xs font-bold uppercase transition-all ${
                  settingsTab === 'MATCH'
                    ? 'bg-[#293440] text-white border border-[#3B4652] shadow'
                    : 'text-[#A8B0BA] hover:text-white'
                }`}
              >
                Match
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab('DYNAMIC_ZONE')}
                className={`flex-1 py-1.5 rounded-xl font-mono text-[10px] sm:text-xs font-bold uppercase transition-all flex items-center justify-center gap-1 ${
                  settingsTab === 'DYNAMIC_ZONE'
                    ? 'bg-[#293440] text-[#FF4655] border border-[#FF4655]/50 shadow'
                    : 'text-[#A8B0BA] hover:text-white'
                }`}
              >
                <Zap className="w-3 h-3" />
                <span>Zone</span>
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab('PLAY_AREA')}
                className={`flex-1 py-1.5 rounded-xl font-mono text-[10px] sm:text-xs font-bold uppercase transition-all ${
                  settingsTab === 'PLAY_AREA'
                    ? 'bg-[#293440] text-[#39BDE8] border border-[#39BDE8]/50 shadow'
                    : 'text-[#A8B0BA] hover:text-white'
                }`}
              >
                Area
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab('RULES')}
                className={`flex-1 py-1.5 rounded-xl font-mono text-[10px] sm:text-xs font-bold uppercase transition-all ${
                  settingsTab === 'RULES'
                    ? 'bg-[#293440] text-white border border-[#3B4652] shadow'
                    : 'text-[#A8B0BA] hover:text-white'
                }`}
              >
                Rules
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab('MISSIONS')}
                className={`flex-1 py-1.5 rounded-xl font-mono text-[10px] sm:text-xs font-bold uppercase transition-all flex items-center justify-center gap-1 ${
                  settingsTab === 'MISSIONS'
                    ? 'bg-[#293440] text-[#FFB800] border border-[#FFB800]/50 shadow'
                    : 'text-[#A8B0BA] hover:text-white'
                }`}
              >
                <Crosshair className="w-3 h-3 text-[#FFB800]" />
                <span>Missions</span>
              </button>
            </div>

            {/* TAB 1: MATCH */}
            {settingsTab === 'MATCH' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                      Match Duration
                    </label>
                    <select
                      value={roomState.config.durationSeconds}
                      onChange={(e) =>
                        onUpdateConfig({ durationSeconds: parseInt(e.target.value, 10) })
                      }
                      className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#4CC38A]"
                    >
                      <option value={600}>10 Minutes</option>
                      <option value={900}>15 Minutes (Standard)</option>
                      <option value={1200}>20 Minutes</option>
                      <option value={1800}>30 Minutes</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                      Runner Head Start
                    </label>
                    <select
                      value={roomState.config.globalHeadStartSeconds}
                      onChange={(e) =>
                        onUpdateConfig({
                          globalHeadStartSeconds: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#4CC38A]"
                    >
                      <option value={60}>1 Minute</option>
                      <option value={120}>2 Minutes (Standard)</option>
                      <option value={180}>3 Minutes</option>
                      <option value={300}>5 Minutes</option>
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                      Chaser Radar Intel Snapshot
                    </label>
                    <select
                      value={roomState.config.runnerSnapshotIntervalSeconds || 120}
                      onChange={(e) =>
                        onUpdateConfig({
                          runnerSnapshotIntervalSeconds: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#4CC38A]"
                    >
                      <option value={60}>Every 60s (Frequent Radar)</option>
                      <option value={120}>Every 120s (Standard Radar)</option>
                      <option value={180}>Every 180s (Stealth / Hardcore)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: DYNAMIC ZONE */}
            {settingsTab === 'DYNAMIC_ZONE' && (
              <div className="space-y-3.5">
                {/* Dynamic Zone Toggle */}
                <div className="flex items-center justify-between bg-[#293440] border border-[#3B4652] rounded-2xl p-3">
                  <div>
                    <span className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-[#FF4655]" />
                      <span>Dynamic Shrinking Safe Zone</span>
                    </span>
                    <span className="text-[10px] text-[#A8B0BA] font-mono block mt-0.5">
                      Zone contracts periodically to force operative encounters
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateConfig({
                        dynamicZone: {
                          ...(roomState.config.dynamicZone || {
                            initialRadiusMeters: roomState.config.playZone.radiusMeters || 500,
                            shrinkIntervalSeconds: 180,
                            shrinkPercentage: 20,
                            minRadiusMeters: 100,
                            initialDelaySeconds: 120,
                            warningDurationSeconds: 30,
                          }),
                          enabled: !roomState.config.dynamicZone?.enabled,
                        },
                      })
                    }
                    className={`min-h-[32px] px-3 py-1 rounded-xl font-mono text-[11px] font-bold uppercase transition-all border ${
                      roomState.config.dynamicZone?.enabled
                        ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                        : 'bg-[#1F2731] border-[#3B4652] text-[#A8B0BA]'
                    }`}
                  >
                    {roomState.config.dynamicZone?.enabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>

                {roomState.config.dynamicZone?.enabled && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                          Initial Zone Radius
                        </label>
                        <select
                          value={
                            roomState.config.dynamicZone.initialRadiusMeters ||
                            roomState.config.playZone.radiusMeters ||
                            500
                          }
                          onChange={(e) =>
                            onUpdateConfig({
                              dynamicZone: {
                                ...roomState.config.dynamicZone,
                                initialRadiusMeters: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#FF4655]"
                        >
                          <option value={300}>300m</option>
                          <option value={500}>500m</option>
                          <option value={800}>800m</option>
                          <option value={1000}>1,000m (1 km)</option>
                          <option value={1500}>1,500m (1.5 km)</option>
                          <option value={2000}>2,000m (2 km)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                          Shrink Interval
                        </label>
                        <select
                          value={roomState.config.dynamicZone.shrinkIntervalSeconds || 180}
                          onChange={(e) =>
                            onUpdateConfig({
                              dynamicZone: {
                                ...roomState.config.dynamicZone,
                                shrinkIntervalSeconds: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#FF4655]"
                        >
                          <option value={60}>Every 1 min</option>
                          <option value={120}>Every 2 min</option>
                          <option value={180}>Every 3 min (Standard)</option>
                          <option value={300}>Every 5 min</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                          Shrink Rate (%)
                        </label>
                        <select
                          value={roomState.config.dynamicZone.shrinkPercentage || 20}
                          onChange={(e) =>
                            onUpdateConfig({
                              dynamicZone: {
                                ...roomState.config.dynamicZone,
                                shrinkPercentage: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#FF4655]"
                        >
                          <option value={10}>10% per phase</option>
                          <option value={15}>15% per phase</option>
                          <option value={20}>20% per phase (Standard)</option>
                          <option value={25}>25% per phase</option>
                          <option value={30}>30% per phase</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                          Minimum Safe Radius
                        </label>
                        <select
                          value={roomState.config.dynamicZone.minRadiusMeters || 100}
                          onChange={(e) =>
                            onUpdateConfig({
                              dynamicZone: {
                                ...roomState.config.dynamicZone,
                                minRadiusMeters: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#FF4655]"
                        >
                          <option value={50}>50m (Clustered)</option>
                          <option value={100}>100m (Standard)</option>
                          <option value={150}>150m</option>
                          <option value={200}>200m (Open)</option>
                        </select>
                      </div>
                    </div>

                    {/* Planned Zone Progression Live Preview Table */}
                    <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#A8B0BA] font-bold">
                          Planned Zone Progression Preview
                        </span>
                        <span className="text-[9px] font-mono text-[#4CC38A]">
                          Formula: max(minR, currentR &times; (1 - {roomState.config.dynamicZone.shrinkPercentage || 20}%))
                        </span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-32 overflow-y-auto pr-1">
                        {calculateZoneProgression().map((step) => (
                          <div
                            key={step.phase}
                            className="bg-[#293440] border border-[#3B4652] rounded-xl p-2 text-center"
                          >
                            <span className="text-[9px] font-mono text-[#A8B0BA] block uppercase">
                              Phase {step.phase} ({step.time})
                            </span>
                            <span className="text-xs font-mono font-black text-white">
                              {step.radius}m
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: PLAY AREA */}
            {settingsTab === 'PLAY_AREA' && (
              <div className="space-y-3">
                <div className="bg-[#293440] border border-[#3B4652] rounded-2xl p-3 space-y-2">
                  <span className="text-xs font-mono font-bold text-white block">
                    Play Zone Shape & Radius Presets
                  </span>
                  <select
                    value={roomState.config.playZone.radiusMeters}
                    onChange={(e) =>
                      onUpdateConfig({
                        playZone: {
                          ...roomState.config.playZone,
                          radiusMeters: parseInt(e.target.value, 10),
                        },
                      })
                    }
                    className="w-full bg-[#1F2731] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#39BDE8]"
                  >
                    <option value={200}>200m (Park)</option>
                    <option value={500}>500m (Campus / Standard)</option>
                    <option value={1000}>1km (District)</option>
                    <option value={2000}>2km (Wide Area)</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsModal(false);
                    setIsMapEditorOpen(true);
                  }}
                  className="w-full min-h-[44px] py-2.5 bg-[#293440] hover:bg-[#3B4652] active:scale-98 border border-[#39BDE8]/50 text-[#39BDE8] font-mono font-bold rounded-2xl text-xs uppercase flex items-center justify-center gap-2 transition-all shadow"
                >
                  <PenTool className="w-4 h-4 text-[#39BDE8]" />
                  <span>Open Full Tactical Map Editor</span>
                </button>
              </div>
            )}

            {/* TAB 4: RULES */}
            {settingsTab === 'RULES' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                      Catch Proximity Threshold
                    </label>
                    <select
                      value={roomState.config.catchProximityThresholdMeters}
                      onChange={(e) =>
                        onUpdateConfig({
                          catchProximityThresholdMeters: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#4CC38A]"
                    >
                      <option value={15}>15m (Tight / High Precision)</option>
                      <option value={25}>25m (Standard Outdoor)</option>
                      <option value={35}>35m (Open Field / Forest)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#A8B0BA] block mb-1 font-mono">
                      Tactical Walkie-Talkie Radio
                    </label>
                    <select
                      value={roomState.config.radioEnabled ? 'true' : 'false'}
                      onChange={(e) =>
                        onUpdateConfig({
                          radioEnabled: e.target.value === 'true',
                        })
                      }
                      className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#4CC38A]"
                    >
                      <option value="true">Enabled (Voice Active)</option>
                      <option value="false">Disabled (Silent Mode)</option>
                    </select>
                  </div>
                </div>

                {/* Leave Room option inside settings */}
                <div className="pt-2 border-t border-[#3B4652]">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettingsModal(false);
                      setShowLeaveModal(true);
                    }}
                    className="w-full min-h-[44px] py-2.5 bg-[#FF4655]/10 hover:bg-[#FF4655]/20 border border-[#FF4655]/50 text-[#FF4655] font-mono font-bold rounded-2xl text-xs uppercase flex items-center justify-center gap-2 transition-all"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Leave Room & Disconnect</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 5: MISSIONS & SCORING */}
            {settingsTab === 'MISSIONS' && (
              <div className="space-y-3.5 max-h-[60vh] overflow-y-auto pr-1">
                {/* 1. Caught Runner Rule */}
                <div className="bg-[#293440] border border-[#3B4652] rounded-2xl p-3 space-y-2">
                  <label className="text-[11px] font-bold text-white block font-mono uppercase tracking-wider">
                    Caught Runner Rule
                  </label>
                  <select
                    value={roomState.config.missions?.caughtRunnerRule || 'CONVERT_TO_CHASER'}
                    onChange={(e) =>
                      onUpdateConfig({
                        missions: {
                          ...(roomState.config.missions || {}),
                          caughtRunnerRule: e.target.value as any,
                        },
                      })
                    }
                    className="w-full bg-[#1F2731] border border-[#3B4652] rounded-xl px-2.5 py-2.5 text-white text-xs font-mono focus:outline-none focus:border-[#FFB800]"
                  >
                    <option value="CONVERT_TO_CHASER">Convert to Chaser (Infection Mode)</option>
                    <option value="ELIMINATE">Eliminate (Runner Spectates)</option>
                  </select>
                  <span className="text-[10px] text-[#A8B0BA] font-mono block">
                    {roomState.config.missions?.caughtRunnerRule === 'ELIMINATE'
                      ? 'Caught runners are removed from the active hunt and spectate remainder.'
                      : 'Caught runners switch to Chaser team with squad comms access.'}
                  </span>
                </div>

                {/* 2. Catch Confirmation & Proximity Verification */}
                <div className="bg-[#293440] border border-[#3B4652] rounded-2xl p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono font-bold text-white block">
                        Require GPS Proximity for Catch
                      </span>
                      <span className="text-[10px] text-[#A8B0BA] font-mono block">
                        Server verifies chaser and runner are physically close
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateConfig({
                          missions: {
                            ...(roomState.config.missions || {}),
                            catchRequiresGpsProximity: !roomState.config.missions?.catchRequiresGpsProximity,
                          },
                        })
                      }
                      className={`min-h-[28px] px-2.5 py-1 rounded-xl font-mono text-[10px] font-bold uppercase transition-all border ${
                        roomState.config.missions?.catchRequiresGpsProximity
                          ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                          : 'bg-[#1F2731] border-[#3B4652] text-[#A8B0BA]'
                      }`}
                    >
                      {roomState.config.missions?.catchRequiresGpsProximity ? 'REQUIRED' : 'CODE ONLY'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] font-mono text-[#A8B0BA] block mb-1">
                        Catch Radius
                      </label>
                      <select
                        value={roomState.config.missions?.catchRadiusMeters || 15}
                        onChange={(e) =>
                          onUpdateConfig({
                            missions: {
                              ...(roomState.config.missions || {}),
                              catchRadiusMeters: parseInt(e.target.value, 10),
                            },
                          })
                        }
                        className="w-full bg-[#1F2731] border border-[#3B4652] rounded-xl px-2 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#FFB800]"
                      >
                        <option value={15}>15m (Tight)</option>
                        <option value={25}>25m (Standard)</option>
                        <option value={40}>40m (Open Field)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono text-[#A8B0BA] block mb-1">
                        Catch Code Expiry
                      </label>
                      <select
                        value={roomState.config.missions?.catchCodeExpirySeconds || 30}
                        onChange={(e) =>
                          onUpdateConfig({
                            missions: {
                              ...(roomState.config.missions || {}),
                              catchCodeExpirySeconds: parseInt(e.target.value, 10),
                            },
                          })
                        }
                        className="w-full bg-[#1F2731] border border-[#3B4652] rounded-xl px-2 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#FFB800]"
                      >
                        <option value={30}>30s (Default)</option>
                        <option value={45}>45s</option>
                        <option value={60}>60s</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 3. Enabled Random Mission Pool */}
                <div className="bg-[#293440] border border-[#3B4652] rounded-2xl p-3 space-y-2.5">
                  <span className="text-xs font-mono font-bold text-white block uppercase tracking-wider">
                    Eligible Mission Pool (Randomized)
                  </span>
                  <div className="space-y-1.5 text-xs font-mono">
                    {[
                      {
                        type: 'SECURE_THE_POINT',
                        name: 'A — Secure the Point',
                        desc: 'Hold GPS destination within 25m for 90s (+100 Solo / +100 Team)',
                      },
                      {
                        type: 'CHECKPOINT_RUN',
                        name: 'B — Checkpoint Run',
                        desc: 'Visit 3 ordered safe checkpoints in sequence (+150 Solo / +150 Team)',
                      },
                      {
                        type: 'SURVIVAL_MILESTONE',
                        name: 'C — Survival Milestone',
                        desc: 'Survive uncaught every 5 minutes (+50 Solo / +50 Team)',
                      },
                      {
                        type: 'CLOSE_ENCOUNTER',
                        name: 'D — Close Encounter',
                        desc: 'Stay within 50m of a chaser for 60s uncaught (+150 Solo / +150 Team)',
                      },
                      {
                        type: 'LANDMARK_RECON',
                        name: 'E — Landmark Recon',
                        desc: 'Reach safe public waypoint & solve clue (+100 Solo / +100 Team)',
                      },
                    ].map((m) => {
                      const enabledTypes = roomState.config.missions?.enabledTypes || [
                        'SECURE_THE_POINT',
                        'CHECKPOINT_RUN',
                        'SURVIVAL_MILESTONE',
                        'LANDMARK_RECON',
                      ];
                      const isChecked = enabledTypes.includes(m.type as any);

                      return (
                        <label
                          key={m.type}
                          className="flex items-start gap-2.5 p-2 rounded-xl bg-[#1F2731] border border-[#3B4652] cursor-pointer hover:border-[#FFB800]/50 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const newTypes = e.target.checked
                                ? [...enabledTypes, m.type as any]
                                : enabledTypes.filter((t) => t !== m.type);
                              if (newTypes.length === 0) return; // Prevent disabling all
                              onUpdateConfig({
                                missions: {
                                  ...(roomState.config.missions || {}),
                                  enabledTypes: newTypes,
                                },
                              });
                            }}
                            className="mt-0.5 rounded accent-[#FFB800]"
                          />
                          <div className="flex-1">
                            <span className="text-white font-bold block">{m.name}</span>
                            <span className="text-[10px] text-[#A8B0BA] block leading-tight">{m.desc}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Match-End & Early-End Rules */}
                <div className="bg-[#293440] border border-[#3B4652] rounded-2xl p-3 space-y-2">
                  <span className="text-xs font-mono font-bold text-white block uppercase tracking-wider">
                    Match End & Victory Bonus
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] font-mono text-[#A8B0BA] block mb-1">
                        All Runners Caught
                      </label>
                      <select
                        value={roomState.config.missions?.allRunnersCaughtEndsMatch ? 'true' : 'false'}
                        onChange={(e) =>
                          onUpdateConfig({
                            missions: {
                              ...(roomState.config.missions || {}),
                              allRunnersCaughtEndsMatch: e.target.value === 'true',
                            },
                          })
                        }
                        className="w-full bg-[#1F2731] border border-[#3B4652] rounded-xl px-2 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#FFB800]"
                      >
                        <option value="true">Chasers Win Immediately</option>
                        <option value="false">Wait for Timer</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-mono text-[#A8B0BA] block mb-1">
                        Tie-Breaker
                      </label>
                      <select
                        value={roomState.config.missions?.tieBreaker || 'DRAW'}
                        onChange={(e) =>
                          onUpdateConfig({
                            missions: {
                              ...(roomState.config.missions || {}),
                              tieBreaker: e.target.value as any,
                            },
                          })
                        }
                        className="w-full bg-[#1F2731] border border-[#3B4652] rounded-xl px-2 py-2 text-white text-xs font-mono focus:outline-none focus:border-[#FFB800]"
                      >
                        <option value="DRAW">Draw / Equal Match</option>
                        <option value="CHASERS_WIN">Chasers Win Tie</option>
                        <option value="RUNNERS_WIN">Runners Win Tie</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-[#1F2731] border border-[#3B4652] rounded-xl p-2 text-[10px] font-mono text-[#A8B0BA] flex justify-between">
                    <span>Winning Team Bonus: <strong className="text-white">+{roomState.config.missions?.winningTeamBonus ?? 500} Team Pts</strong></span>
                    <span>Individual Bonus: <strong className="text-white">+{roomState.config.missions?.winningIndividualBonus ?? 100} Solo Pts</strong></span>
                  </div>
                </div>

                {/* 5. Chaser Gameplay Scoring Objectives */}
                <div className="bg-[#293440] border border-[#3B4652] rounded-2xl p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono font-bold text-white block uppercase tracking-wider">
                        Chaser Gameplay Objectives
                      </span>
                      <span className="text-[10px] text-[#A8B0BA] font-mono block">
                        Interceptions & Control Milestones for active Chasers
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateConfig({
                          missions: {
                            ...(roomState.config.missions || {}),
                            chaserObjectivesEnabled: roomState.config.missions?.chaserObjectivesEnabled === false ? true : false,
                          },
                        })
                      }
                      className={`min-h-[28px] px-2.5 py-1 rounded-xl font-mono text-[10px] font-bold uppercase transition-all border ${
                        roomState.config.missions?.chaserObjectivesEnabled !== false
                          ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                          : 'bg-[#1F2731] border-[#3B4652] text-[#A8B0BA]'
                      }`}
                    >
                      {roomState.config.missions?.chaserObjectivesEnabled !== false ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  <div className="space-y-2 text-xs font-mono">
                    <div className="p-2 rounded-xl bg-[#1F2731] border border-[#3B4652] flex items-center justify-between">
                      <div>
                        <span className="text-white font-bold block text-[11px]">A — Successful Interception</span>
                        <span className="text-[10px] text-[#A8B0BA] block">Disrupt active runner at their mission objective</span>
                      </div>
                      <span className="text-[#FF4655] font-black text-xs">
                        +{roomState.config.missions?.rewardInterception?.individual ?? 25} Solo / +{roomState.config.missions?.rewardInterception?.team ?? 25} Team
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-[#1F2731] border border-[#3B4652] flex items-center justify-between">
                      <div>
                        <span className="text-white font-bold block text-[11px]">B — Chaser Control Milestone</span>
                        <span className="text-[10px] text-[#A8B0BA] block">Patrol territory every 5 min active match milestone</span>
                      </div>
                      <span className="text-[#FF4655] font-black text-xs">
                        +{roomState.config.missions?.rewardChaserMilestone?.individual ?? 25} Solo / +{roomState.config.missions?.rewardChaserMilestone?.team ?? 25} Team
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-[#1F2731] border border-[#3B4652] flex items-center justify-between">
                      <div>
                        <span className="text-white font-bold block text-[11px]">Standard Catch Reward</span>
                        <span className="text-[10px] text-[#A8B0BA] block">Verified PIN tag or confirmed proximity catch</span>
                      </div>
                      <span className="text-[#4CC38A] font-black text-xs">
                        +{roomState.config.missions?.catchReward?.individual ?? 100} Solo / +{roomState.config.missions?.catchReward?.team ?? 100} Team
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pre-Match Summary Card */}
            <div className="bg-[#161e27] border border-[#3B4652] rounded-2xl p-3 space-y-1.5 text-[10px] font-mono">
              <span className="text-[#A8B0BA] uppercase font-bold tracking-wider block">
                Pre-Match Configuration Summary
              </span>
              <div className="grid grid-cols-2 gap-1 text-white">
                <div>Duration: <strong>{roomState.config.durationSeconds / 60} min</strong></div>
                <div>Head Start: <strong>{roomState.config.globalHeadStartSeconds / 60} min</strong></div>
                <div>Play Area: <strong>{roomState.config.playZone.radiusMeters}m</strong></div>
                <div>Dynamic Zone: <strong className={roomState.config.dynamicZone?.enabled ? 'text-[#4CC38A]' : 'text-neutral-500'}>
                  {roomState.config.dynamicZone?.enabled ? 'ACTIVE' : 'OFF'}
                </strong></div>
              </div>
            </div>

            <button
              onClick={() => setShowSettingsModal(false)}
              className="w-full min-h-[44px] py-2.5 bg-[#293440] hover:bg-[#3B4652] text-white font-mono font-bold rounded-2xl text-xs uppercase transition-colors"
            >
              Confirm & Save
            </button>
          </div>
        </div>
      )}

      {/* 8. Fixed Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-[#0F1923]/95 backdrop-blur-md border-t border-[#3B4652] flex gap-3 max-w-6xl mx-auto z-[500]">
        <button
          onClick={() => onToggleReady(!myMember?.isReady)}
          className={`min-h-[48px] flex-1 py-3 rounded-2xl font-mono font-bold text-xs uppercase tracking-wider transition-all active:scale-95 border flex items-center justify-center gap-2 ${
            myMember?.isReady
              ? 'bg-[#293440] border-[#3B4652] text-[#ECE8E1]'
              : 'bg-[#293440] border-[#4CC38A] text-[#4CC38A] hover:bg-[#4CC38A]/10'
          }`}
        >
          {myMember?.isReady ? (
            <>
              <Check className="w-4 h-4 text-[#4CC38A] stroke-[3]" />
              <span>Ready Confirmed</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>Mark Ready</span>
            </>
          )}
        </button>

        {isHost && (
          <button
            onClick={onStartMatch}
            disabled={!canStart}
            className={`min-h-[48px] flex-1 py-3 rounded-2xl font-mono font-black text-xs uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-2 ${
              canStart
                ? 'bg-[#FF4655] text-white shadow-tactical-glow hover:brightness-110'
                : 'bg-[#293440] text-[#A8B0BA] cursor-not-allowed border border-[#3B4652]'
            }`}
          >
            {canStart ? (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Deploy Match</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4" />
                <span>Need 1v1 Min</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* 9. Host Play Area Interactive Map Editor Modal */}
      {isMapEditorOpen && (
        <HostPlayAreaEditor
          initialPlayZone={roomState.config.playZone}
          myLocation={myLocation}
          onSave={(updatedZone) => {
            onUpdatePlayZone(updatedZone);
            setIsMapEditorOpen(false);
          }}
          onClose={() => setIsMapEditorOpen(false)}
        />
      )}

      {/* 10. Leave Room Confirmation Dialog */}
      {showLeaveModal && (
        <LeaveRoomModal
          isOpen={showLeaveModal}
          isHost={isHost}
          onConfirm={() => {
            setShowLeaveModal(false);
            onLeaveRoom?.();
          }}
          onCancel={() => setShowLeaveModal(false)}
        />
      )}

      {/* 11. Tactical Operative Dossier Modal */}
      {selectedDossierPlayerId && (
        <PlayerDossierModal
          playerId={selectedDossierPlayerId}
          nickname={roomState.members[selectedDossierPlayerId]?.nickname || 'Operative'}
          currentRole={roomState.members[selectedDossierPlayerId]?.role}
          currentTeam={roomState.members[selectedDossierPlayerId]?.team}
          isMe={selectedDossierPlayerId === myPlayerId}
          onClose={() => setSelectedDossierPlayerId(null)}
          socket={socket}
        />
      )}

      {/* 12. Voice Diagnostics Modal */}
      {voice && (
        <VoiceDiagnosticsModal
          isOpen={showVoiceDiagnostics}
          onClose={() => setShowVoiceDiagnostics(false)}
          diagnostics={voice.diagnostics}
          participants={voice.participants}
          isSocketConnected={socket?.connected ?? false}
          socketId={socket?.id ?? null}
          serverUrl={typeof window !== 'undefined' ? window.location.origin : ''}
          onUnlockAudio={voice.enableAudioPlayback}
          onRetryChannel={() => {
            if (voice.activeVoiceChannel) {
              const ch = voice.activeVoiceChannel;
              voice.leaveVoiceChannel();
              setTimeout(() => voice.joinVoiceChannel(ch), 300);
            }
          }}
        />
      )}
    </div>
  );
}

// Reusable Player Card with Desktop Drag & Drop + Mobile-First Touch Action Sheet
interface PlayerCardProps {
  member: any;
  myPlayerId: string;
  hostId: string;
  isHost: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onAssignTeam: (id: string, team: PlayerTeam) => void;
  onSelectMobilePlayer: (id: string) => void;
  onSelectDossier?: (id: string) => void;
}

function PlayerCard({
  member,
  myPlayerId,
  hostId,
  isHost,
  onDragStart,
  onAssignTeam,
  onSelectMobilePlayer,
  onSelectDossier,
}: PlayerCardProps) {
  const isMe = member.id === myPlayerId;
  const isCardHost = member.id === hostId;

  return (
    <div
      draggable={isHost}
      onDragStart={(e) => onDragStart(e, member.id)}
      className={`min-h-[54px] flex items-center justify-between p-2.5 rounded-2xl bg-[#293440] border border-[#3B4652] shadow-sm transition-all ${
        isHost ? 'cursor-grab active:cursor-grabbing hover:border-neutral-600' : ''
      }`}
    >
      <div
        onClick={() => onSelectDossier?.(member.id)}
        className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer group"
        title="Click to view operative dossier & stats"
      >
        <PlayerAvatar nickname={member.nickname} team={member.team} size="sm" />
        <div className="truncate flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {isCardHost && (
              <span title="Room Commander (Host)" className="shrink-0">
                <Crown className="w-3.5 h-3.5 text-amber-400" />
              </span>
            )}
            <span className="text-xs font-bold text-white truncate font-mono block group-hover:text-[#4CC38A] transition-colors">
              {member.nickname}
            </span>
            {isMe && (
              <span className="text-[10px] text-[#4CC38A] font-mono font-bold shrink-0">
                (You)
              </span>
            )}
          </div>
          <span className="text-[9px] text-[#A8B0BA] font-mono block truncate">
            {member.team === 'RUNNERS'
              ? 'Runner Squad'
              : member.team === 'CHASERS'
              ? 'Chaser Squad'
              : 'Waiting Room'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold tracking-wider flex items-center gap-1 ${
            member.isReady
              ? 'bg-[#4CC38A]/20 text-[#4CC38A] border border-[#4CC38A]/40'
              : 'bg-[#1F2731] text-[#A8B0BA]'
          }`}
        >
          {member.isReady ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
          <span>{member.isReady ? 'READY' : 'STANDBY'}</span>
        </span>

        {/* Mobile & Desktop Assignment Trigger */}
        {isHost && (
          <div className="flex items-center gap-1">
            {/* Mobile Sheet Trigger */}
            <button
              onClick={() => onSelectMobilePlayer(member.id)}
              className="lg:hidden min-h-[36px] px-2.5 py-1 bg-[#1F2731] hover:bg-[#3B4652] active:scale-95 text-[#ECE8E1] rounded-xl text-[10px] font-mono font-bold border border-[#3B4652] flex items-center gap-1"
            >
              <span>Assign</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {/* Desktop Native Select Dropdown */}
            <select
              value={member.team}
              onChange={(e) => onAssignTeam(member.id, e.target.value as PlayerTeam)}
              className="hidden lg:block text-[10px] bg-[#1F2731] border border-[#3B4652] rounded-xl px-2 py-1 text-[#ECE8E1] focus:outline-none cursor-pointer"
            >
              <option value="NONE">Waiting</option>
              <option value="RUNNERS">Runner</option>
              <option value="CHASERS">Chaser</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

function Share2Icon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
