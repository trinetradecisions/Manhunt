'use client';

import { X, Activity, Wifi, Mic, Radio, Volume2, AlertTriangle, ShieldCheck, Check, RefreshCw } from 'lucide-react';
import { VoiceDiagnostics, VoiceParticipant } from '../types/game';

interface VoiceDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagnostics?: VoiceDiagnostics;
  participants: VoiceParticipant[];
  isSocketConnected: boolean;
  socketId: string | null;
  serverUrl: string;
  onUnlockAudio?: () => void;
  onRetryChannel?: () => void;
}

export default function VoiceDiagnosticsModal({
  isOpen,
  onClose,
  diagnostics,
  participants,
  isSocketConnected,
  socketId,
  serverUrl,
  onUnlockAudio,
  onRetryChannel,
}: VoiceDiagnosticsModalProps) {
  if (!isOpen) return null;

  const status = diagnostics?.status || 'DISCONNECTED';
  const peerStates = diagnostics?.peerStates || {};
  const peerList = Object.values(peerStates);

  const getStatusColor = () => {
    switch (status) {
      case 'CONNECTED':
        return 'text-[#4CC38A] border-[#4CC38A] bg-[#4CC38A]/10';
      case 'NEGOTIATING':
      case 'JOINING':
        return 'text-[#39BDE8] border-[#39BDE8] bg-[#39BDE8]/10 animate-pulse';
      case 'WAITING_PEERS':
        return 'text-amber-400 border-amber-400 bg-amber-400/10';
      default:
        return 'text-[#A8B0BA] border-[#3B4652] bg-[#1F2731]';
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'CONNECTED':
        return 'Connected — Peer audio channel active.';
      case 'NEGOTIATING':
        return 'Establishing secure peer media connection...';
      case 'WAITING_PEERS':
        return 'Channel joined. Waiting for another player to connect.';
      case 'JOINING':
        return 'Connecting to tactical voice server...';
      default:
        return 'Disconnected from voice channel.';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1100] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 select-none animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-[#1F2731] border border-[#3B4652] w-full max-w-lg rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#3B4652] pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#FF4655]/20 border border-[#FF4655]/50 flex items-center justify-center">
              <Activity className="w-4 h-4 text-[#FF4655]" />
            </div>
            <div>
              <h3 className="font-mono font-bold text-sm uppercase text-white tracking-wider">
                WebRTC Voice Diagnostics
              </h3>
              <span className="text-[10px] text-[#A8B0BA] font-mono">
                Real-Time Mesh Audio Telemetry
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#A8B0BA] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Overall Status Banner */}
        <div className={`p-3 rounded-2xl border flex items-center justify-between gap-2 ${getStatusColor()}`}>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-current animate-ping" />
            <div>
              <span className="font-mono font-black text-xs uppercase tracking-wider block">
                STATUS: {status}
              </span>
              <span className="text-[11px] opacity-90">{getStatusMessage()}</span>
            </div>
          </div>
          {onRetryChannel && diagnostics?.selectedChannel && (
            <button
              onClick={onRetryChannel}
              className="p-1.5 rounded-xl bg-black/30 hover:bg-black/50 text-white font-mono text-[10px] flex items-center gap-1 shrink-0"
              title="Reconnect Channel"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}
        </div>

        {/* Autoplay Warning & Unlock Button */}
        {diagnostics?.autoplayBlocked && (
          <div className="p-3 bg-amber-950/50 border border-amber-500 rounded-2xl text-amber-300 text-xs flex items-center justify-between gap-2 shadow-lg">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              <span className="text-[11px] leading-snug">
                Audio playback blocked by browser autoplay policy.
              </span>
            </div>
            {onUnlockAudio && (
              <button
                onClick={onUnlockAudio}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold font-mono text-xs rounded-xl uppercase shrink-0 active:scale-95 transition-all shadow"
              >
                Enable Audio
              </button>
            )}
          </div>
        )}

        {/* Error Notice */}
        {diagnostics?.lastError && (
          <div className="p-3 bg-[#FF4655]/20 border border-[#FF4655]/60 rounded-2xl text-[#FF4655] text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 text-[11px] leading-snug">
              <strong>Error:</strong> {diagnostics.lastError}
            </div>
          </div>
        )}

        {/* Diagnostics Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="p-2.5 bg-[#293440] border border-[#3B4652] rounded-2xl space-y-1">
            <span className="text-[10px] text-[#A8B0BA] uppercase block">Selected Channel</span>
            <span className="font-bold text-white text-sm">
              {diagnostics?.selectedChannel || 'NONE'}
            </span>
          </div>

          <div className="p-2.5 bg-[#293440] border border-[#3B4652] rounded-2xl space-y-1">
            <span className="text-[10px] text-[#A8B0BA] uppercase block">Microphone Access</span>
            <span
              className={`font-bold text-sm ${
                diagnostics?.micPermission === 'granted'
                  ? 'text-[#4CC38A]'
                  : diagnostics?.micPermission === 'denied'
                  ? 'text-[#FF4655]'
                  : 'text-amber-400'
              }`}
            >
              {diagnostics?.micPermission?.toUpperCase() || 'PROMPT'}
            </span>
          </div>

          <div className="p-2.5 bg-[#293440] border border-[#3B4652] rounded-2xl space-y-1">
            <span className="text-[10px] text-[#A8B0BA] uppercase block">Local Mic Stream</span>
            <span
              className={`font-bold text-sm ${
                diagnostics?.hasMicStream ? 'text-[#4CC38A]' : 'text-neutral-400'
              }`}
            >
              {diagnostics?.hasMicStream ? 'ACTIVE (PTT-GATED)' : 'INACTIVE'}
            </span>
          </div>

          <div className="p-2.5 bg-[#293440] border border-[#3B4652] rounded-2xl space-y-1">
            <span className="text-[10px] text-[#A8B0BA] uppercase block">WebRTC Connected Peers</span>
            <span className="font-bold text-white text-sm">
              {diagnostics?.connectedPeerCount || 0} / {participants.length}
            </span>
          </div>

          <div className="p-2.5 bg-[#293440] border border-[#3B4652] rounded-2xl space-y-1 col-span-2">
            <span className="text-[10px] text-[#A8B0BA] uppercase block">Signaling Server</span>
            <div className="flex items-center justify-between text-xs text-neutral-300">
              <span className="truncate max-w-[280px]">{serverUrl}</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  isSocketConnected
                    ? 'bg-emerald-950/80 text-[#4CC38A] border border-[#4CC38A]/50'
                    : 'bg-red-950/80 text-[#FF4655] border border-[#FF4655]/50'
                }`}
              >
                {isSocketConnected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
            </div>
            {socketId && (
              <span className="text-[10px] text-[#A8B0BA] block">Socket ID: {socketId}</span>
            )}
          </div>
        </div>

        {/* Peer Connections Detail Table */}
        <div className="space-y-2 pt-1 font-mono">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8B0BA] block">
            Channel Peers &amp; Mesh State ({participants.length})
          </span>

          {participants.length === 0 ? (
            <div className="p-3 bg-[#293440] border border-[#3B4652] rounded-2xl text-center text-xs text-[#A8B0BA] italic">
              No other operatives in this channel. Invite a second device or teammate to establish voice mesh.
            </div>
          ) : (
            <div className="space-y-2">
              {participants.map((p) => {
                const pState = peerStates[p.playerId];
                const connState = pState?.connectionState || 'new';
                const iceState = pState?.iceConnectionState || 'new';
                const hasTrack = pState?.hasAudioTrack || false;

                const isConnected = connState === 'connected' || iceState === 'connected';

                return (
                  <div
                    key={p.playerId}
                    className="p-3 bg-[#293440] border border-[#3B4652] rounded-2xl flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isConnected ? 'bg-[#4CC38A] animate-pulse' : 'bg-amber-400'
                          }`}
                        />
                        <span className="font-bold text-xs text-white">{p.nickname}</span>
                        <span className="text-[10px] text-[#A8B0BA]">({p.playerId.slice(-4)})</span>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                          isConnected
                            ? 'bg-[#4CC38A]/20 border-[#4CC38A] text-[#4CC38A]'
                            : 'bg-amber-950/50 border-amber-600/50 text-amber-300'
                        }`}
                      >
                        {isConnected ? 'ESTABLISHED' : connState.toUpperCase()}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 text-[10px] text-[#A8B0BA] pt-1 border-t border-[#3B4652]/50">
                      <div>
                        <span>ICE: </span>
                        <strong className="text-white">{iceState}</strong>
                      </div>
                      <div>
                        <span>Gather: </span>
                        <strong className="text-white">{pState?.iceGatheringState || 'new'}</strong>
                      </div>
                      <div>
                        <span>Track: </span>
                        <strong className={hasTrack ? 'text-[#4CC38A]' : 'text-amber-400'}>
                          {hasTrack ? 'Received' : 'Pending'}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Technical Guidance & Secure Context Notice */}
        <div className="p-3 bg-[#161e27] border border-[#3B4652] rounded-2xl text-[10px] font-mono text-[#A8B0BA] space-y-1 leading-relaxed">
          <div className="flex items-center gap-1.5 text-white font-bold">
            <ShieldCheck className="w-3.5 h-3.5 text-[#39BDE8]" />
            <span>Browser Security &amp; Network Configuration</span>
          </div>
          <p>
            &bull; <strong>Microphone Access:</strong> Requires a Secure Context (<code className="text-white">localhost</code> or <code className="text-white">HTTPS</code>). On mobile testing over local LAN IP, use HTTPS or Chrome flag <code className="text-[#39BDE8]">unsafely-treat-insecure-origin-as-secure</code>.
          </p>
          <p>
            &bull; <strong>STUN / TURN Relay:</strong> Google STUN is active for standard NAT traversal. If testing across isolated cellular networks or symmetric firewalls, configure a TURN relay in environment settings.
          </p>
        </div>
      </div>
    </div>
  );
}
