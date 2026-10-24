'use client';

import React, { useState } from 'react';
import {
  Satellite,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  HelpCircle,
  X,
  ExternalLink,
  MapPin,
  CheckCircle2,
} from 'lucide-react';
import { ExtendedGpsStatus } from '../hooks/useGeolocation';
import { PlayerLocation } from '../types/game';

interface GpsStatusIndicatorProps {
  gpsStatus: ExtendedGpsStatus;
  location: PlayerLocation | null;
  accuracy: number | null;
  lastFixTimestamp: number | null;
  isStale: boolean;
  errorMessage: string | null;
  isSecureContext: boolean;
  onRequestLocationAccess: () => void;
  className?: string;
}

export default function GpsStatusIndicator({
  gpsStatus,
  location,
  accuracy,
  lastFixTimestamp,
  isStale,
  errorMessage,
  isSecureContext,
  onRequestLocationAccess,
  className = '',
}: GpsStatusIndicatorProps) {
  const [showModal, setShowModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Derive display config based on status
  let badgeColor = 'bg-neutral-800 text-neutral-300 border-neutral-700';
  let dotColor = 'bg-neutral-500';
  let label = 'GPS Inactive';
  let IconComponent = Satellite;

  if (gpsStatus === 'NOT_ENABLED') {
    badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800/80';
    dotColor = 'bg-amber-400';
    label = 'Location Not Enabled';
  } else if (gpsStatus === 'INSECURE_CONTEXT') {
    badgeColor = 'bg-rose-950/90 text-rose-300 border-rose-800';
    dotColor = 'bg-rose-500 animate-pulse';
    label = 'HTTPS Required';
    IconComponent = ShieldAlert;
  } else if (gpsStatus === 'WAITING_FOR_PERMISSION') {
    badgeColor = 'bg-sky-950/80 text-sky-300 border-sky-800';
    dotColor = 'bg-sky-400 animate-pulse';
    label = 'Waiting for Permission';
  } else if (gpsStatus === 'ACQUIRING_FIX') {
    badgeColor = 'bg-sky-950/80 text-sky-300 border-sky-800';
    dotColor = 'bg-sky-400 animate-ping';
    label = 'Waiting for GPS Fix...';
  } else if (gpsStatus === 'ACQUIRED') {
    if (isStale) {
      badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800';
      dotColor = 'bg-amber-400';
      label = `GPS Stale (±${accuracy ?? 0}m)`;
      IconComponent = AlertTriangle;
    } else {
      badgeColor = 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
      dotColor = 'bg-emerald-400';
      label = `GPS Active (±${accuracy ?? 0}m)`;
      IconComponent = ShieldCheck;
    }
  } else if (gpsStatus === 'WEAK_SIGNAL') {
    badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800';
    dotColor = 'bg-amber-400 animate-pulse';
    label = `GPS Weak (±${accuracy ?? 0}m)`;
    IconComponent = AlertTriangle;
  } else if (gpsStatus === 'PERMISSION_DENIED') {
    badgeColor = 'bg-rose-950/90 text-rose-300 border-rose-800';
    dotColor = 'bg-rose-500';
    label = 'Permission Denied';
    IconComponent = ShieldAlert;
  } else if (gpsStatus === 'POSITION_UNAVAILABLE') {
    badgeColor = 'bg-rose-950/80 text-rose-300 border-rose-800';
    dotColor = 'bg-rose-400';
    label = 'GPS Unavailable';
    IconComponent = AlertTriangle;
  } else if (gpsStatus === 'TIMEOUT') {
    badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800';
    dotColor = 'bg-amber-400 animate-pulse';
    label = 'GPS Lost — Retrying';
    IconComponent = RefreshCw;
  } else if (gpsStatus === 'UNSUPPORTED') {
    badgeColor = 'bg-neutral-900 text-neutral-400 border-neutral-700';
    dotColor = 'bg-neutral-500';
    label = 'GPS Unsupported';
  }

  const handleCopyHttpsUrl = () => {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      const httpsUrl = `https://${hostname}:3000`;
      navigator.clipboard.writeText(httpsUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 3000);
    }
  };

  return (
    <>
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono font-medium border backdrop-blur-md transition-all active:scale-95 shadow-sm hover:brightness-110 ${badgeColor}`}
          title="Click for GPS Status & Mobile Setup Help"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          <IconComponent className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate max-w-[170px] sm:max-w-none">{label}</span>
          <HelpCircle className="w-3 h-3 opacity-60 ml-0.5" />
        </button>

        {/* Quick action button if not enabled or in error state */}
        {(gpsStatus === 'NOT_ENABLED' || gpsStatus === 'TIMEOUT' || gpsStatus === 'POSITION_UNAVAILABLE') && (
          <button
            type="button"
            onClick={onRequestLocationAccess}
            className="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-mono shadow transition-all active:scale-95 shrink-0"
          >
            Enable GPS
          </button>
        )}
      </div>

      {/* GPS Troubleshooting & Secure Context Guidance Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[1200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 text-left">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden font-sans text-neutral-200">
            {/* Header */}
            <div className="px-5 py-4 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Satellite className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white tracking-wide">
                  GPS & Mobile Location Status
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Current Status Card */}
              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 space-y-2 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Current Status:</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${badgeColor}`}>
                    {gpsStatus}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Secure Context (HTTPS):</span>
                  <span className={isSecureContext ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                    {isSecureContext ? 'YES (Secure)' : 'NO (Insecure HTTP)'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Reported Accuracy:</span>
                  <span className="text-white font-bold">
                    {accuracy !== null ? `±${accuracy} meters` : 'No fix yet'}
                  </span>
                </div>
                {location && (
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Coordinates:</span>
                    <span className="text-emerald-400 select-all">
                      {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                    </span>
                  </div>
                )}
                {lastFixTimestamp && (
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Last Observation:</span>
                    <span className="text-neutral-300">
                      {new Date(lastFixTimestamp).toLocaleTimeString()} ({Math.round((Date.now() - lastFixTimestamp) / 1000)}s ago)
                    </span>
                  </div>
                )}
              </div>

              {/* Error Message if present */}
              {errorMessage && (
                <div className="bg-rose-950/60 border border-rose-800/80 rounded-xl p-3 text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">{errorMessage}</p>
                </div>
              )}

              {/* Specific Guidance for INSECURE_CONTEXT */}
              {(!isSecureContext || gpsStatus === 'INSECURE_CONTEXT') && (
                <div className="bg-amber-950/50 border border-amber-800/80 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Why Mobile GPS Requires HTTPS</span>
                  </div>
                  <p className="text-neutral-300 leading-relaxed text-[11px]">
                    Modern mobile browsers (Chrome on Android, Safari on iOS) strictly block location access when connecting to LAN HTTP addresses (e.g. <code className="bg-black/60 px-1 py-0.5 rounded text-amber-200">http://172.16.72.57:3000</code>).
                  </p>

                  <div className="space-y-2 pt-1">
                    <div className="font-bold text-white text-[11px]">Recommended Solutions:</div>

                    <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800 space-y-1">
                      <div className="font-semibold text-emerald-400">Option 1: Next.js HTTPS Server (Recommended)</div>
                      <p className="text-neutral-400 text-[10px]">
                        Run the client with HTTPS enabled on your PC:
                      </p>
                      <pre className="bg-black p-1.5 rounded text-[10px] text-neutral-200 overflow-x-auto select-all font-mono">
                        npm run dev:https
                      </pre>
                      <p className="text-neutral-400 text-[10px]">
                        Then open <span className="text-amber-300 font-mono">https://YOUR_PC_IP:3000</span> on your mobile browser.
                      </p>
                      <button
                        type="button"
                        onClick={handleCopyHttpsUrl}
                        className="mt-1 text-[10px] px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 flex items-center gap-1.5 transition-colors font-mono"
                      >
                        {copiedUrl ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <ExternalLink className="w-3 h-3" />}
                        {copiedUrl ? 'Copied HTTPS URL!' : 'Copy Mobile HTTPS URL'}
                      </button>
                    </div>

                    <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800 space-y-1">
                      <div className="font-semibold text-sky-400">Option 2: Chrome Android Secure Origin Flag</div>
                      <p className="text-neutral-400 text-[10px]">
                        On your Android phone, open Chrome and navigate to:
                      </p>
                      <pre className="bg-black p-1.5 rounded text-[10px] text-sky-300 select-all font-mono">
                        chrome://flags/#unsafely-treat-insecure-origin-as-secure
                      </pre>
                      <p className="text-neutral-400 text-[10px]">
                        Enable it, add your LAN URL (e.g. <span className="text-amber-200 font-mono">http://172.16.72.57:3000</span>), and tap Relaunch. Chrome will allow location on LAN HTTP!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Guidance for PERMISSION_DENIED */}
              {gpsStatus === 'PERMISSION_DENIED' && (
                <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 space-y-2 text-[11px]">
                  <div className="font-bold text-white flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-amber-400" />
                    <span>How to Unblock Location in Mobile Settings</span>
                  </div>
                  <ul className="list-disc list-inside text-neutral-400 space-y-1 pl-1">
                    <li><strong className="text-neutral-200">Chrome Android:</strong> Tap the lock or tune icon in the address bar &rarr; Permissions &rarr; Location &rarr; Allow.</li>
                    <li><strong className="text-neutral-200">iOS Safari:</strong> Tap the "aA" icon in address bar &rarr; Website Settings &rarr; Location &rarr; Allow.</li>
                    <li><strong className="text-neutral-200">Device Settings:</strong> Ensure Android Location or iOS Location Services are switched ON.</li>
                  </ul>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="px-5 py-3.5 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onRequestLocationAccess();
                  setShowModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold font-mono flex items-center gap-2 transition-all active:scale-95 shadow"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Location Fix</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
