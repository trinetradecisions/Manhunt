'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { PlayZone, PlayerLocation, PlayerMember } from '../types/game';

interface TacticalMapProps {
  playZone: PlayZone;
  myLocation: PlayerLocation | null;
  myRole: string;
  members: Record<string, PlayerMember>;
  myPlayerId: string;
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
  chaserPings = [],
}: TacticalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const zoneCircleRef = useRef<L.Circle | null>(null);
  const myMarkerRef = useRef<L.CircleMarker | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([playZone.centerLat, playZone.centerLng], 16);

      // Dark tactical carto tiles or standard openstreetmap
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
      }).addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersGroupRef.current = markersGroup;
      mapInstanceRef.current = map;
    }

    return () => {
      // Map cleanup on unmount
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Play Zone circle
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
      fillOpacity: 0.1,
      dashArray: '6, 6',
    }).addTo(mapInstanceRef.current);

    zoneCircleRef.current = circle;
  }, [playZone.centerLat, playZone.centerLng, playZone.radiusMeters]);

  // Update markers
  useEffect(() => {
    if (!mapInstanceRef.current || !markersGroupRef.current) return;

    markersGroupRef.current.clearLayers();

    // 1. Render Current Player Marker
    if (myLocation) {
      const isRunner = myRole === 'RUNNER';
      const myColor = isRunner ? '#10b981' : '#f59e0b';

      // Accuracy buffer
      L.circle([myLocation.latitude, myLocation.longitude], {
        radius: myLocation.accuracy,
        color: myColor,
        weight: 1,
        fillColor: myColor,
        fillOpacity: 0.15,
      }).addTo(markersGroupRef.current);

      // Pin
      const myMarker = L.circleMarker([myLocation.latitude, myLocation.longitude], {
        radius: 8,
        fillColor: myColor,
        color: '#ffffff',
        weight: 2,
        fillOpacity: 1,
      }).addTo(markersGroupRef.current);

      myMarker.bindTooltip('YOU', { permanent: true, direction: 'top', className: 'tactical-tooltip' });
    }

    // 2. Render Teammate Markers (Runners see other runners; Chasers see other chasers)
    const myMember = members[myPlayerId];
    const myTeam = myMember?.team;

    if (myTeam && myTeam !== 'NONE') {
      for (const m of Object.values(members)) {
        if (m.id === myPlayerId || !m.lastLocation) continue;

        // God-mode referee sees all; teammates see teammates
        const canSee = myRole === 'REFEREE' || m.team === myTeam;
        if (canSee) {
          const color = m.team === 'RUNNERS' ? '#10b981' : '#f59e0b';
          L.circleMarker([m.lastLocation.latitude, m.lastLocation.longitude], {
            radius: 7,
            fillColor: color,
            color: '#1f2937',
            weight: 2,
            fillOpacity: 0.9,
          })
            .bindTooltip(m.nickname, { permanent: false, direction: 'top' })
            .addTo(markersGroupRef.current);
        }
      }
    }

    // 3. Render Chaser Radar Pings (Periodic pings of runners)
    if (myRole === 'CHASER' || myRole === 'REFEREE') {
      for (const ping of chaserPings) {
        L.circleMarker([ping.latitude, ping.longitude], {
          radius: 9,
          fillColor: '#ef4444',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 0.8,
        })
          .bindTooltip(`PING: ${ping.nickname} (${ping.ageSeconds}s ago)`, {
            permanent: true,
            direction: 'bottom',
          })
          .addTo(markersGroupRef.current);
      }
    }
  }, [myLocation, myRole, members, myPlayerId, chaserPings]);

  const handleRecenter = () => {
    if (mapInstanceRef.current && myLocation) {
      mapInstanceRef.current.setView([myLocation.latitude, myLocation.longitude], 17);
    } else if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([playZone.centerLat, playZone.centerLng], 16);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[300px]">
      <div ref={mapContainerRef} className="w-full h-full" />
      <button
        onClick={handleRecenter}
        className="absolute bottom-4 right-4 z-[400] bg-surface-elevated/90 backdrop-blur-md border border-neutral-700 text-neutral-200 px-3 py-2 rounded-xl text-xs font-semibold shadow-lg hover:bg-neutral-800 active:scale-95 transition-all flex items-center gap-1.5"
      >
        <span>📍 Recenter</span>
      </button>
    </div>
  );
}
