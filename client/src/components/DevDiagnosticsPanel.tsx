'use client';

import { useState, useEffect } from 'react';
import {
  Terminal,
  Activity,
  Satellite,
  Zap,
  Lock,
  AlertTriangle,
  X,
} from 'lucide-react';
import { OneShotGpsDiagnostics, ExtendedGpsStatus } from '../hooks/useGeolocation';
import { SocketDiagnostics } from '../hooks/useSocket';
import { PlayerLocation } from '../types/game';

interface DevDiagnosticsPanelProps {
  oneShotGps: OneShotGpsDiagnostics;
  onRequestOneShotGps: () => void;
  activeLocation: PlayerLocation | null;
  gpsStatus: ExtendedGpsStatus;
  browserPermissionState?: string;
  isGpsStale: boolean;
  gpsErrorMessage: string | null;
  socketDiagnostics: SocketDiagnostics;
  onMeasurePing: () => Promise<number | null>;
  onManualReconnect: () => void;
  roomCode: string;
  playerId: string;
}

export default function DevDiagnosticsPanel({
  oneShotGps,
  onRequestOneShotGps,
  activeLocation,
  gpsStatus,
  browserPermissionState = 'unknown',
  isGpsStale,
  gpsErrorMessage,
  socketDiagnostics,
  onMeasurePing,
  onManualReconnect,
  roomCode,
  playerId,
}: DevDiagnosticsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [lastPingResult, setLastPingResult] = useState<number | null>(null);
  const [isDevMode, setIsDevMode] = useState(false);

  // Development-only check: only active in NODE_ENV !== 'production' or explicit ?diag=1 / ?dev=true query
  useEffect(() => {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const hasDiagParam =
      typeof window !== 'undefined' &&
      (window.location.search.includes('diag=1') ||
        window.location.search.includes('dev=true'));

    setIsDevMode(isDevelopment || hasDiagParam);
  }, []);

  // Strict development-only gate: Never render in public production
  if (!isDevMode) {
    return null;
  }

  const handlePingTest = async () => {
    setIsPinging(true);
    const result = await onMeasurePing();
    setLastPingResult(result);
    setIsPinging(false);
  };

  const isSocketOk = socketDiagnostics.status === 'CONNECTED';
  const isGpsOk = activeLocation !== null && !isGpsStale;

  return (
    <>
      {/* Floating Tactical Dev Trigger Button */}
      <div className="fixed bottom-3 left-3 z-[999] pointer-events-auto">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[11px] font-mono font-bold shadow-2xl backdrop-blur-md transition-all active:scale-95 ${
            isOpen
              ? 'bg-neutral-900 border-neutral-600 text-white'
              : 'bg-neutral-950/90 hover:bg-neutral-900 border-neutral-800 text-neutral-300'
          }`}
          title="Development-Only Diagnostics Panel"
        >
          <span className="flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full ${
                isSocketOk ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'
              }`}
            />
            <span
              className={`w-2 h-2 rounded-full ${
                isGpsOk
                  ? 'bg-emerald-400'
                  : gpsStatus === 'PERMISSION_DENIED'
                  ? 'bg-red-500'
                  : 'bg-amber-400 animate-pulse'
              }`}
            />
          </span>
          <Terminal className="w-3.5 h-3.5 text-amber-400" />
          <span>DEV DIAGNOSTICS</span>
          <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400">
            {isOpen ? 'CLOSE' : 'INSPECT'}
          </span>
        </button>
      </div>

      {/* Expanded Diagnostics Overlay Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[1000] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-4 pointer-events-auto">
          <div className="bg-neutral-950 border border-neutral-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono text-xs">
            {/* Header */}
            <div className="px-5 py-3.5 bg-neutral-900/80 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                <h3 className="text-sm font-bold text-white tracking-wide">
                  SYSTEM DIAGNOSTICS <span className="text-amber-400 text-[10px]">[DEV-ONLY]</span>
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-7 h-7 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white flex items-center justify-center text-xs font-bold"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="p-5 overflow-y-auto space-y-5 text-neutral-300">
              {/* SECTION 1: GPS Diagnostics */}
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
                  <div className="flex items-center gap-2 font-bold text-neutral-100">
                    <Satellite className="w-4 h-4 text-emerald-400" />
                    <span>GPS & Geolocation Diagnostics</span>
                  </div>
                  <button
                    onClick={onRequestOneShotGps}
                    disabled={oneShotGps.status === 'REQUESTING'}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-3 py-1 rounded-lg text-[10px] tracking-wide active:scale-95 transition-all"
                  >
                    {oneShotGps.status === 'REQUESTING'
                      ? 'Requesting...'
                      : 'Trigger getCurrentPosition()'}
                  </button>
                </div>

                {/* Notice regarding coordinate integrity */}
                <div className="text-[10px] bg-neutral-950 p-2 rounded-lg border border-neutral-800/80 text-neutral-400 leading-relaxed flex items-start gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Integrity Guarantee:</strong> Only authentic hardware GPS readings are reported. Default map centers and simulated coordinates are strictly prohibited.</span>
                </div>

                {/* Raw one-shot GPS details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      One-Shot Execution State
                    </span>
                    <div className="flex items-center gap-1.5 font-bold">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          oneShotGps.status === 'SUCCESS'
                            ? 'bg-emerald-400'
                            : oneShotGps.status === 'REQUESTING'
                            ? 'bg-amber-400 animate-ping'
                            : oneShotGps.status === 'ERROR'
                            ? 'bg-red-500'
                            : 'bg-neutral-600'
                        }`}
                      />
                      <span
                        className={
                          oneShotGps.status === 'SUCCESS'
                            ? 'text-emerald-400'
                            : oneShotGps.status === 'ERROR'
                            ? 'text-red-400'
                            : 'text-neutral-300'
                        }
                      >
                        {oneShotGps.status}
                      </span>
                    </div>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Continuous Watch Status
                    </span>
                    <span className="font-bold text-neutral-200 block">
                      State: <span className="text-amber-300">{gpsStatus}</span> (API: {browserPermissionState})
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      Stale:{' '}
                      <span className={isGpsStale ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                        {isGpsStale ? 'YES (>45s)' : 'NO'}
                      </span>
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Latitude
                    </span>
                    <span className="font-bold text-white select-all">
                      {oneShotGps.latitude !== null
                        ? oneShotGps.latitude.toFixed(6)
                        : activeLocation
                        ? activeLocation.latitude.toFixed(6)
                        : 'None (Permission/Fix required)'}
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Longitude
                    </span>
                    <span className="font-bold text-white select-all">
                      {oneShotGps.longitude !== null
                        ? oneShotGps.longitude.toFixed(6)
                        : activeLocation
                        ? activeLocation.longitude.toFixed(6)
                        : 'None (Permission/Fix required)'}
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Accuracy
                    </span>
                    <span className="font-bold text-neutral-200">
                      {oneShotGps.accuracy !== null
                        ? `±${oneShotGps.accuracy.toFixed(1)} meters`
                        : activeLocation
                        ? `±${activeLocation.accuracy} meters`
                        : 'None'}
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Reading Timestamp
                    </span>
                    <span className="font-bold text-neutral-200">
                      {oneShotGps.timestamp
                        ? new Date(oneShotGps.timestamp).toLocaleTimeString()
                        : activeLocation
                        ? new Date(activeLocation.timestamp).toLocaleTimeString()
                        : 'None'}
                    </span>
                  </div>
                </div>

                {/* Errors if any */}
                {(oneShotGps.errorMessage || gpsErrorMessage) && (
                  <div className="bg-red-950/60 border border-red-500/50 p-2.5 rounded-xl text-red-300 text-[11px] space-y-1">
                    <div className="font-bold text-red-200 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span>Geolocation Error {oneShotGps.errorCode ? `(Code ${oneShotGps.errorCode}: ${oneShotGps.errorName})` : ''}</span>
                    </div>
                    <div>{oneShotGps.errorMessage || gpsErrorMessage}</div>
                  </div>
                )}
              </div>

              {/* SECTION 2: Socket.IO Diagnostics */}
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
                  <div className="flex items-center gap-2 font-bold text-neutral-100">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>Socket.IO Connection Diagnostics</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePingTest}
                      disabled={isPinging || !isSocketOk}
                      className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 font-bold px-2.5 py-1 rounded-lg text-[10px] active:scale-95 transition-all"
                    >
                      {isPinging ? 'Pinging...' : 'Measure Ping'}
                    </button>
                    <button
                      onClick={onManualReconnect}
                      className="bg-neutral-800 hover:bg-neutral-700 text-amber-300 font-bold px-2.5 py-1 rounded-lg text-[10px] active:scale-95 transition-all border border-neutral-700"
                    >
                      Force Reconnect
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Connection Status
                    </span>
                    <div className="flex items-center gap-1.5 font-bold">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          socketDiagnostics.status === 'CONNECTED'
                            ? 'bg-emerald-400'
                            : socketDiagnostics.status === 'CONNECTING' ||
                              socketDiagnostics.status === 'RECONNECTING'
                            ? 'bg-amber-400 animate-ping'
                            : 'bg-red-500'
                        }`}
                      />
                      <span
                        className={
                          socketDiagnostics.status === 'CONNECTED'
                            ? 'text-emerald-400'
                            : socketDiagnostics.status === 'ERROR' ||
                              socketDiagnostics.status === 'DISCONNECTED'
                            ? 'text-red-400'
                            : 'text-amber-400'
                        }
                      >
                        {socketDiagnostics.status}
                      </span>
                    </div>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Active Transport
                    </span>
                    <span className="font-bold text-neutral-200">
                      {socketDiagnostics.activeTransport.toUpperCase()} (Upgraded)
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Socket ID
                    </span>
                    <span className="font-bold text-white select-all">
                      {socketDiagnostics.socketId || 'None (Disconnected)'}
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Server Endpoint
                    </span>
                    <span className="font-bold text-neutral-300 select-all">
                      {socketDiagnostics.serverUrl}
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Reconnection Attempts
                    </span>
                    <span className="font-bold text-neutral-200">
                      {socketDiagnostics.reconnectAttempts}
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Ping Round-Trip Latency
                    </span>
                    <span className="font-bold text-neutral-200">
                      {lastPingResult !== null && lastPingResult >= 0
                        ? `${lastPingResult} ms`
                        : socketDiagnostics.latencyMs !== null
                        ? `${socketDiagnostics.latencyMs} ms`
                        : 'Not tested yet'}
                    </span>
                  </div>

                  <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 space-y-1 sm:col-span-2">
                    <span className="text-[10px] text-neutral-500 font-bold block uppercase">
                      Client Session Context
                    </span>
                    <span className="font-mono text-neutral-300 text-[10px]">
                      Player: <code className="text-white">{playerId || 'Not initialized'}</code> |
                      Room: <code className="text-white">{roomCode || 'Lobby (No Room)'}</code>
                    </span>
                  </div>
                </div>

                {/* Disconnect or Error logs */}
                {socketDiagnostics.disconnectReason && (
                  <div className="bg-amber-950/40 border border-amber-500/40 p-2.5 rounded-xl text-amber-300 text-[11px] space-y-0.5">
                    <span className="font-bold">Last Disconnect Reason:</span>{' '}
                    <span>{socketDiagnostics.disconnectReason}</span>
                  </div>
                )}

                {socketDiagnostics.lastError && (
                  <div className="bg-red-950/60 border border-red-500/50 p-2.5 rounded-xl text-red-300 text-[11px] space-y-0.5">
                    <span className="font-bold">Last Socket Error:</span>{' '}
                    <span>{socketDiagnostics.lastError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-neutral-900/60 border-t border-neutral-800 flex items-center justify-between text-[11px] text-neutral-400">
              <span>Environment: {process.env.NODE_ENV || 'development'}</span>
              <button
                onClick={() => setIsOpen(false)}
                className="bg-neutral-800 hover:bg-neutral-700 text-white font-bold px-3 py-1 rounded-lg"
              >
                Close Diagnostics
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
