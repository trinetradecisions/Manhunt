'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { PlayZone, PlayerLocation, PlayerMember } from '../types/game';

interface TacticalMapProps {
  playZone: PlayZone;
  myLocation: PlayerLocation | null;
  myRole: string;
  members: Record<string, PlayerMember>;
  myPlayerId: string;
  isGpsStale?: boolean;
  chaserPings?: Array<{
    playerId: string;
    nickname: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    ageSeconds: number;
  }>;
}

export default function TacticalMap({
  playZone,
  myLocation,
  myRole,
  members,
  myPlayerId,
  isGpsStale = false,
  chaserPings = [],
}: TacticalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const zoneCircleRef = useRef<L.Circle | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  const [tileError, setTileError] = useState(false);
  const [lastUpdateText, setLastUpdateText] = useState<string>('Searching...');

  // Initialize interactive Leaflet map with OpenStreetMap raster tiles
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // Fix default Leaflet icon assets missing in Next.js bundle
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true,
        maxZoom: 19,
        minZoom: 12,
      }).setView([playZone.centerLat, playZone.centerLng], 16);

      // OpenStreetMap standard tile provider with required attribution
      const osmTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);

      osmTileLayer.on('tileerror', () => {
        console.warn('[TacticalMap] OpenStreetMap tile loading error');
        setTileError(true);
      });

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Play Zone circle boundary
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (zoneCircleRef.current) {
      zoneCircleRef.current.remove();
    }

    const circle = L.circle([playZone.centerLat, playZone.centerLng], {
      radius: playZone.radiusMeters,
      color: '#ef4444',
      weight: 3,
      fillColor: '#ef4444',
      fillOpacity: 0.12,
      dashArray: '8, 8',
    }).addTo(mapInstanceRef.current);

    zoneCircleRef.current = circle;
  }, [playZone.centerLat, playZone.centerLng, playZone.radiusMeters]);

  // Update markers (Current player, accuracy buffer, teammates, and chaser radar pings)
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();
    const isRunner = myRole === 'RUNNER';
    const playerAccentColor = isRunner ? '#10b981' : '#f59e0b';

    // 1. Current Player Marker & Accuracy Circle
    if (myLocation) {
      const myLatLng: L.LatLngTuple = [myLocation.latitude, myLocation.longitude];

      // Accuracy radius buffer
      L.circle(myLatLng, {
        radius: Math.max(myLocation.accuracy, 3),
        color: playerAccentColor,
        weight: 1.5,
        fillColor: playerAccentColor,
        fillOpacity: 0.18,
      }).addTo(markersLayerRef.current);

      // High-contrast custom tactical player pin
      const playerHtml = `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
          <div style="width: 22px; height: 22px; border-radius: 9999px; background-color: ${playerAccentColor}; border: 2.5px solid #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; color: #000000;">
            ${isRunner ? 'R' : 'C'}
          </div>
          <div style="position: absolute; top: -20px; background-color: rgba(15, 23, 42, 0.95); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 4px; padding: 1px 5px; font-size: 9px; font-weight: 800; color: #ffffff; white-space: nowrap; pointer-events: none;">
            YOU (${isRunner ? 'RUNNER' : 'CHASER'})
          </div>
        </div>
      `;

      const playerIcon = L.divIcon({
        className: 'player-marker-div',
        html: playerHtml,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      L.marker(myLatLng, { icon: playerIcon, zIndexOffset: 1000 }).addTo(markersLayerRef.current);

      // Format last update time
      const timeStr = new Date(myLocation.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setLastUpdateText(`${timeStr} (±${Math.round(myLocation.accuracy)}m)`);
    }

    // 2. Teammate Markers (Filtered by Server Authorization)
    const myMember = members[myPlayerId];
    const myTeam = myMember?.team;

    if (myTeam && myTeam !== 'NONE') {
      for (const m of Object.values(members)) {
        if (m.id === myPlayerId || !m.lastLocation) continue;

        // God-mode referee sees all; teammates see teammates
        const canSee = myRole === 'REFEREE' || m.team === myTeam;
        if (canSee) {
          const color = m.team === 'RUNNERS' ? '#10b981' : '#f59e0b';
          const teammateLatLng: L.LatLngTuple = [
            m.lastLocation.latitude,
            m.lastLocation.longitude,
          ];

          const teammateHtml = `
            <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px;">
              <div style="width: 16px; height: 16px; border-radius: 9999px; background-color: ${color}; border: 2px solid #0f172a; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>
              <div style="position: absolute; top: -18px; background-color: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; padding: 1px 4px; font-size: 8px; font-weight: 700; color: #f1f5f9; white-space: nowrap; pointer-events: none;">
                ${m.nickname}
              </div>
            </div>
          `;

          const teammateIcon = L.divIcon({
            className: 'teammate-marker-div',
            html: teammateHtml,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          });

          L.marker(teammateLatLng, { icon: teammateIcon }).addTo(markersLayerRef.current);
        }
      }
    }

    // 3. Chaser Radar Pings (Periodic pings of runners)
    if (myRole === 'CHASER' || myRole === 'REFEREE') {
      for (const ping of chaserPings) {
        const pingLatLng: L.LatLngTuple = [ping.latitude, ping.longitude];

        const pingHtml = `
          <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px;">
            <div style="position: absolute; width: 22px; height: 22px; border-radius: 9999px; background-color: #ef4444; border: 1px solid #ffffff; opacity: 0.75; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="width: 18px; height: 18px; border-radius: 9999px; background-color: #ef4444; border: 2px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900; color: #ffffff;">
              !
            </div>
            <div style="position: absolute; bottom: -18px; background-color: rgba(69, 10, 10, 0.95); border: 1px solid rgba(239, 68, 68, 0.6); border-radius: 4px; padding: 1px 5px; font-size: 8px; font-weight: 800; color: #fecaca; white-space: nowrap; pointer-events: none;">
              PING: ${ping.nickname} (${ping.ageSeconds}s)
            </div>
          </div>
        `;

        const pingIcon = L.divIcon({
          className: 'ping-marker-div',
          html: pingHtml,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

        L.marker(pingLatLng, { icon: pingIcon }).addTo(markersLayerRef.current);
      }
    }
  }, [myLocation, myRole, members, myPlayerId, chaserPings]);

  // Recenter controls
  const handleRecenter = useCallback(() => {
    if (!mapInstanceRef.current) return;

    if (myLocation) {
      mapInstanceRef.current.setView([myLocation.latitude, myLocation.longitude], 17, {
        animate: true,
      });
    } else {
      mapInstanceRef.current.setView([playZone.centerLat, playZone.centerLng], 16, {
        animate: true,
      });
    }
  }, [myLocation, playZone.centerLat, playZone.centerLng]);

  const handleZoom = useCallback((delta: number) => {
    if (!mapInstanceRef.current) return;
    const current = mapInstanceRef.current.getZoom();
    mapInstanceRef.current.setZoom(current + delta);
  }, []);

  return (
    <div className="relative w-full h-full min-h-[350px] overflow-hidden bg-background">
      {/* Real Interactive Leaflet + OpenStreetMap Map */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* GPS Status & Last Update Floating Pill */}
      <div className="absolute top-16 left-4 z-[400] pointer-events-none">
        <div className="bg-surface-elevated/90 backdrop-blur-md border border-neutral-700/80 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2 text-[10px] font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              !myLocation
                ? 'bg-red-500 animate-ping'
                : isGpsStale
                ? 'bg-amber-400 animate-pulse'
                : 'bg-emerald-400'
            }`}
          />
          <span className="text-neutral-300">
            {!myLocation
              ? 'GPS: ACQUIRING LOCK'
              : isGpsStale
              ? 'GPS: STALE SIGNAL'
              : `GPS: ${lastUpdateText}`}
          </span>
        </div>
      </div>

      {/* Warning Banner if No GPS or Stale */}
      {!myLocation && (
        <div className="absolute top-28 left-4 right-4 z-[400] bg-surface-elevated/95 border border-amber-500/70 p-3 rounded-2xl shadow-xl backdrop-blur-md text-xs">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <span>📡</span>
            <span>Waiting for GPS Location</span>
          </div>
          <p className="text-[11px] text-neutral-300 mt-1 leading-relaxed">
            Please allow browser location permissions when prompted to enable live tactical position tracking.
          </p>
        </div>
      )}

      {isGpsStale && myLocation && (
        <div className="absolute top-28 left-4 right-4 z-[400] bg-surface-elevated/95 border border-amber-500/70 p-3 rounded-2xl shadow-xl backdrop-blur-md text-xs">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <span>⚠️</span>
            <span>Stale GPS Fix (&gt;45s old)</span>
          </div>
          <p className="text-[11px] text-neutral-300 mt-1 leading-relaxed">
            Your location has not refreshed recently. Check that your device has a clear view of the sky and mobile data is active.
          </p>
        </div>
      )}

      {/* Tile loading error alert */}
      {tileError && (
        <div className="absolute bottom-28 left-4 right-4 z-[400] bg-neutral-900/95 border border-red-500/70 p-2.5 rounded-xl text-xs text-red-300 flex items-center justify-between shadow-xl">
          <span>⚠️ OpenStreetMap tile network slow or offline. Cached tiles will display.</span>
          <button
            onClick={() => setTileError(false)}
            className="text-[10px] text-neutral-400 hover:text-white px-2 py-0.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Floating Tactical Controls Dock */}
      <div className="absolute bottom-20 right-4 z-[450] flex flex-col gap-2 pointer-events-auto">
        <button
          onClick={handleRecenter}
          aria-label="Recenter Map"
          className="w-10 h-10 bg-surface-elevated/90 hover:bg-neutral-800 border border-neutral-700 text-neutral-100 rounded-xl shadow-lg flex items-center justify-center text-sm font-bold active:scale-95 transition-all"
        >
          📍
        </button>
        <button
          onClick={() => handleZoom(1)}
          aria-label="Zoom In"
          className="w-10 h-10 bg-surface-elevated/90 hover:bg-neutral-800 border border-neutral-700 text-neutral-100 rounded-xl shadow-lg flex items-center justify-center text-base font-bold active:scale-95 transition-all"
        >
          +
        </button>
        <button
          onClick={() => handleZoom(-1)}
          aria-label="Zoom Out"
          className="w-10 h-10 bg-surface-elevated/90 hover:bg-neutral-800 border border-neutral-700 text-neutral-100 rounded-xl shadow-lg flex items-center justify-center text-base font-bold active:scale-95 transition-all"
        >
          −
        </button>
      </div>
    </div>
  );
}
