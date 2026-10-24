'use client';

import { useState } from 'react';
import { RoomState, PlayerRole, PlayerLocation } from '../types/game';

interface LobbyViewProps {
  roomState: RoomState;
  myPlayerId: string;
  myLocation: PlayerLocation | null;
  onUpdateConfig: (config: any) => void;
  onSetRole: (targetPlayerId: string, role: PlayerRole) => void;
  onToggleReady: (ready: boolean) => void;
  onStartMatch: () => void;
}

export default function LobbyView({
  roomState,
  myPlayerId,
  myLocation,
  onUpdateConfig,
  onSetRole,
  onToggleReady,
  onStartMatch,
}: LobbyViewProps) {
  const [copied, setCopied] = useState(false);
  const myMember = roomState.members[myPlayerId];
  const isHost = roomState.hostId === myPlayerId;

  const runners = Object.values(roomState.members).filter((m) => m.team === 'RUNNERS');
  const chasers = Object.values(roomState.members).filter((m) => m.team === 'CHASERS');
  const spectators = Object.values(roomState.members).filter(
    (m) => m.team === 'NONE' && m.role !== 'HOST'
  );

  const canStart = runners.length >= 1 && chasers.length >= 1;

  const handleCopyLink = () => {
    const url = window.location.origin + `?room=${roomState.roomCode}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSetCenterToGps = () => {
    if (myLocation) {
      onUpdateConfig({
        playZone: {
          ...roomState.config.playZone,
          centerLat: myLocation.latitude,
          centerLng: myLocation.longitude,
        },
      });
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 max-w-lg mx-auto pb-24">
      {/* Room Code Card */}
      <div className="bg-surface border border-neutral-800 rounded-2xl p-5 text-center shadow-xl">
        <span className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">
          Game Room Code
        </span>
        <div className="text-4xl font-black font-mono tracking-widest text-tactical-chaser my-2">
          {roomState.roomCode}
        </div>
        <button
          onClick={handleCopyLink}
          className="text-xs text-neutral-300 bg-surface-elevated hover:bg-neutral-700 px-4 py-2 rounded-full border border-neutral-700 active:scale-95 transition-all inline-flex items-center gap-1.5"
        >
          {copied ? '✓ Invite Link Copied' : '🔗 Copy Shareable Invite Link'}
        </button>
      </div>

      {/* Host Match Configuration Panel */}
      {isHost && (
        <div className="bg-surface border border-neutral-800 rounded-2xl p-5 space-y-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-200">
              ⚙️ Match Rules (Host)
            </h2>
            {myLocation && (
              <button
                onClick={handleSetCenterToGps}
                className="text-[11px] bg-tactical-chaser/20 text-tactical-chaser hover:bg-tactical-chaser/30 border border-tactical-chaser/40 px-2.5 py-1 rounded-lg"
              >
                📍 Center on My GPS
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-neutral-400 block mb-1">Duration</label>
              <select
                value={roomState.config.durationSeconds}
                onChange={(e) =>
                  onUpdateConfig({ durationSeconds: parseInt(e.target.value, 10) })
                }
                className="w-full bg-surface-elevated border border-neutral-700 rounded-lg px-2.5 py-2 text-neutral-200"
              >
                <option value={600}>10 Minutes</option>
                <option value={900}>15 Minutes</option>
                <option value={1200}>20 Minutes</option>
                <option value={1800}>30 Minutes</option>
              </select>
            </div>

            <div>
              <label className="text-neutral-400 block mb-1">Head Start</label>
              <select
                value={roomState.config.globalHeadStartSeconds}
                onChange={(e) =>
                  onUpdateConfig({
                    globalHeadStartSeconds: parseInt(e.target.value, 10),
                  })
                }
                className="w-full bg-surface-elevated border border-neutral-700 rounded-lg px-2.5 py-2 text-neutral-200"
              >
                <option value={60}>1 Minute</option>
                <option value={120}>2 Minutes</option>
                <option value={180}>3 Minutes</option>
                <option value={300}>5 Minutes</option>
              </select>
            </div>

            <div>
              <label className="text-neutral-400 block mb-1">Radar Ping</label>
              <select
                value={roomState.config.pingIntervalSeconds}
                onChange={(e) =>
                  onUpdateConfig({
                    pingIntervalSeconds: parseInt(e.target.value, 10),
                  })
                }
                className="w-full bg-surface-elevated border border-neutral-700 rounded-lg px-2.5 py-2 text-neutral-200"
              >
                <option value={30}>Every 30s</option>
                <option value={45}>Every 45s</option>
                <option value={60}>Every 60s</option>
                <option value={90}>Every 90s</option>
              </select>
            </div>

            <div>
              <label className="text-neutral-400 block mb-1">Zone Radius</label>
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
                className="w-full bg-surface-elevated border border-neutral-700 rounded-lg px-2.5 py-2 text-neutral-200"
              >
                <option value={200}>200 Meters</option>
                <option value={500}>500 Meters</option>
                <option value={1000}>1 Kilometer</option>
                <option value={2000}>2 Kilometers</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Team Rosters */}
      <div className="space-y-4">
        {/* Runners List */}
        <div className="bg-surface border border-neutral-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-tactical-runner" />
              <h3 className="font-bold text-sm text-neutral-200 uppercase tracking-wide">
                Runners ({runners.length})
              </h3>
            </div>
            <span className="text-[11px] text-neutral-400">Evade & Scatter</span>
          </div>

          <div className="space-y-2">
            {runners.length === 0 ? (
              <p className="text-xs text-neutral-500 italic py-2">No runners assigned yet.</p>
            ) : (
              runners.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between bg-surface-elevated/60 px-3 py-2 rounded-xl border border-neutral-800"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-200">
                      {m.nickname} {m.id === myPlayerId && '(You)'}
                    </span>
                    {m.isReady && (
                      <span className="text-[10px] bg-tactical-runner/20 text-tactical-runner px-1.5 py-0.5 rounded font-bold">
                        READY
                      </span>
                    )}
                  </div>
                  {isHost && (
                    <select
                      value={m.role}
                      onChange={(e) => onSetRole(m.id, e.target.value as PlayerRole)}
                      className="text-[11px] bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-neutral-300"
                    >
                      <option value="RUNNER">Runner</option>
                      <option value="CHASER">Chaser</option>
                      <option value="REFEREE">Referee</option>
                    </select>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chasers List */}
        <div className="bg-surface border border-neutral-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-tactical-chaser" />
              <h3 className="font-bold text-sm text-neutral-200 uppercase tracking-wide">
                Chasers ({chasers.length})
              </h3>
            </div>
            <span className="text-[11px] text-neutral-400">Hunt & Tag</span>
          </div>

          <div className="space-y-2">
            {chasers.length === 0 ? (
              <p className="text-xs text-neutral-500 italic py-2">No chasers assigned yet.</p>
            ) : (
              chasers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between bg-surface-elevated/60 px-3 py-2 rounded-xl border border-neutral-800"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-200">
                      {m.nickname} {m.id === myPlayerId && '(You)'}
                    </span>
                    {m.isReady && (
                      <span className="text-[10px] bg-tactical-chaser/20 text-tactical-chaser px-1.5 py-0.5 rounded font-bold">
                        READY
                      </span>
                    )}
                  </div>
                  {isHost && (
                    <select
                      value={m.role}
                      onChange={(e) => onSetRole(m.id, e.target.value as PlayerRole)}
                      className="text-[11px] bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-neutral-300"
                    >
                      <option value="RUNNER">Runner</option>
                      <option value="CHASER">Chaser</option>
                      <option value="REFEREE">Referee</option>
                    </select>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-md border-t border-neutral-800 flex gap-3 max-w-lg mx-auto z-[500]">
        <button
          onClick={() => onToggleReady(!myMember?.isReady)}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 border ${
            myMember?.isReady
              ? 'bg-neutral-800 border-neutral-700 text-neutral-400'
              : 'bg-surface-elevated border-tactical-runner text-tactical-runner hover:bg-tactical-runner/10'
          }`}
        >
          {myMember?.isReady ? '✓ Ready' : 'Mark Ready'}
        </button>

        {isHost && (
          <button
            onClick={onStartMatch}
            disabled={!canStart}
            className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 ${
              canStart
                ? 'bg-tactical-chaser text-neutral-900 shadow-tactical-glow hover:brightness-110'
                : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
            }`}
          >
            Start Chase ⚡
          </button>
        )}
      </div>
    </div>
  );
}
