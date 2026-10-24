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
  const [activeTab, setActiveTab] = useState<'roster' | 'settings'>('roster');

  const myMember = roomState.members[myPlayerId];
  const isHost = roomState.hostId === myPlayerId;

  const runners = Object.values(roomState.members).filter((m) => m.team === 'RUNNERS');
  const chasers = Object.values(roomState.members).filter((m) => m.team === 'CHASERS');
  const unassigned = Object.values(roomState.members).filter(
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

  const handleSetIndividualHeadStart = (targetRunnerId: string, seconds: number) => {
    const current = roomState.config.individualHeadStarts || {};
    onUpdateConfig({
      individualHeadStarts: {
        ...current,
        [targetRunnerId]: seconds,
      },
    });
  };

  return (
    <div className="flex flex-col gap-5 p-4 max-w-md mx-auto pb-28 select-none">
      {/* Header Room Code Card */}
      <div className="bg-surface border border-neutral-800 rounded-3xl p-5 text-center shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-tactical-chaser via-tactical-runner to-tactical-radio" />
        <span className="text-[10px] uppercase tracking-widest text-neutral-400 font-bold block mb-1">
          Tactical Pursuit Room
        </span>
        <div className="text-4xl font-black font-mono tracking-widest text-tactical-chaser my-1.5">
          {roomState.roomCode}
        </div>
        <button
          onClick={handleCopyLink}
          className="text-xs font-semibold text-neutral-300 bg-surface-elevated hover:bg-neutral-800 px-4 py-2 rounded-xl border border-neutral-700 active:scale-95 transition-all inline-flex items-center gap-1.5 shadow"
        >
          {copied ? '✓ Link Copied to Clipboard' : '🔗 Copy Shareable Invite Link'}
        </button>
      </div>

      {/* Navigation Tab Bar for Host */}
      {isHost && (
        <div className="flex bg-surface-elevated/70 border border-neutral-800 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab('roster')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'roster'
                ? 'bg-neutral-800 text-white shadow'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            👥 Operatives ({Object.keys(roomState.members).length})
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'settings'
                ? 'bg-neutral-800 text-white shadow'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            ⚙️ Match Rules
          </button>
        </div>
      )}

      {/* Tab Content: Settings */}
      {isHost && activeTab === 'settings' && (
        <div className="bg-surface border border-neutral-800 rounded-3xl p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-300">
              Host Match Parameters
            </h3>
            {myLocation && (
              <button
                onClick={handleSetCenterToGps}
                className="text-[10px] font-bold bg-tactical-chaser/20 text-tactical-chaser hover:bg-tactical-chaser/30 border border-tactical-chaser/40 px-2.5 py-1 rounded-lg transition-all"
              >
                📍 Center on My GPS
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                Duration
              </label>
              <select
                value={roomState.config.durationSeconds}
                onChange={(e) =>
                  onUpdateConfig({ durationSeconds: parseInt(e.target.value, 10) })
                }
                className="w-full bg-surface-elevated border border-neutral-700 rounded-xl px-2.5 py-2 text-neutral-200 text-xs focus:outline-none"
              >
                <option value={600}>10 Minutes</option>
                <option value={900}>15 Minutes</option>
                <option value={1200}>20 Minutes</option>
                <option value={1800}>30 Minutes</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                Default Head Start
              </label>
              <select
                value={roomState.config.globalHeadStartSeconds}
                onChange={(e) =>
                  onUpdateConfig({
                    globalHeadStartSeconds: parseInt(e.target.value, 10),
                  })
                }
                className="w-full bg-surface-elevated border border-neutral-700 rounded-xl px-2.5 py-2 text-neutral-200 text-xs focus:outline-none"
              >
                <option value={60}>1 Minute</option>
                <option value={120}>2 Minutes</option>
                <option value={180}>3 Minutes</option>
                <option value={300}>5 Minutes</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                Radar Ping Interval
              </label>
              <select
                value={roomState.config.pingIntervalSeconds}
                onChange={(e) =>
                  onUpdateConfig({
                    pingIntervalSeconds: parseInt(e.target.value, 10),
                  })
                }
                className="w-full bg-surface-elevated border border-neutral-700 rounded-xl px-2.5 py-2 text-neutral-200 text-xs focus:outline-none"
              >
                <option value={30}>Every 30s</option>
                <option value={45}>Every 45s</option>
                <option value={60}>Every 60s</option>
                <option value={90}>Every 90s</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                Zone Radius
              </label>
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
                className="w-full bg-surface-elevated border border-neutral-700 rounded-xl px-2.5 py-2 text-neutral-200 text-xs focus:outline-none"
              >
                <option value={200}>200m (Park)</option>
                <option value={500}>500m (Campus)</option>
                <option value={1000}>1km (District)</option>
                <option value={2000}>2km (Wide Area)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content: Roster */}
      {(!isHost || activeTab === 'roster') && (
        <div className="space-y-4">
          {/* Runners Card */}
          <div className="bg-surface border border-neutral-800 rounded-3xl p-4 shadow-lg space-y-2.5">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-tactical-runner" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-neutral-200">
                  Runners ({runners.length})
                </h3>
              </div>
              <span className="text-[10px] text-neutral-400 font-medium">Evade & Hide</span>
            </div>

            {runners.length === 0 ? (
              <p className="text-xs text-neutral-500 italic py-2">No runners assigned yet.</p>
            ) : (
              runners.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-col gap-1.5 p-2.5 rounded-2xl bg-surface-elevated/70 border border-neutral-800"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-200">
                        {m.nickname} {m.id === myPlayerId && '(You)'}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-black tracking-wider ${
                          m.isReady
                            ? 'bg-tactical-runner/20 text-tactical-runner'
                            : 'bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {m.isReady ? 'READY' : 'WAITING'}
                      </span>
                    </div>

                    {isHost && (
                      <select
                        value={m.role}
                        onChange={(e) => onSetRole(m.id, e.target.value as PlayerRole)}
                        className="text-[10px] bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-neutral-300 focus:outline-none"
                      >
                        <option value="RUNNER">Runner</option>
                        <option value="CHASER">Chaser</option>
                        <option value="REFEREE">Referee</option>
                        <option value="SPECTATOR">Spectator</option>
                      </select>
                    )}
                  </div>

                  {/* Individual Runner Head Start (Host Only) */}
                  {isHost && (
                    <div className="flex items-center justify-between pt-1 border-t border-neutral-800/60 text-[10px]">
                      <span className="text-neutral-400">Custom Head Start:</span>
                      <select
                        value={
                          roomState.config.individualHeadStarts?.[m.id] ??
                          roomState.config.globalHeadStartSeconds
                        }
                        onChange={(e) =>
                          handleSetIndividualHeadStart(m.id, parseInt(e.target.value, 10))
                        }
                        className="bg-neutral-800 text-neutral-300 rounded px-1.5 py-0.5 border border-neutral-700"
                      >
                        <option value={60}>60s</option>
                        <option value={120}>120s</option>
                        <option value={180}>180s</option>
                        <option value={300}>300s</option>
                      </select>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Chasers Card */}
          <div className="bg-surface border border-neutral-800 rounded-3xl p-4 shadow-lg space-y-2.5">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-tactical-chaser" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-neutral-200">
                  Chasers ({chasers.length})
                </h3>
              </div>
              <span className="text-[10px] text-neutral-400 font-medium">Pursue & Tag</span>
            </div>

            {chasers.length === 0 ? (
              <p className="text-xs text-neutral-500 italic py-2">No chasers assigned yet.</p>
            ) : (
              chasers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-2.5 rounded-2xl bg-surface-elevated/70 border border-neutral-800"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-neutral-200">
                      {m.nickname} {m.id === myPlayerId && '(You)'}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-black tracking-wider ${
                        m.isReady
                          ? 'bg-tactical-chaser/20 text-tactical-chaser'
                          : 'bg-neutral-800 text-neutral-400'
                      }`}
                    >
                      {m.isReady ? 'READY' : 'WAITING'}
                    </span>
                  </div>

                  {isHost && (
                    <select
                      value={m.role}
                      onChange={(e) => onSetRole(m.id, e.target.value as PlayerRole)}
                      className="text-[10px] bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-neutral-300 focus:outline-none"
                    >
                      <option value="CHASER">Chaser</option>
                      <option value="RUNNER">Runner</option>
                      <option value="REFEREE">Referee</option>
                      <option value="SPECTATOR">Spectator</option>
                    </select>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Fixed Sticky Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-md border-t border-neutral-800 flex gap-3 max-w-md mx-auto z-[500]">
        <button
          onClick={() => onToggleReady(!myMember?.isReady)}
          className={`flex-1 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all active:scale-95 border ${
            myMember?.isReady
              ? 'bg-neutral-800 border-neutral-700 text-neutral-400'
              : 'bg-surface-elevated border-tactical-runner text-tactical-runner hover:bg-tactical-runner/10'
          }`}
        >
          {myMember?.isReady ? '✓ Marked Ready' : 'Mark Ready'}
        </button>

        {isHost && (
          <button
            onClick={onStartMatch}
            disabled={!canStart}
            className={`flex-1 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider transition-all active:scale-95 ${
              canStart
                ? 'bg-tactical-chaser text-neutral-950 shadow-tactical-glow hover:brightness-110'
                : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
            }`}
          >
            {canStart ? 'Start Chase ⚡' : 'Need 1v1 Min'}
          </button>
        )}
      </div>
    </div>
  );
}
