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

      // Start view centered on player GPS or configured play zone
      const hasValidZoneCenter = playZone.centerLat && playZone.centerLat !== 0;
      const initialLat = myLocation ? myLocation.latitude : (hasValidZoneCenter ? playZone.centerLat : 20.5937);
      const initialLng = myLocation ? myLocation.longitude : (hasValidZoneCenter ? playZone.centerLng : 78.9629);

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

    // Render Tactical Bases (Server-randomized or host-selected)
    if (playZone.bases && playZone.bases.length > 0) {
      for (const base of playZone.bases) {
        const baseHtml = `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
            <div style="width: 16px; height: 16px; border-radius: 9999px; background-color: #4CC38A; border: 2.5px solid #ffffff; box-shadow: 0 0 10px #4CC38A; display: flex; align-items: center; justify-content: center;">
              <div style="width: 6px; height: 6px; border-radius: 9999px; background-color: #0F1923;"></div>
            </div>
            <div style="background-color: rgba(15, 23, 42, 0.95); border: 1px solid #4CC38A; border-radius: 4px; padding: 1px 5px; font-size: 8px; font-weight: 800; color: #4CC38A; white-space: nowrap; margin-top: 2px; pointer-events: none;">
              [BASE] ${base.label}
            </div>
          </div>
        `;
        const baseIcon = L.divIcon({
          className: 'tactical-base-marker',
          html: baseHtml,
          iconSize: [28, 28],
          iconAnchor: [14, 8],
        });
        L.marker([base.lat, base.lng], { icon: baseIcon }).addTo(zoneLayerRef.current);
      }
    }

    // Render Excluded / Restricted Areas within the play zone
    if (playZone.excludedAreas && playZone.excludedAreas.length > 0) {
      for (const ex of playZone.excludedAreas) {
        const exclOptions: L.PathOptions = {
          color: '#ef4444',
          weight: 2,
          fillColor: '#ef4444',
          fillOpacity: 0.35,
          dashArray: '6, 6',
        };

        let exclLayer: L.Layer;
        if (ex.shapeType === 'POLYGON' && ex.vertices && ex.vertices.length >= 3) {
          exclLayer = L.polygon(
            ex.vertices.map((v) => [v.lat, v.lng]),
            exclOptions
          );
        } else {
          exclLayer = L.circle(
            [ex.centerLat, ex.centerLng],
            { radius: ex.radiusMeters || 100, ...exclOptions }
          );
        }

        exclLayer.bindTooltip(`[RESTRICTED] ${ex.name}`, {
          permanent: false,
          direction: 'center',
          className: 'tactical-exclusion-tooltip font-mono text-[9px] font-bold text-red-400 bg-black/80 border border-red-500 rounded px-1.5 py-0.5',
        });
        exclLayer.addTo(zoneLayerRef.current);
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

      // Accuracy radius buffer (distinct from boundary with fine dashed stroke)
      L.circle(myLatLng, {
        radius: Math.max(myLocation.accuracy, 3),
        color: playerAccentColor,
        weight: 1.2,
        dashArray: '3, 4',
        fillColor: playerAccentColor,
        fillOpacity: 0.12,
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

      {/* Tile loading error alert */}
      {tileError && (
        <div className="absolute top-20 left-4 right-4 z-[400] bg-neutral-900/95 border border-red-500/70 p-2.5 rounded-xl text-xs text-red-300 flex items-center justify-between shadow-xl">
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

      {/* Floating Tactical Controls Dock (Zoom & Recenter) */}
      <div className="absolute bottom-36 sm:bottom-32 right-3 sm:right-4 z-[400] flex flex-col gap-2 pointer-events-auto">
        <button
          onClick={handleRecenter}
          aria-label="Recenter Map"
          className="w-11 h-11 bg-[#1F2731]/95 hover:bg-[#293440] border border-[#3B4652] text-white rounded-2xl shadow-xl flex items-center justify-center text-sm font-bold active:scale-95 transition-all backdrop-blur-md"
          title={myLocation ? "Recenter on My GPS Location" : "Center on Play Zone Preview"}
        >
          <Navigation className="w-5 h-5 text-[#4CC38A]" />
        </button>
        <button
          onClick={() => handleZoom(1)}
          aria-label="Zoom In"
          className="w-11 h-11 bg-[#1F2731]/95 hover:bg-[#293440] border border-[#3B4652] text-white rounded-2xl shadow-xl flex items-center justify-center font-bold active:scale-95 transition-all backdrop-blur-md"
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          onClick={() => handleZoom(-1)}
          aria-label="Zoom Out"
          className="w-11 h-11 bg-[#1F2731]/95 hover:bg-[#293440] border border-[#3B4652] text-white rounded-2xl shadow-xl flex items-center justify-center font-bold active:scale-95 transition-all backdrop-blur-md"
        >
          <Minus className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
