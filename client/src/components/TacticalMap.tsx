'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import {
  Navigation,
  Plus,
  Minus,
  Compass,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  X,
  Crosshair,
  Map,
} from 'lucide-react';
import { PlayZone, PlayerLocation, PlayerMember, DynamicZoneState, DynamicZoneConfig, ActiveMission } from '../types/game';
import { ExtendedGpsStatus } from '../hooks/useGeolocation';

interface TacticalMapProps {
  playZone: PlayZone;
  myLocation: PlayerLocation | null;
  myRole: string;
  members: Record<string, PlayerMember>;
  myPlayerId: string;
  gpsStatus?: ExtendedGpsStatus;
  gpsErrorMessage?: string | null;
  isGpsStale?: boolean;
  dynamicZoneState?: DynamicZoneState;
  dynamicZoneConfig?: DynamicZoneConfig;
  chaserPings?: Array<{
    playerId: string;
    nickname: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    ageSeconds: number;
  }>;
  activeMission?: ActiveMission | null;
}

export default function TacticalMap({
  playZone,
  myLocation,
  myRole,
  members,
  myPlayerId,
  gpsStatus = 'WAITING_FOR_PERMISSION',
  gpsErrorMessage = null,
  isGpsStale = false,
  dynamicZoneState,
  dynamicZoneConfig,
  chaserPings = [],
  activeMission,
}: TacticalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const zoneCircleRef = useRef<L.Circle | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const hasAutoCenteredRef = useRef<boolean>(false);

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

      // Start view centered on configured play zone preview
      const initialLat = myLocation ? myLocation.latitude : playZone.centerLat;
      const initialLng = myLocation ? myLocation.longitude : playZone.centerLng;

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true,
        maxZoom: 19,
        minZoom: 12,
      }).setView([initialLat, initialLng], 16);

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

      if (myLocation) {
        hasAutoCenteredRef.current = true;
      }
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Auto-center map on player when actual GPS fix is first acquired
  useEffect(() => {
    if (myLocation && mapInstanceRef.current && !hasAutoCenteredRef.current) {
      mapInstanceRef.current.setView([myLocation.latitude, myLocation.longitude], 17, {
        animate: true,
      });
      hasAutoCenteredRef.current = true;
    }
  }, [myLocation]);

  // Update Play Zone boundary (Circle, Rectangle, or Polygon) and strategic markers
  const zoneLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (!zoneLayerRef.current) {
      zoneLayerRef.current = L.layerGroup().addTo(mapInstanceRef.current);
    }
    zoneLayerRef.current.clearLayers();

    const shape = playZone.shapeType || 'CIRCLE';
    const isDynamic = !!dynamicZoneState;
    const currentR = dynamicZoneState?.currentRadiusMeters || playZone.radiusMeters;

    const boundaryOptions: L.PathOptions = {
      color: isDynamic ? '#FF4655' : '#FF4655',
      weight: 3,
      fillColor: '#FF4655',
      fillOpacity: 0.12,
      dashArray: '8, 8',
    };

    if (shape === 'RECTANGLE' && playZone.northEast && playZone.southWest && !isDynamic) {
      L.rectangle(
        [
          [playZone.southWest.lat, playZone.southWest.lng],
          [playZone.northEast.lat, playZone.northEast.lng],
        ],
        boundaryOptions
      ).addTo(zoneLayerRef.current);
    } else if (shape === 'POLYGON' && playZone.vertices && playZone.vertices.length >= 3 && !isDynamic) {
      L.polygon(
        playZone.vertices.map((v) => [v.lat, v.lng]),
        boundaryOptions
      ).addTo(zoneLayerRef.current);
    } else {
      // CIRCLE / DYNAMIC ZONE
      // 1. Current Active Safe Zone
      L.circle([playZone.centerLat, playZone.centerLng], {
        radius: currentR,
        ...boundaryOptions,
      }).addTo(zoneLayerRef.current);

      // 2. Upcoming Boundary Preview (when zone is actively shrinking and not at final min)
      if (
        dynamicZoneState &&
        !dynamicZoneState.isFinalZone &&
        dynamicZoneState.nextRadiusMeters < currentR
      ) {
        L.circle([playZone.centerLat, playZone.centerLng], {
          radius: dynamicZoneState.nextRadiusMeters,
          color: '#39BDE8',
          weight: 2,
          dashArray: '6, 6',
          fillColor: '#39BDE8',
          fillOpacity: 0.04,
        }).addTo(zoneLayerRef.current);
      }
    }

    // Render strategic points of interest (markers)
    if (playZone.markers && playZone.markers.length > 0) {
      for (const m of playZone.markers) {
        let badgeColor = '#06b6d4'; // default cyan
        let typeLabel = 'POINT';
        if (m.type === 'START_POINT') {
          badgeColor = '#84cc16';
          typeLabel = 'START';
        } else if (m.type === 'SAFE_ZONE') {
          badgeColor = '#10b981';
          typeLabel = 'SAFE ZONE';
        } else if (m.type === 'MEETING_POINT') {
          badgeColor = '#f59e0b';
          typeLabel = 'MEETING';
        } else {
          badgeColor = '#a855f7';
          typeLabel = 'CUSTOM';
        }

        const markerHtml = `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
            <div style="width: 14px; height: 14px; border-radius: 9999px; background-color: ${badgeColor}; border: 2px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.6);"></div>
            <div style="background-color: rgba(15, 23, 42, 0.95); border: 1px solid ${badgeColor}; border-radius: 4px; padding: 1px 5px; font-size: 8px; font-weight: 800; color: #ffffff; white-space: nowrap; margin-top: 2px; pointer-events: none;">
              [${typeLabel}] ${m.label}
            </div>
          </div>
        `;

        const markerIcon = L.divIcon({
          className: 'tactical-poi-marker',
          html: markerHtml,
          iconSize: [24, 24],
          iconAnchor: [12, 7],
        });

        L.marker([m.lat, m.lng], { icon: markerIcon }).addTo(zoneLayerRef.current);
      }
    }
  }, [playZone]);

  // Update markers (Current player, accuracy buffer, teammates, and chaser radar pings)
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    markersLayerRef.current.clearLayers();
    const myMember = members[myPlayerId];
    const isRunner = myMember?.team === 'RUNNERS' || myRole === 'RUNNER';
    const isChaser = myMember?.team === 'CHASERS' || myRole === 'CHASER' || myRole === 'REFEREE';
    const playerAccentColor = isRunner ? '#39BDE8' : '#FF4655';

    // 1. Current Player Marker & Accuracy Circle (ONLY if real GPS location is acquired)
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
      setLastUpdateText(`${timeStr} (±${myLocation.accuracy}m)`);
    }

    // 2. Teammate Markers (Filtered by Server Authorization)
    const myTeam = myMember?.team;

    if (myTeam && myTeam !== 'NONE') {
      for (const m of Object.values(members)) {
        if (m.id === myPlayerId || !m.lastLocation) continue;

        // God-mode referee sees all; teammates see teammates
        const canSee = myRole === 'REFEREE' || m.team === myTeam;
        if (canSee) {
          const color = m.team === 'RUNNERS' ? '#06b6d4' : '#ef4444';
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

    // 3. Chaser Radar Pings (Periodic snapshots of runners delivered only to Chasers)
    if (isChaser) {
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

    // 4. Active Runner Mission Objective Waypoints / Checkpoints
    if (activeMission && (isRunner || myRole === 'REFEREE')) {
      if (activeMission.targetLocation) {
        const targetLat = activeMission.targetLocation.latitude ?? activeMission.targetLocation.lat;
        const targetLng = activeMission.targetLocation.longitude ?? activeMission.targetLocation.lng;
        const targetRadius = activeMission.targetRadiusMeters || 25;
        L.circle([targetLat, targetLng], {
          radius: targetRadius,
          color: '#FFB800',
          weight: 2,
          dashArray: '4, 4',
          fillColor: '#FFB800',
          fillOpacity: 0.2,
        }).addTo(markersLayerRef.current);

        const missionHtml = `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
            <div style="width: 18px; height: 18px; border-radius: 9999px; background-color: #FFB800; border: 2.5px solid #ffffff; box-shadow: 0 0 12px #FFB800; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900; color: #000000;">
              ★
            </div>
            <div style="background-color: rgba(15, 23, 42, 0.95); border: 1px solid #FFB800; border-radius: 4px; padding: 1px 5px; font-size: 8px; font-weight: 800; color: #FFB800; white-space: nowrap; margin-top: 2px; pointer-events: none;">
              [MISSION] ${activeMission.title}
            </div>
          </div>
        `;

        const missionIcon = L.divIcon({
          className: 'mission-objective-marker',
          html: missionHtml,
          iconSize: [26, 26],
          iconAnchor: [13, 9],
        });

        L.marker([targetLat, targetLng], {
          icon: missionIcon,
          zIndexOffset: 900,
        }).addTo(markersLayerRef.current);
      }

      if (activeMission.checkpoints && activeMission.checkpoints.length > 0) {
        const activeIdx = activeMission.currentCheckpointIndex || 0;
        activeMission.checkpoints.forEach((cp, idx) => {
          const isCurrent = idx === activeIdx;
          const isDone = idx < activeIdx;
          const color = isDone ? '#4CC38A' : isCurrent ? '#FFB800' : '#64748B';

          L.circle([cp.latitude, cp.longitude], {
            radius: cp.radiusMeters || 20,
            color,
            weight: isCurrent ? 2 : 1,
            dashArray: isCurrent ? '3, 3' : undefined,
            fillColor: color,
            fillOpacity: isCurrent ? 0.25 : 0.1,
          }).addTo(markersLayerRef.current!);

          const cpHtml = `
            <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
              <div style="width: 16px; height: 16px; border-radius: 9999px; background-color: ${color}; border: 2px solid #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 900; color: #000000;">
                ${idx + 1}
              </div>
              <div style="background-color: rgba(15, 23, 42, 0.95); border: 1px solid ${color}; border-radius: 4px; padding: 1px 4px; font-size: 8px; font-weight: 800; color: ${color}; white-space: nowrap; margin-top: 2px; pointer-events: none;">
                CP ${idx + 1}${isCurrent ? ' (ACTIVE)' : isDone ? ' (DONE)' : ''}
              </div>
            </div>
          `;

          const cpIcon = L.divIcon({
            className: 'checkpoint-marker',
            html: cpHtml,
            iconSize: [22, 22],
            iconAnchor: [11, 8],
          });

          L.marker([cp.latitude, cp.longitude], { icon: cpIcon }).addTo(markersLayerRef.current!);
        });
      }
    }
  }, [myLocation, myRole, members, myPlayerId, chaserPings, activeMission]);

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

      {/* Map Preview Indicator (Rendered when real GPS location is not yet acquired) */}
      {!myLocation && (
        <div className="absolute top-16 right-4 z-[400] pointer-events-none">
          <div className="bg-neutral-900/90 border border-amber-500/70 text-amber-300 px-3 py-1.5 rounded-xl text-[10px] font-mono font-bold shadow-lg flex items-center gap-1.5 backdrop-blur-md">
            <Compass className="w-3.5 h-3.5 text-amber-400" />
            <span>PREVIEWING PLAY ZONE (NOT YOUR LOCATION)</span>
          </div>
        </div>
      )}

      {/* GPS Status & Position Floating Pill */}
      <div className="absolute top-16 left-4 z-[400] pointer-events-none max-w-xs">
        <div className="bg-surface-elevated/95 backdrop-blur-md border border-neutral-700/80 px-3 py-1.5 rounded-xl shadow-lg flex items-center gap-2 text-[10px] font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              myLocation
                ? isGpsStale
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400'
                : gpsStatus === 'PERMISSION_DENIED'
                ? 'bg-red-500'
                : gpsStatus === 'ACQUIRING_FIX'
                ? 'bg-cyan-400 animate-ping'
                : 'bg-amber-400 animate-pulse'
            }`}
          />
          <span className="text-neutral-200 font-bold truncate">
            {myLocation
              ? isGpsStale
                ? `GPS STALE (>45s): Lat ${myLocation.latitude.toFixed(5)}, Lng ${myLocation.longitude.toFixed(5)}`
                : `GPS LOCKED: Lat ${myLocation.latitude.toFixed(5)}, Lng ${myLocation.longitude.toFixed(5)} (±${myLocation.accuracy}m)`
              : gpsStatus === 'WAITING_FOR_PERMISSION'
              ? 'GPS: WAITING FOR PERMISSION'
              : gpsStatus === 'ACQUIRING_FIX'
              ? 'GPS: ACQUIRING HARDWARE FIX...'
              : gpsStatus === 'PERMISSION_DENIED'
              ? 'GPS: PERMISSION BLOCKED'
              : gpsStatus === 'TIMEOUT'
              ? 'GPS: REQUEST TIMED OUT'
              : 'GPS: POSITION UNAVAILABLE'}
          </span>
        </div>
      </div>

      {/* Explicit Geolocation State Banner (Shows real error or helpful guidance) */}
      {!myLocation && (
        <div className="absolute top-28 left-4 right-4 z-[400] bg-surface-elevated/95 border border-neutral-700 p-3.5 rounded-2xl shadow-xl backdrop-blur-md text-xs">
          {gpsStatus === 'WAITING_FOR_PERMISSION' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <Navigation className="w-4 h-4" />
                <span>Waiting for Browser Location Permission</span>
              </div>
              <p className="text-[11px] text-neutral-300 leading-relaxed">
                Please tap <strong>&ldquo;Allow&rdquo;</strong> on your browser&apos;s location prompt to enable outdoor GPS pursuit tracking.
              </p>
            </div>
          )}

          {gpsStatus === 'ACQUIRING_FIX' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-cyan-400 font-bold">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Permission Granted — Acquiring GPS Satellite Fix</span>
              </div>
              <p className="text-[11px] text-neutral-300 leading-relaxed">
                Device GPS is active and calculating coordinates. Stand near a window or outdoors with Wi-Fi / location services enabled.
              </p>
            </div>
          )}

          {gpsStatus === 'PERMISSION_DENIED' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-red-400 font-bold">
                <AlertCircle className="w-4 h-4" />
                <span>Location Permission Denied (Code 1)</span>
              </div>
              <p className="text-[11px] text-neutral-300 leading-relaxed">
                {gpsErrorMessage || 'Location access is blocked. Click the lock/settings icon in your browser address bar and enable Location for this site.'}
              </p>
            </div>
          )}

          {(gpsStatus === 'POSITION_UNAVAILABLE' || gpsStatus === 'TIMEOUT' || gpsStatus === 'UNSUPPORTED') && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <AlertTriangle className="w-4 h-4" />
                <span>GPS Error: {gpsStatus}</span>
              </div>
              <p className="text-[11px] text-neutral-300 leading-relaxed">
                {gpsErrorMessage || 'Position calculation timed out or device sensors are unavailable.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Stale GPS Banner */}
      {isGpsStale && myLocation && (
        <div className="absolute top-28 left-4 right-4 z-[400] bg-surface-elevated/95 border border-amber-500/70 p-3.5 rounded-2xl shadow-xl backdrop-blur-md text-xs">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <AlertTriangle className="w-4 h-4" />
            <span>Stale GPS Fix (&gt;45s old)</span>
          </div>
          <p className="text-[11px] text-neutral-300 mt-1 leading-relaxed">
            Your location has not refreshed recently. Check device battery saver settings and ensure clear view of the sky.
          </p>
        </div>
      )}

      {/* Tile loading error alert */}
      {tileError && (
        <div className="absolute bottom-28 left-4 right-4 z-[400] bg-neutral-900/95 border border-red-500/70 p-2.5 rounded-xl text-xs text-red-300 flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>OpenStreetMap tile network slow or offline. Cached tiles will display.</span>
          </div>
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
          className="w-11 h-11 bg-surface-elevated/95 hover:bg-neutral-800 border border-neutral-700 text-neutral-100 rounded-2xl shadow-lg flex items-center justify-center text-sm font-bold active:scale-95 transition-all"
          title={myLocation ? "Recenter on My GPS Location" : "Center on Play Zone Preview"}
        >
          <Navigation className="w-5 h-5 text-tactical-lime" />
        </button>
        <button
          onClick={() => handleZoom(1)}
          aria-label="Zoom In"
          className="w-11 h-11 bg-surface-elevated/95 hover:bg-neutral-800 border border-neutral-700 text-neutral-100 rounded-2xl shadow-lg flex items-center justify-center font-bold active:scale-95 transition-all"
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          onClick={() => handleZoom(-1)}
          aria-label="Zoom Out"
          className="w-11 h-11 bg-surface-elevated/95 hover:bg-neutral-800 border border-neutral-700 text-neutral-100 rounded-2xl shadow-lg flex items-center justify-center font-bold active:scale-95 transition-all"
        >
          <Minus className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
