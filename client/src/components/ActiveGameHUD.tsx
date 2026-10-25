'use client';

import { useState, useEffect } from 'react';
import {
  Clock,
  Navigation,
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  Play,
  Square,
  Mic,
  MicOff,
  Radio,
  Volume2,
  VolumeX,
  Zap,
  Check,
  Copy,
  X,
  CheckCircle2,
  Eye,
  Crosshair,
  ShieldAlert,
  Send,
  Trash2,
  MessageSquare,
  PhoneOff,
  User,
  LogOut,
  Compass,
  Shield,
  Activity,
  RefreshCw,
} from 'lucide-react';
import {
  RoomState,
  PlayerLocation,
  CatchAttempt,
  RadioTransmission,
  ScheduledRunnerSnapshot,
  VoiceChannelId,
  VoiceParticipant,
  VoiceDiagnostics,
  ActiveMission,
} from '../types/game';
import { RadioRecordingState } from '../hooks/useRadio';
import { calculateHaversineDistance } from '../utils/geoUtils';
import PlayerDossierModal from './PlayerDossierModal';
import LeaveRoomModal from './LeaveRoomModal';
import VoiceDiagnosticsModal from './VoiceDiagnosticsModal';
import GpsStatusIndicator from './GpsStatusIndicator';
import MissionProgressDashboard from './MissionProgressDashboard';
import { ExtendedGpsStatus } from '../hooks/useGeolocation';

interface ActiveGameHUDProps {
  roomState: RoomState;
  myPlayerId: string;
  myLocation: PlayerLocation | null;
  isGpsStale: boolean;
  gpsStatus?: ExtendedGpsStatus;
  gpsAccuracy?: number | null;
  lastFixTimestamp?: number | null;
  gpsErrorMessage?: string | null;
  isSecureContext?: boolean;
  onRequestLocationAccess?: () => void;
  pendingCatch: CatchAttempt | null;
  incomingRadio: RadioTransmission | null;
  scheduledSnapshot?: ScheduledRunnerSnapshot | null;
  unreadChatCount?: number;
  onOpenChat?: () => void;
  socket?: any;
  onLeaveRoom?: () => void;
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
  // Radio controls (legacy fallback)
  radioRecordingState?: RadioRecordingState;
  radioElapsedSeconds?: number;
  radioPreviewUrl?: string | null;
  isPlayingPreview?: boolean;
  radioError?: string | null;
  onStartRadio?: () => void;
  onStopRadio?: () => void;
  onCancelRadio?: () => void;
  onSendRadio?: () => void;
  onPlayPreview?: () => void;
  onStopPreview?: () => void;
  onPlayIncomingRadio?: (t: RadioTransmission) => void;
  onDismissIncomingRadio?: () => void;
  // Catch & Pause controls
  onRequestCatchCode?: () => Promise<{ success: boolean; catchCode?: string; expiresAt?: number; error?: string }>;
  onSubmitCatchCode?: (targetRunnerId: string, catchCode: string) => Promise<{ success: boolean; error?: string; attempt?: any }>;
  onAnswerLandmarkClue?: (answer: string) => Promise<{ success: boolean; completed?: boolean; error?: string }>;
  onAttemptCatch: (targetRunnerId: string) => void;
  onAttemptCatchWithCode: (targetRunnerId: string, catchCode: string) => void;
  onRespondCatch: (attemptId: string, response: 'CONFIRM' | 'DISPUTE') => void;
  onSafetyPause: () => void;
  onResumeMatch: () => void;
}

export default function ActiveGameHUD({
  roomState,
  myPlayerId,
  myLocation,
  isGpsStale,
  gpsStatus = 'ACQUIRED',
  gpsAccuracy = null,
  lastFixTimestamp = null,
  gpsErrorMessage = null,
  isSecureContext = true,
  onRequestLocationAccess,
  pendingCatch,
  incomingRadio,
  scheduledSnapshot,
  unreadChatCount = 0,
  onOpenChat,
  socket,
  onLeaveRoom,
  voice,
  radioRecordingState = 'idle',
  radioElapsedSeconds = 0,
  radioPreviewUrl,
  isPlayingPreview = false,
  radioError,
  onStartRadio,
  onStopRadio,
  onCancelRadio,
  onSendRadio,
  onPlayPreview,
  onStopPreview,
  onPlayIncomingRadio,
  onDismissIncomingRadio,
  onRequestCatchCode,
  onSubmitCatchCode,
  onAnswerLandmarkClue,
  onAttemptCatch,
  onAttemptCatchWithCode,
  onRespondCatch,
  onSafetyPause,
  onResumeMatch,
}: ActiveGameHUDProps) {
  const [showTagModal, setShowTagModal] = useState(false);
  const [selectedRunnerId, setSelectedRunnerId] = useState<string>('');
  const [enteredCatchCode, setEnteredCatchCode] = useState<string>('');
  const [tagError, setTagError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showDossier, setShowDossier] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showVoiceDiagnostics, setShowVoiceDiagnostics] = useState(false);
  const [showScoreEventsModal, setShowScoreEventsModal] = useState(false);

  // Runner Secret Catch PIN Modal & dynamic timer
  const [showRunnerCodeModal, setShowRunnerCodeModal] = useState(false);
  const [localCatchCode, setLocalCatchCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [codeSecondsRemaining, setCodeSecondsRemaining] = useState<number>(0);
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [codeRequestError, setCodeRequestError] = useState<string | null>(null);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);

  // Landmark clue form
  const [clueAnswer, setClueAnswer] = useState('');
  const [clueFeedback, setClueFeedback] = useState<string | null>(null);
  const [isSubmittingClue, setIsSubmittingClue] = useState(false);

  // Victory modal dismissal
  const [victoryDismissed, setVictoryDismissed] = useState(false);

  const myMember = roomState.members[myPlayerId];
  const isHostOrReferee = myMember?.role === 'HOST' || myMember?.role === 'REFEREE';
  const isChaser = myMember?.team === 'CHASERS';
  const isRunner = myMember?.team === 'RUNNERS';

  // Dynamic safe play zone calculation
  const playZone = roomState.config.playZone;
  const dynamicZone = roomState.config.dynamicZone;
  const dynamicZoneState = roomState.match?.dynamicZoneState;
  const currentRadiusMeters = dynamicZoneState?.currentRadiusMeters ?? playZone.radiusMeters;

  // Calculate distance from center to determine if operative is out of zone
  let outOfZoneDistanceMeters = 0;
  if (myLocation && playZone?.centerLat && playZone?.centerLng) {
    const distFromCenter = calculateHaversineDistance(
      myLocation.latitude,
      myLocation.longitude,
      playZone.centerLat,
      playZone.centerLng
    );
    if (distFromCenter > currentRadiusMeters) {
      outOfZoneDistanceMeters = Math.round(distFromCenter - currentRadiusMeters);
    }
  }

  // SERVER-AUTHORITATIVE COUNTDOWN (From 15:00 down to 00:00 continuously)
  const [displaySeconds, setDisplaySeconds] = useState<number>(() => {
    if (roomState.state === 'COMPLETED') return 0;
    const endsAt = roomState.match?.gameEndsAt;
    if (!endsAt) return roomState.config.durationSeconds;
    return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  });

  useEffect(() => {
    if (roomState.state !== 'ACTIVE') {
      if (roomState.state === 'COMPLETED') {
        setDisplaySeconds(0);
      } else if (roomState.match?.remainingSeconds !== undefined) {
        setDisplaySeconds(roomState.match.remainingSeconds);
      }
      return;
    }

    const updateTimer = () => {
      const endsAt = roomState.match?.gameEndsAt;
      if (!endsAt) return;
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setDisplaySeconds(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 250);
    return () => clearInterval(interval);
  }, [roomState.state, roomState.match?.gameEndsAt, roomState.match?.remainingSeconds]);

  const minutes = Math.floor(displaySeconds / 60);
  const seconds = displaySeconds % 60;
  const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
  const isLowTime = displaySeconds <= 120 && roomState.state === 'ACTIVE';

  const uncaughtRunners = Object.values(roomState.members).filter(
    (m) => m.team === 'RUNNERS' && !m.isCaught
  );

  // Sync local catch code from member snapshot
  useEffect(() => {
    if (myMember?.catchCode) setLocalCatchCode(myMember.catchCode);
    if (myMember?.catchCodeExpiresAt) setCodeExpiresAt(myMember.catchCodeExpiresAt);
  }, [myMember?.catchCode, myMember?.catchCodeExpiresAt]);

  // Catch code countdown timer
  useEffect(() => {
    if (!codeExpiresAt) {
      setCodeSecondsRemaining(0);
      return;
    }
    const updateCodeTimer = () => {
      const left = Math.max(0, Math.ceil((codeExpiresAt - Date.now()) / 1000));
      setCodeSecondsRemaining(left);
    };
    updateCodeTimer();
    const interval = setInterval(updateCodeTimer, 500);
    return () => clearInterval(interval);
  }, [codeExpiresAt]);

  const handleRequestNewCode = async () => {
    if (!onRequestCatchCode) return;
    setIsRequestingCode(true);
    setCodeRequestError(null);
    const res = await onRequestCatchCode();
    setIsRequestingCode(false);
    if (res.success && res.catchCode) {
      setLocalCatchCode(res.catchCode);
      if (res.expiresAt) setCodeExpiresAt(res.expiresAt);
    } else {
      setCodeRequestError(res.error || 'Failed to generate code');
    }
  };

  const handleCopyCode = () => {
    const codeToCopy = localCatchCode || myMember?.catchCode;
    if (codeToCopy && navigator?.clipboard) {
      navigator.clipboard.writeText(codeToCopy);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleClaimTagWithCode = async () => {
    if (!selectedRunnerId) {
      setTagError('Please select a target runner.');
      return;
    }
    if (enteredCatchCode.length !== 4) {
      setTagError('Catch code must be exactly 4 digits.');
      return;
    }
    setTagError(null);
    if (onSubmitCatchCode) {
      setIsVerifyingCode(true);
      const res = await onSubmitCatchCode(selectedRunnerId, enteredCatchCode);
      setIsVerifyingCode(false);
      if (!res.success) {
        setTagError(res.error || 'Verification failed');
        return;
      }
    } else {
      onAttemptCatchWithCode(selectedRunnerId, enteredCatchCode);
    }
    setShowTagModal(false);
    setEnteredCatchCode('');
  };

  const handleSubmitClue = async () => {
    if (!clueAnswer.trim() || !onAnswerLandmarkClue) return;
    setIsSubmittingClue(true);
    setClueFeedback(null);
    const res = await onAnswerLandmarkClue(clueAnswer.trim());
    setIsSubmittingClue(false);
    if (res.success) {
      setClueFeedback('Correct! Landmark Recon completed.');
      setClueAnswer('');
    } else {
      setClueFeedback(res.error || 'Incorrect clue answer');
    }
  };

  const activeMission = roomState.match?.activeMissions?.[myPlayerId];

  return (
    <>
      {/* Top Floating Command HUD */}
      <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 right-3 z-[450] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: Match Clock & Dynamic Zone Pill */}
        <div className="flex items-center gap-2 flex-wrap pointer-events-auto">
          {/* Match Clock & Tactical Status */}
          <div className="bg-[#1F2731] border border-[#3B4652] px-3 py-1.5 rounded-2xl shadow-xl flex items-center gap-2.5 shrink-0">
            <div className="flex flex-col">
              <span className="text-[9px] uppercase font-mono font-bold tracking-widest text-[#A8B0BA] flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                <span>
                  {roomState.state === 'RUNNER_HEADSTART'
                    ? 'Head Start'
                    : roomState.state === 'SAFETY_PAUSED'
                    ? 'Paused'
                    : 'Clock'}
                </span>
              </span>
              <span
                className={`text-lg sm:text-xl font-black font-mono tracking-wider tabular-nums ${
                  isLowTime ? 'text-[#FF4655] animate-pulse' : 'text-white'
                }`}
              >
                {timeFormatted}
              </span>
            </div>

            <div
              className={`w-2.5 h-2.5 rounded-full ${
                roomState.state === 'ACTIVE'
                  ? isLowTime
                    ? 'bg-[#FF4655] animate-ping'
                    : 'bg-[#4CC38A] animate-ping'
                  : roomState.state === 'RUNNER_HEADSTART'
                  ? 'bg-[#39BDE8]'
                  : 'bg-[#FF4655]'
              }`}
            />
          </div>

          {/* Dynamic Zone Indicator Pill */}
          {dynamicZone?.enabled && (
            <div
              className={`px-2.5 sm:px-3 py-1.5 rounded-2xl border text-[10px] sm:text-[11px] font-mono font-bold flex items-center gap-1.5 shadow-md shrink-0 ${
                dynamicZoneState?.isWarningActive
                  ? 'bg-[#FF4655]/20 border-[#FF4655] text-[#FF4655] animate-pulse'
                  : 'bg-[#1F2731] border-[#39BDE8]/60 text-[#39BDE8]'
              }`}
            >
              <Compass className={`w-3.5 h-3.5 ${dynamicZoneState?.isWarningActive ? 'animate-spin' : ''}`} />
              <span>
                {dynamicZoneState?.isWarningActive
                  ? `SHRINK WARNING: ${currentRadiusMeters}m → ${dynamicZoneState.nextRadiusMeters}m`
                  : dynamicZoneState?.isFinalZone
                  ? `ZONE MIN: ${currentRadiusMeters}m`
                  : dynamicZoneState?.nextShrinkAt
                  ? `ZONE: ${currentRadiusMeters}m (${Math.max(
                      0,
                      Math.ceil((dynamicZoneState.nextShrinkAt - Date.now()) / 1000)
                    )}s)`
                  : `ZONE: ${currentRadiusMeters}m`}
              </span>
            </div>
          )}
        </div>

        {/* Middle: Live Team & Solo Score Ticker */}
        {roomState.match?.scoreLedger && (
          <button
            type="button"
            onClick={() => setShowScoreEventsModal(true)}
            title="Click to view verified score ledger & recent events"
            className="bg-[#1F2731] hover:bg-[#293440] border border-[#3B4652] hover:border-[#FFB800] px-3 py-1.5 rounded-2xl shadow-xl flex items-center gap-3 font-mono text-[10px] sm:text-xs pointer-events-auto shrink-0 transition-all active:scale-95 cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#39BDE8]" />
              <span className="text-[#A8B0BA] font-bold">RUNNERS:</span>
              <strong className="text-[#39BDE8] font-black">{roomState.match.scoreLedger.teamScores?.RUNNERS ?? 0}</strong>
            </div>
            <div className="h-3 w-px bg-[#3B4652]" />
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#FF4655]" />
              <span className="text-[#A8B0BA] font-bold">CHASERS:</span>
              <strong className="text-[#FF4655] font-black">{roomState.match.scoreLedger.teamScores?.CHASERS ?? 0}</strong>
            </div>
            <div className="h-3 w-px bg-[#3B4652]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[#A8B0BA] font-bold">SOLO:</span>
              <strong className="text-[#FFB800] font-black">{roomState.match.scoreLedger.individualScores?.[myPlayerId] ?? roomState.match.scoreLedger.playerScores?.[myPlayerId] ?? 0}</strong>
            </div>
            <span className="text-[9px] text-[#A8B0BA] bg-[#161E27] px-1.5 py-0.5 rounded border border-[#3B4652]">
              Events
            </span>
          </button>
        )}

        {/* Right: Tactical Controls & Health */}
        <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto flex-wrap shrink-0">
          {/* Tactical Chat Button */}
          {onOpenChat && (
            <button
              onClick={onOpenChat}
              className="relative p-2 sm:p-2.5 rounded-xl bg-[#1F2731] hover:bg-[#293440] border border-[#3B4652] text-[#ECE8E1] hover:text-white transition-all shadow-md active:scale-95 shrink-0"
              title="Open Tactical Comms"
            >
              <MessageSquare className="w-4 h-4 text-[#FF4655]" />
              {unreadChatCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-[#FF4655] text-white font-mono font-black text-[9px] animate-pulse">
                  {unreadChatCount}
                </span>
              )}
            </button>
          )}

          {/* Player Dossier Button */}
          <button
            onClick={() => setShowDossier(true)}
            className="p-2 sm:p-2.5 rounded-xl bg-[#1F2731] hover:bg-[#293440] border border-[#3B4652] text-[#A8B0BA] hover:text-[#4CC38A] transition-all shadow-md active:scale-95 shrink-0"
            title="View Player Profile & Tactical Dossier"
          >
            <User className="w-4 h-4" />
          </button>

          {/* Compact GPS Status Indicator Pill & Diagnostics */}
          <GpsStatusIndicator
            gpsStatus={gpsStatus}
            location={myLocation}
            accuracy={gpsAccuracy ?? myLocation?.accuracy ?? null}
            lastFixTimestamp={lastFixTimestamp ?? myLocation?.timestamp ?? null}
            isStale={isGpsStale}
            errorMessage={gpsErrorMessage}
            isSecureContext={isSecureContext}
            onRequestLocationAccess={onRequestLocationAccess || (() => {})}
          />

          {/* Safety Pause / Resume (Host or Referee) */}
          {isHostOrReferee && (
            <button
              onClick={
                roomState.state === 'SAFETY_PAUSED'
                  ? onResumeMatch
                  : onSafetyPause
              }
              className={`px-2.5 sm:px-3 py-1.5 rounded-xl font-bold text-xs uppercase shadow-lg active:scale-95 transition-all border flex items-center gap-1 shrink-0 ${
                roomState.state === 'SAFETY_PAUSED'
                  ? 'bg-[#4CC38A] text-[#0F1923] border-[#4CC38A]'
                  : 'bg-[#FF4655] text-white border-[#FF4655]'
              }`}
            >
              {roomState.state === 'SAFETY_PAUSED' ? (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </>
              )}
            </button>
          )}

          {/* Leave Room Button */}
          {onLeaveRoom && (
            <button
              onClick={() => setShowLeaveModal(true)}
              className="p-2 sm:p-2.5 rounded-xl bg-[#1F2731] hover:bg-[#293440] border border-[#3B4652] text-[#A8B0BA] hover:text-[#FF4655] transition-all shadow-md active:scale-95 shrink-0"
              title="Exit Match & Leave Room"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Floating Tactical Alert & Status Stack */}
      <div className="absolute top-20 sm:top-16 left-3 right-3 z-[450] pointer-events-none flex flex-col items-center gap-2">
        {/* Out of Safe Zone Warning Banner */}
        {outOfZoneDistanceMeters > 0 && roomState.state === 'ACTIVE' && (
          <div className="bg-[#FF4655] border-2 border-white/60 px-4 py-2 rounded-2xl shadow-tactical-glow flex items-center gap-2.5 pointer-events-auto text-white text-xs font-mono font-bold animate-pulse max-w-md w-full justify-center">
            <AlertTriangle className="w-4 h-4 shrink-0 text-white" />
            <span className="leading-tight">
              OUT OF SAFE ZONE (+{outOfZoneDistanceMeters}m)! Return within {currentRadiusMeters}m boundary.
            </span>
          </div>
        )}

        {/* Chaser 120s Satellite Intel Bar */}
        {isChaser && roomState.state === 'ACTIVE' && (
          <div className="bg-[#1F2731] border border-[#FF4655]/60 px-3.5 py-1.5 rounded-2xl shadow-lg flex items-center gap-2 pointer-events-auto text-[11px] font-mono">
            <Radio className="w-3.5 h-3.5 text-[#FF4655] shrink-0 animate-pulse" />
            <span className="text-[#ECE8E1]">
              NEXT SATELLITE SWEEP:{' '}
              <strong className="text-[#FF4655]">
                {scheduledSnapshot?.nextExpectedSnapshotAt
                  ? `${Math.max(0, Math.ceil((scheduledSnapshot.nextExpectedSnapshotAt - Date.now()) / 1000))}s`
                  : '120s'}
              </strong>
            </span>
            <span className="text-[10px] text-[#A8B0BA] border-l border-[#3B4652] pl-2">
              {scheduledSnapshot?.runners.length || 0} runner(s) pinged
            </span>
          </div>
        )}

        {/* Authoritative Shared Match Mission Dashboard for All Players */}
        {roomState.match?.sharedMissions && roomState.match.sharedMissions.length > 0 ? (
          <MissionProgressDashboard
            sharedMissions={roomState.match.sharedMissions}
            scoreLedger={roomState.match.scoreLedger}
            myPlayerId={myPlayerId}
            myTeam={myMember?.team || 'NONE'}
            myLocation={myLocation}
            onAnswerLandmarkClue={onAnswerLandmarkClue}
          />
        ) : (
          isRunner && !myMember?.isCaught && activeMission && (
            <div className="bg-[#1F2731]/95 border-2 border-[#FFB800] p-3 sm:p-3.5 rounded-2xl shadow-tactical-glow pointer-events-auto max-w-md w-full space-y-2 backdrop-blur-md">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-lg text-[9px] font-mono font-black uppercase bg-[#FFB800] text-black">
                    {(activeMission.type || activeMission.templateType || 'MISSION').replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase ${
                      activeMission.difficulty === 'EASY'
                        ? 'text-[#4CC38A] bg-[#4CC38A]/10 border border-[#4CC38A]/30'
                        : activeMission.difficulty === 'HARD'
                        ? 'text-[#FF4655] bg-[#FF4655]/10 border border-[#FF4655]/30'
                        : 'text-[#39BDE8] bg-[#39BDE8]/10 border border-[#39BDE8]/30'
                    }`}
                  >
                    {activeMission.difficulty}
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold text-[#FFB800]">
                  +{activeMission.rewardIndividual} Solo / +{activeMission.rewardTeam} Team
                </span>
              </div>

              <div>
                <h4 className="text-xs font-mono font-bold text-white uppercase">{activeMission.title}</h4>
                <p className="text-[11px] text-[#ECE8E1] font-mono leading-tight mt-0.5">{activeMission.description}</p>
              </div>

              {/* Objective Distance & GPS Status */}
              {activeMission.targetLocation && (
                <div className="flex items-center justify-between text-[10px] font-mono bg-[#161E27] px-2.5 py-1.5 rounded-xl border border-[#3B4652]">
                  <span className="text-[#A8B0BA] flex items-center gap-1">
                    <Navigation className="w-3 h-3 text-[#FFB800]" />
                    <span>Objective Target:</span>
                  </span>
                  <strong className="text-white font-mono">
                    {myLocation
                      ? `${Math.round(calculateHaversineDistance(myLocation.latitude, myLocation.longitude, activeMission.targetLocation.latitude ?? activeMission.targetLocation.lat, activeMission.targetLocation.longitude ?? activeMission.targetLocation.lng))}m away`
                      : 'Searching GPS...'}
                  </strong>
                </div>
              )}
            </div>
          )
        )}

        {/* Runner Secret PIN Floating Bar */}
        {isRunner && !myMember?.isCaught && (
          <div className="bg-[#1F2731] border border-[#39BDE8]/70 px-4 py-2 rounded-2xl shadow-runner-glow flex items-center justify-between gap-3 pointer-events-auto max-w-md w-full">
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-[9px] text-[#A8B0BA] font-mono uppercase tracking-wider">
                  Secret PIN:
                </span>
                <span className="font-mono text-xl font-black text-[#39BDE8] tracking-widest leading-none">
                  {localCatchCode || myMember?.catchCode || '----'}
                </span>
              </div>
              {codeSecondsRemaining > 0 && (
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-lg border ${codeSecondsRemaining <= 5 ? 'text-[#FF4655] border-[#FF4655] animate-pulse' : 'text-[#39BDE8] border-[#39BDE8]/40'}`}>
                  {codeSecondsRemaining}s
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={handleCopyCode}
                title="Copy Catch PIN"
                className="p-2 rounded-xl bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-[#ECE8E1] transition-colors"
              >
                {copiedCode ? (
                  <Check className="w-3.5 h-3.5 text-[#39BDE8]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => {
                  setShowRunnerCodeModal(true);
                  if (!localCatchCode && !myMember?.catchCode) {
                    handleRequestNewCode();
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-[#39BDE8] hover:brightness-110 active:scale-95 text-[#0F1923] font-mono font-bold text-xs uppercase"
              >
                Catch Screen
              </button>
            </div>
          </div>
        )}

        {/* Runner Caught Banner */}
        {isRunner && myMember?.isCaught && (
          <div className="bg-[#FF4655] text-white font-bold text-xs px-4 py-2.5 rounded-2xl shadow-xl pointer-events-auto flex items-center gap-2">
            <Eye className="w-4 h-4" />
            <span>YOU WERE CAUGHT! Spectating remainder of match...</span>
          </div>
        )}
      </div>

      {/* Emergency Safety Pause Modal Overlay */}
      {roomState.state === 'SAFETY_PAUSED' && (
        <div className="fixed inset-0 z-[800] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1F2731] border-2 border-[#FF4655] w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#FF4655]/20 border border-[#FF4655] flex items-center justify-center mx-auto text-[#FF4655]">
              <AlertOctagon className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">
              Safety Pause Active
            </h2>
            <p className="text-xs text-[#ECE8E1] leading-relaxed">
              Match timers and catch actions are frozen. Please stop running, check your physical surroundings, and regroup if necessary.
            </p>
            {isHostOrReferee && (
              <button
                onClick={onResumeMatch}
                className="w-full py-3.5 bg-[#4CC38A] hover:brightness-110 active:scale-95 text-[#0F1923] font-black rounded-xl text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Resume Match</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom Controls Deck */}
      <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-3 right-3 z-[450] flex flex-col gap-2 pointer-events-none max-w-md mx-auto">
        {/* Chaser "Tag Runner" Floating Action Button */}
        {isChaser && roomState.state === 'ACTIVE' && (
          <div className="pointer-events-auto flex justify-center">
            <button
              onClick={() => {
                setShowTagModal(true);
                setTagError(null);
              }}
              className="w-full min-h-[48px] bg-[#FF4655] hover:brightness-110 active:scale-98 text-white font-black px-6 py-3.5 rounded-2xl shadow-tactical-glow text-sm flex items-center justify-center gap-2 transition-all uppercase tracking-wider"
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>Tag Nearby Runner ({uncaughtRunners.length} left)</span>
            </button>
          </div>
        )}

        {/* REAL-TIME WEBRTC WALKIE-TALKIE PUSH-TO-TALK BAR */}
        {voice && myMember?.team !== 'NONE' && (
          <div className="pointer-events-auto bg-[#1F2731] border border-[#3B4652] p-2.5 rounded-2xl shadow-2xl flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="w-3.5 h-3.5 text-[#FF4655]" />
                <span className="text-xs font-mono font-bold text-white uppercase">
                  {voice.activeVoiceChannel ? `${voice.activeVoiceChannel} Radio` : 'Radio Offline'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                {voice.activeVoiceChannel && (
                  voice.diagnostics?.status === 'CONNECTED' ? (
                    <span className="text-[10px] font-mono text-[#4CC38A] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4CC38A] animate-pulse" />
                      {voice.diagnostics.connectedPeerCount} Peer{voice.diagnostics.connectedPeerCount > 1 ? 's' : ''}
                    </span>
                  ) : voice.diagnostics?.status === 'WAITING_PEERS' ? (
                    <span className="text-[10px] font-mono text-amber-400 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      Awaiting
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-[#39BDE8] font-bold flex items-center gap-1 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#39BDE8]" />
                      {voice.diagnostics?.status || 'Connecting'}
                    </span>
                  )
                )}

                <button
                  type="button"
                  onClick={() => setShowVoiceDiagnostics(true)}
                  className="p-1.5 rounded-lg bg-[#293440] text-[#39BDE8] hover:text-white"
                  title="Voice Diagnostics"
                >
                  <Activity className="w-3.5 h-3.5" />
                </button>

                {voice.activeVoiceChannel && (
                  <>
                    <button
                      type="button"
                      onClick={voice.toggleMute}
                      className="p-1.5 rounded-lg bg-[#293440] text-[#A8B0BA] hover:text-white"
                      title={voice.isMuted ? 'Unmute' : 'Mute'}
                    >
                      {voice.isMuted ? (
                        <MicOff className="w-3.5 h-3.5 text-[#FF4655]" />
                      ) : (
                        <Mic className="w-3.5 h-3.5 text-[#4CC38A]" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={voice.leaveVoiceChannel}
                      className="p-1.5 rounded-lg bg-[#293440] text-[#FF4655] hover:text-white"
                      title="Disconnect Radio"
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Radio Channel Quick Switcher */}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() =>
                  voice.activeVoiceChannel === 'SQUAD'
                    ? voice.leaveVoiceChannel()
                    : voice.joinVoiceChannel('SQUAD')
                }
                className={`flex-1 py-1 px-2 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1 transition-all border ${
                  voice.activeVoiceChannel === 'SQUAD'
                    ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                    : 'bg-[#293440] border-[#3B4652] text-[#A8B0BA] hover:text-white'
                }`}
              >
                <span>Squad Radio</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  voice.activeVoiceChannel === 'PUBLIC'
                    ? voice.leaveVoiceChannel()
                    : voice.joinVoiceChannel('PUBLIC')
                }
                className={`flex-1 py-1 px-2 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1 transition-all border ${
                  voice.activeVoiceChannel === 'PUBLIC'
                    ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                    : 'bg-[#293440] border-[#3B4652] text-[#A8B0BA] hover:text-white'
                }`}
              >
                <span>Public Radio</span>
              </button>
            </div>

            {/* Autoplay Blocked Banner */}
            {voice.autoplayBlocked && (
              <button
                type="button"
                onClick={voice.enableAudioPlayback}
                className="w-full py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-amber-300 font-mono text-[10px] rounded-xl font-bold flex items-center justify-center gap-1.5 animate-pulse transition-all shadow"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Audio Blocked By Browser — Tap to Enable Playback</span>
              </button>
            )}

            {/* PTT Action Trigger Button */}
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
                className={`w-full min-h-[48px] rounded-xl font-mono font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all select-none border active:scale-98 ${
                  voice.isTransmitting
                    ? 'bg-[#FF4655] text-white border-[#FF4655] shadow-tactical-glow animate-pulse'
                    : 'bg-[#293440] border-[#3B4652] text-white hover:border-[#FF4655]'
                }`}
              >
                <Mic className="w-4 h-4" />
                <span>
                  {voice.isTransmitting
                    ? 'TRANSMITTING LIVE...'
                    : 'HOLD PTT TO TRANSMIT [SPACE / V / HOLD]'}
                </span>
              </button>
            )}

            {/* Voice Error Notice */}
            {voice.voiceError && (
              <div className="p-2 rounded-xl bg-[#FF4655]/20 border border-[#FF4655]/50 text-[#FF4655] text-[10px] font-mono flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 break-words leading-tight">{voice.voiceError}</span>
              </div>
            )}

            {/* Speaking Participants Indicator */}
            {voice.speakingPlayerIds.size > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#4CC38A] pt-0.5">
                <span className="w-2 h-2 rounded-full bg-[#4CC38A] animate-ping" />
                <span>Operative transmitting voice...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chaser Tag Runner Modal (Proximity OR Catch Code) */}
      {showTagModal && (
        <div className="fixed inset-0 z-[600] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#1F2731] border border-[#3B4652] w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#3B4652] pb-3">
              <div className="flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-[#FF4655]" />
                <h3 className="font-bold text-sm text-white">Claim Runner Tag</h3>
              </div>
              <button
                onClick={() => setShowTagModal(false)}
                className="text-[#A8B0BA] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {tagError && (
              <div className="p-2.5 rounded-xl bg-[#FF4655]/20 border border-[#FF4655] text-[#FF4655] text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{tagError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-mono text-[#A8B0BA] block mb-1">
                  Target Runner
                </label>
                <select
                  value={selectedRunnerId}
                  onChange={(e) => setSelectedRunnerId(e.target.value)}
                  className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF4655]"
                >
                  <option value="">Select a Runner...</option>
                  {uncaughtRunners.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nickname}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#A8B0BA] block mb-1">
                  Runner 4-Digit Catch PIN
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={enteredCatchCode}
                  onChange={(e) =>
                    setEnteredCatchCode(e.target.value.replace(/\D/g, ''))
                  }
                  placeholder="e.g. 8421"
                  className="w-full bg-[#293440] border border-[#3B4652] rounded-xl px-4 py-2.5 text-center font-mono text-lg font-black tracking-widest text-white placeholder-neutral-600 focus:outline-none focus:border-[#FF4655]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    if (!selectedRunnerId) {
                      setTagError('Please select a target runner.');
                      return;
                    }
                    onAttemptCatch(selectedRunnerId);
                    setShowTagModal(false);
                  }}
                  className="flex-1 py-3 bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-[#ECE8E1] font-bold rounded-xl text-xs uppercase"
                >
                  GPS Proximity Tag
                </button>
                <button
                  onClick={handleClaimTagWithCode}
                  disabled={isVerifyingCode}
                  className="flex-1 py-3 bg-[#FF4655] hover:brightness-110 text-white font-black rounded-xl text-xs uppercase shadow-tactical-glow disabled:opacity-50"
                >
                  {isVerifyingCode ? 'Verifying PIN...' : 'Verify PIN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Runner Dispute/Confirm Tag Modal */}
      {pendingCatch && pendingCatch.runnerId === myPlayerId && (
        <div className="fixed inset-0 z-[700] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1F2731] border-2 border-[#FF4655] w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#FF4655]/20 border border-[#FF4655] flex items-center justify-center mx-auto text-[#FF4655]">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight">
              Tag Claimed Against You!
            </h2>
            <p className="text-xs text-[#ECE8E1] leading-relaxed">
              <strong className="text-[#FF4655]">{pendingCatch.chaserNickname}</strong>{' '}
              claims to have tagged you at a distance of{' '}
              <strong className="text-white">
                {Math.round(pendingCatch.distanceMeters)}m
              </strong>
              . Did they physically tag you?
            </p>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => onRespondCatch(pendingCatch.id, 'DISPUTE')}
                className="flex-1 py-3 bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-[#ECE8E1] font-bold rounded-xl text-xs uppercase"
              >
                Dispute Tag
              </button>
              <button
                onClick={() => onRespondCatch(pendingCatch.id, 'CONFIRM')}
                className="flex-1 py-3 bg-[#FF4655] hover:brightness-110 text-white font-black rounded-xl text-xs uppercase shadow-tactical-glow"
              >
                Confirm Caught
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Operative Personal Dossier Modal */}
      {showDossier && (
        <PlayerDossierModal
          playerId={myPlayerId}
          nickname={myMember?.nickname || 'Operative'}
          currentRole={myMember?.role}
          currentTeam={myMember?.team}
          isMe={true}
          onClose={() => setShowDossier(false)}
          socket={socket}
        />
      )}

      {/* Authoritative Leave Room Modal */}
      <LeaveRoomModal
        isOpen={showLeaveModal}
        isHost={isHostOrReferee && myMember?.role === 'HOST'}
        onConfirm={() => {
          setShowLeaveModal(false);
          onLeaveRoom?.();
        }}
        onCancel={() => setShowLeaveModal(false)}
      />

      {/* Real-time Voice Diagnostics Modal */}
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
      {/* Runner Secret Catch PIN Modal */}
      {showRunnerCodeModal && (
        <div className="fixed inset-0 z-[750] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1F2731] border-2 border-[#39BDE8] w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono font-bold text-[#A8B0BA] uppercase">Catch Verification PIN</span>
              <button onClick={() => setShowRunnerCodeModal(false)} className="text-[#A8B0BA] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-mono uppercase text-[#A8B0BA]">Single-Use Runner PIN</span>
              <div className="text-4xl font-mono font-black text-[#39BDE8] tracking-widest py-3 bg-[#161E27] border border-[#3B4652] rounded-2xl select-all">
                {localCatchCode || myMember?.catchCode || '----'}
              </div>
            </div>

            {/* Countdown validity indicator */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-[#A8B0BA]">
                <span>Code Validity:</span>
                <span className={codeSecondsRemaining <= 5 ? 'text-[#FF4655] font-bold animate-pulse' : 'text-white'}>
                  {codeSecondsRemaining > 0 ? `${codeSecondsRemaining}s remaining` : 'Expired / Refresh'}
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#293440] rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${codeSecondsRemaining <= 5 ? 'bg-[#FF4655]' : 'bg-[#39BDE8]'}`}
                  style={{
                    width: `${Math.min(
                      100,
                      (codeSecondsRemaining / (roomState.config.missions?.catchCodeExpirySeconds || 30)) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            {codeRequestError && (
              <div className="text-[10px] font-mono text-[#FF4655] bg-[#FF4655]/10 p-2 rounded-xl border border-[#FF4655]/30">
                {codeRequestError}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCopyCode}
                className="flex-1 py-2.5 bg-[#293440] hover:bg-[#3B4652] text-white font-mono font-bold rounded-xl text-xs uppercase flex items-center justify-center gap-1.5"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-[#39BDE8]" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                onClick={handleRequestNewCode}
                disabled={isRequestingCode}
                className="flex-1 py-2.5 bg-[#39BDE8] hover:brightness-110 text-[#0F1923] font-mono font-black rounded-xl text-xs uppercase flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRequestingCode ? 'animate-spin' : ''}`} />
                <span>{isRequestingCode ? 'Generating...' : 'Refresh PIN'}</span>
              </button>
            </div>

            <p className="text-[10px] text-[#A8B0BA] font-mono leading-relaxed">
              Show this PIN physically to the chaser tagging you. Each PIN expires in{' '}
              {roomState.config.missions?.catchCodeExpirySeconds || 30}s.
            </p>
          </div>
        </div>
      )}

      {/* Victory / Match End Summary Modal */}
      {roomState.state === 'COMPLETED' && !victoryDismissed && (
        <div className="fixed inset-0 z-[850] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1F2731] border-2 border-[#FFB800] w-full max-w-md rounded-3xl p-6 text-center shadow-2xl space-y-4">
            <div className="w-14 h-14 rounded-full bg-[#FFB800]/20 border border-[#FFB800] flex items-center justify-center mx-auto text-[#FFB800]">
              <Zap className="w-8 h-8 animate-pulse" />
            </div>

            <div>
              <span className="text-xs font-mono font-bold tracking-widest text-[#A8B0BA] uppercase">
                Match Complete
              </span>
              <h2 className="text-2xl font-black text-white font-mono uppercase tracking-tight mt-0.5">
                {roomState.match?.winnerTeam === 'DRAW'
                  ? 'MATCH ENDED IN DRAW'
                  : `${roomState.match?.winnerTeam} VICTORY!`}
              </h2>
            </div>

            {/* Final Scores Breakdown */}
            <div className="grid grid-cols-2 gap-3 bg-[#161E27] p-3 rounded-2xl border border-[#3B4652] font-mono">
              <div className="text-center p-2 rounded-xl bg-[#293440]">
                <span className="text-[10px] text-[#39BDE8] uppercase font-bold block">Runners Team</span>
                <span className="text-2xl font-black text-white">
                  {roomState.match?.scoreLedger?.teamScores?.RUNNERS ?? 0}
                </span>
                <span className="text-[9px] text-[#A8B0BA] block mt-0.5">Points</span>
              </div>
              <div className="text-center p-2 rounded-xl bg-[#293440]">
                <span className="text-[10px] text-[#FF4655] uppercase font-bold block">Chasers Team</span>
                <span className="text-2xl font-black text-white">
                  {roomState.match?.scoreLedger?.teamScores?.CHASERS ?? 0}
                </span>
                <span className="text-[9px] text-[#A8B0BA] block mt-0.5">Points</span>
              </div>
            </div>

            {/* Individual Score Card */}
            <div className="bg-[#161E27] p-2.5 rounded-xl border border-[#3B4652] flex items-center justify-between text-xs font-mono">
              <span className="text-[#A8B0BA]">Your Personal Score:</span>
              <strong className="text-[#FFB800] text-sm">
                {roomState.match?.scoreLedger?.individualScores?.[myPlayerId] ?? 0} PTS
              </strong>
            </div>

            <div className="text-[10px] text-[#A8B0BA] font-mono space-y-1 text-left bg-[#161E27] p-2.5 rounded-xl border border-[#3B4652]">
              <div className="text-white font-bold uppercase tracking-wider mb-0.5">Victory Bonus Ledger</div>
              <div>• Team Winner Bonus: +{roomState.config.missions?.winningTeamBonus ?? 500} Team Pts to {roomState.match?.winnerTeam || 'N/A'}</div>
              <div>• Solo Winner Bonus: +{roomState.config.missions?.winningIndividualBonus ?? 100} Solo Pts awarded to each winner</div>
            </div>

            <button
              type="button"
              onClick={() => setShowScoreEventsModal(true)}
              className="w-full py-2 bg-[#161E27] hover:bg-[#293440] border border-[#3B4652] text-[#FFB800] font-mono text-[11px] font-bold rounded-xl uppercase transition-colors"
            >
              View Verified Score Events Ledger
            </button>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setVictoryDismissed(true)}
                className="flex-1 py-3 bg-[#293440] hover:bg-[#3B4652] border border-[#3B4652] text-[#ECE8E1] font-mono font-bold rounded-xl text-xs uppercase"
              >
                Inspect Map
              </button>
              {onLeaveRoom && (
                <button
                  onClick={() => {
                    setVictoryDismissed(true);
                    onLeaveRoom();
                  }}
                  className="flex-1 py-3 bg-[#FF4655] hover:brightness-110 text-white font-mono font-black rounded-xl text-xs uppercase shadow-tactical-glow"
                >
                  Exit to Lobby
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Verified Score Events & Live Ledger Modal */}
      {showScoreEventsModal && (
        <div className="fixed inset-0 z-[1100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 text-left">
          <div className="bg-[#1F2731] border border-[#3B4652] rounded-3xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden font-mono text-xs">
            {/* Header */}
            <div className="px-5 py-4 bg-[#161E27] border-b border-[#3B4652] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Shield className="w-5 h-5 text-[#FFB800]" />
                <h3 className="text-sm font-bold text-white tracking-wide uppercase">
                  Verified Match Scoring Ledger
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowScoreEventsModal(false)}
                className="w-8 h-8 rounded-xl bg-[#293440] hover:bg-[#3B4652] text-[#A8B0BA] hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Score Summary Strip */}
            <div className="p-4 bg-[#293440]/60 border-b border-[#3B4652] grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-xl bg-[#1F2731] border border-[#3B4652]">
                <span className="text-[10px] text-[#39BDE8] font-bold block uppercase">Runners Team</span>
                <span className="text-lg font-black text-white">{roomState.match?.scoreLedger?.teamScores?.RUNNERS ?? 0}</span>
              </div>
              <div className="p-2 rounded-xl bg-[#1F2731] border border-[#3B4652]">
                <span className="text-[10px] text-[#FF4655] font-bold block uppercase">Chasers Team</span>
                <span className="text-lg font-black text-white">{roomState.match?.scoreLedger?.teamScores?.CHASERS ?? 0}</span>
              </div>
              <div className="p-2 rounded-xl bg-[#1F2731] border border-[#FFB800]/50">
                <span className="text-[10px] text-[#FFB800] font-bold block uppercase">Your Solo</span>
                <span className="text-lg font-black text-[#FFB800]">{roomState.match?.scoreLedger?.individualScores?.[myPlayerId] ?? roomState.match?.scoreLedger?.playerScores?.[myPlayerId] ?? 0}</span>
              </div>
            </div>

            {/* Event List */}
            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              <div className="flex items-center justify-between text-[11px] text-[#A8B0BA] pb-1 border-b border-[#3B4652]/60">
                <span className="font-bold uppercase tracking-wider">Authoritative Events ({roomState.match?.scoreLedger?.events?.length || 0})</span>
                <span className="text-[10px]">Newest First</span>
              </div>

              {(!roomState.match?.scoreLedger?.events || roomState.match.scoreLedger.events.length === 0) ? (
                <div className="py-8 text-center text-[#A8B0BA] italic">
                  No verified scoring events recorded yet. Complete missions or tag runners to earn points.
                </div>
              ) : (
                [...(roomState.match.scoreLedger.events)].reverse().map((ev) => {
                  let badge = 'bg-neutral-800 text-neutral-300 border-neutral-700';
                  let typeLabel: string = ev.type;

                  if (ev.type === 'CATCH_AWARD') {
                    badge = 'bg-[#FF4655]/20 text-[#FF4655] border-[#FF4655]/50';
                    typeLabel = 'CATCH VERIFIED';
                  } else if (ev.type === 'INTERCEPTION') {
                    badge = 'bg-amber-500/20 text-amber-300 border-amber-500/50';
                    typeLabel = 'INTERCEPTION';
                  } else if (ev.type === 'CHASER_MILESTONE') {
                    badge = 'bg-purple-500/20 text-purple-300 border-purple-500/50';
                    typeLabel = 'CHASER PATROL';
                  } else if (ev.type === 'MISSION_COMPLETED') {
                    badge = 'bg-[#39BDE8]/20 text-[#39BDE8] border-[#39BDE8]/50';
                    typeLabel = 'MISSION COMPLETED';
                  } else if (ev.type === 'SURVIVAL_MILESTONE') {
                    badge = 'bg-[#4CC38A]/20 text-[#4CC38A] border-[#4CC38A]/50';
                    typeLabel = 'SURVIVAL MILESTONE';
                  } else if (ev.type === 'WINNING_BONUS') {
                    badge = 'bg-[#FFB800]/20 text-[#FFB800] border-[#FFB800]/50';
                    typeLabel = 'VICTORY BONUS';
                  }

                  return (
                    <div
                      key={ev.id || ev.idempotencyKey}
                      className="p-3 rounded-2xl bg-[#161E27] border border-[#3B4652] space-y-1.5 hover:border-[#A8B0BA]/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badge}`}>
                          {typeLabel}
                        </span>
                        <span className="text-[10px] text-[#A8B0BA]">
                          {new Date(ev.timestamp).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="text-white font-medium text-xs leading-relaxed">
                        {ev.reason}
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#3B4652]/40 text-[#A8B0BA]">
                        <div className="flex items-center gap-2">
                          <span className={ev.team === 'RUNNERS' ? 'text-[#39BDE8] font-bold' : ev.team === 'CHASERS' ? 'text-[#FF4655] font-bold' : 'text-neutral-400'}>
                            {ev.team}
                          </span>
                          {ev.playerNickname && (
                            <span>• {ev.playerNickname}</span>
                          )}
                        </div>
                        <div className="font-bold flex items-center gap-2">
                          {ev.pointsIndividual > 0 && (
                            <span className="text-[#FFB800]">+{ev.pointsIndividual} Solo</span>
                          )}
                          {ev.pointsTeam > 0 && (
                            <span className={ev.team === 'RUNNERS' ? 'text-[#39BDE8]' : 'text-[#FF4655]'}>
                              +{ev.pointsTeam} Team
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-[#161E27] border-t border-[#3B4652] flex justify-end">
              <button
                type="button"
                onClick={() => setShowScoreEventsModal(false)}
                className="px-4 py-2 bg-[#293440] hover:bg-[#3B4652] text-white text-xs font-bold rounded-xl transition-colors"
              >
                Close Ledger
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
