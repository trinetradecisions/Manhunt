'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { PlayZone, PlayerLocation, PlayerMember } from '../types/game';

interface GoogleTacticalMapProps {
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

// Tactical dark command center styling for Google Maps
const DARK_TACTICAL_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#090e18' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#090e18' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7c8ba1' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#cbd5e1' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#64748b' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#0f1d2e' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#22c55e' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1a2436' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#0d1522' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#94a3b8' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#2a3b54' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#162233' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#e2e8f0' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#1a2436' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#060a12' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#38bdf8' }],
  },
];

export default function GoogleTacticalMap({
  playZone,
  myLocation,
  myRole,
  members,
  myPlayerId,
  chaserPings = [],
}: GoogleTacticalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const canvasFallbackRef = useRef<HTMLCanvasElement>(null);

  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const playZoneCircleRef = useRef<google.maps.Circle | null>(null);
  const myMarkerRef = useRef<google.maps.Marker | null>(null);
  const myAccuracyCircleRef = useRef<google.maps.Circle | null>(null);
  const teammateMarkersRef = useRef<google.maps.Marker[]>([]);
  const radarPingMarkersRef = useRef<google.maps.Marker[]>([]);

  const [mapEngine, setMapEngine] = useState<'google' | 'fallback' | 'loading'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showConfigGuide, setShowConfigGuide] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Initialize Google Maps or fallback
  useEffect(() => {
    if (!apiKey || apiKey.trim() === '' || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      setMapEngine('fallback');
      setLoadError('No Google Maps API Key detected in NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.');
      return;
    }

    let isMounted = true;
    try {
      setOptions({
        key: apiKey,
        v: 'weekly',
      });

      importLibrary('maps')
        .then((mapsLib) => {
          if (!isMounted || !mapContainerRef.current) return;

          const map = new mapsLib.Map(mapContainerRef.current, {
            center: { lat: playZone.centerLat, lng: playZone.centerLng },
            zoom: 16,
            styles: DARK_TACTICAL_MAP_STYLE,
            disableDefaultUI: true,
            gestureHandling: 'greedy',
            keyboardShortcuts: false,
          });

          // Initialize Play Zone circle
          const circle = new mapsLib.Circle({
            strokeColor: '#ef4444',
            strokeOpacity: 0.85,
            strokeWeight: 2,
            fillColor: '#ef4444',
            fillOpacity: 0.12,
            map,
            center: { lat: playZone.centerLat, lng: playZone.centerLng },
            radius: playZone.radiusMeters,
          });

          mapInstanceRef.current = map;
          playZoneCircleRef.current = circle;
          setMapEngine('google');
        })
        .catch((err) => {
          if (isMounted) {
            console.warn('[GoogleTacticalMap] Failed to load Google Maps:', err);
            setMapEngine('fallback');
            setLoadError(
              err.message || 'Google Maps failed to load. Check API key and referrers.'
            );
          }
        });
    } catch (err: any) {
      if (isMounted) {
        console.warn('[GoogleTacticalMap] Error setting options:', err);
        setMapEngine('fallback');
        setLoadError(err.message || 'Failed initializing Google Maps options');
      }
    }

    return () => {
      isMounted = false;
      if (playZoneCircleRef.current) playZoneCircleRef.current.setMap(null);
      if (myMarkerRef.current) myMarkerRef.current.setMap(null);
      if (myAccuracyCircleRef.current) myAccuracyCircleRef.current.setMap(null);
      teammateMarkersRef.current.forEach((m) => m.setMap(null));
      radarPingMarkersRef.current.forEach((m) => m.setMap(null));
    };
  }, [apiKey, playZone.centerLat, playZone.centerLng, playZone.radiusMeters]);

  // Update Google Maps PlayZone circle when coordinates change
  useEffect(() => {
    if (playZoneCircleRef.current && window.google?.maps) {
      playZoneCircleRef.current.setCenter({
        lat: playZone.centerLat,
        lng: playZone.centerLng,
      });
      playZoneCircleRef.current.setRadius(playZone.radiusMeters);
    }
  }, [playZone.centerLat, playZone.centerLng, playZone.radiusMeters]);

  // Update Google Maps Markers (Player, Teammates, Chaser Radar Pings)
  useEffect(() => {
    if (mapEngine !== 'google' || !mapInstanceRef.current || !window.google?.maps) return;

    const map = mapInstanceRef.current;
    const isRunner = myRole === 'RUNNER';
    const playerAccentColor = isRunner ? '#10b981' : '#f59e0b';

    // 1. Current Player Marker & Accuracy Circle
    if (myLocation) {
      const myPos = { lat: myLocation.latitude, lng: myLocation.longitude };

      if (!myMarkerRef.current) {
        myMarkerRef.current = new google.maps.Marker({
          position: myPos,
          map,
          title: 'YOU',
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: playerAccentColor,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });
      } else {
        myMarkerRef.current.setPosition(myPos);
      }

      if (!myAccuracyCircleRef.current) {
        myAccuracyCircleRef.current = new google.maps.Circle({
          map,
          center: myPos,
          radius: myLocation.accuracy,
          fillColor: playerAccentColor,
          fillOpacity: 0.15,
          strokeColor: playerAccentColor,
          strokeWeight: 1,
        });
      } else {
        myAccuracyCircleRef.current.setCenter(myPos);
        myAccuracyCircleRef.current.setRadius(myLocation.accuracy);
      }
    }

    // 2. Teammates Markers (Filtered by Server/Role)
    teammateMarkersRef.current.forEach((m) => m.setMap(null));
    teammateMarkersRef.current = [];

    const myMember = members[myPlayerId];
    const myTeam = myMember?.team;

    if (myTeam && myTeam !== 'NONE') {
      for (const m of Object.values(members)) {
        if (m.id === myPlayerId || !m.lastLocation) continue;

        const canSee = myRole === 'REFEREE' || m.team === myTeam;
        if (canSee) {
          const color = m.team === 'RUNNERS' ? '#10b981' : '#f59e0b';
          const marker = new google.maps.Marker({
            position: { lat: m.lastLocation.latitude, lng: m.lastLocation.longitude },
            map,
            title: m.nickname,
            label: {
              text: m.nickname.slice(0, 3).toUpperCase(),
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 'bold',
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: color,
              fillOpacity: 0.95,
              strokeColor: '#0f172a',
              strokeWeight: 2,
            },
          });
          teammateMarkersRef.current.push(marker);
        }
      }
    }

    // 3. Radar Pings for Chasers / Referees
    radarPingMarkersRef.current.forEach((m) => m.setMap(null));
    radarPingMarkersRef.current = [];

    if (myRole === 'CHASER' || myRole === 'REFEREE') {
      for (const ping of chaserPings) {
        const pingMarker = new google.maps.Marker({
          position: { lat: ping.latitude, lng: ping.longitude },
          map,
          title: `PING: ${ping.nickname} (${ping.ageSeconds}s ago)`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: '#ef4444',
            fillOpacity: 0.85,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });
        radarPingMarkersRef.current.push(pingMarker);
      }
    }
  }, [mapEngine, myLocation, myRole, members, myPlayerId, chaserPings]);

  // Fallback Canvas Renderer (Local development & keyless offline simulation)
  useEffect(() => {
    if (mapEngine !== 'fallback' || !canvasFallbackRef.current) return;
    const canvas = canvasFallbackRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = (canvas.width = canvas.parentElement?.clientWidth || 360);
    const height = (canvas.height = canvas.parentElement?.clientHeight || 450);

    ctx.clearRect(0, 0, width, height);

    // Dark grid background
    ctx.fillStyle = '#090e18';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#1a2436';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Center point represents PlayZone Center
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = (Math.min(width, height) * 0.4) / playZone.radiusMeters;

    // PlayZone Circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, playZone.radiusMeters * scale, 0, Math.PI * 2);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
    ctx.fill();

    // Player position
    const isRunner = myRole === 'RUNNER';
    const playerColor = isRunner ? '#10b981' : '#f59e0b';

    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.fillStyle = playerColor;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('YOU', centerX - 10, centerY - 14);

    // Radar Pings
    if (myRole === 'CHASER' || myRole === 'REFEREE') {
      chaserPings.forEach((p, idx) => {
        const pingX = centerX + (idx % 2 === 0 ? 35 : -40);
        const pingY = centerY + (idx % 2 === 0 ? -45 : 30);
        ctx.beginPath();
        ctx.arc(pingX, pingY, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.fillText(`PING: ${p.nickname}`, pingX + 10, pingY + 3);
      });
    }
  }, [mapEngine, playZone.radiusMeters, myRole, chaserPings]);

  const handleRecenter = useCallback(() => {
    if (mapInstanceRef.current && myLocation) {
      mapInstanceRef.current.panTo({
        lat: myLocation.latitude,
        lng: myLocation.longitude,
      });
      mapInstanceRef.current.setZoom(17);
    } else if (mapInstanceRef.current) {
      mapInstanceRef.current.panTo({
        lat: playZone.centerLat,
        lng: playZone.centerLng,
      });
      mapInstanceRef.current.setZoom(16);
    }
  }, [myLocation, playZone.centerLat, playZone.centerLng]);

  const handleZoom = useCallback((delta: number) => {
    if (mapInstanceRef.current) {
      const current = mapInstanceRef.current.getZoom() || 16;
      mapInstanceRef.current.setZoom(current + delta);
    }
  }, []);

  return (
    <div className="relative w-full h-full min-h-[350px] overflow-hidden bg-background">
      {/* Google Maps Container */}
      <div
        ref={mapContainerRef}
        className={`w-full h-full ${mapEngine === 'google' ? 'block' : 'hidden'}`}
      />

      {/* Local Development Fallback Vector Canvas */}
      {mapEngine === 'fallback' && (
        <div className="relative w-full h-full flex flex-col">
          <canvas ref={canvasFallbackRef} className="w-full h-full flex-1" />
          {/* Keyless Development Banner */}
          <div className="absolute top-16 left-4 right-4 z-[400] bg-surface-elevated/95 border border-amber-500/60 p-3 rounded-2xl shadow-xl backdrop-blur-md text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-400">
                  <span>⚠️</span>
                  <span>Google Maps: Keyless Development Mode</span>
                </div>
                <p className="text-[11px] text-neutral-300 leading-relaxed">
                  Interactive simulation canvas is active. Game rules, GPS updates, and radar pings are fully functional.
                </p>
              </div>
              <button
                onClick={() => setShowConfigGuide(!showConfigGuide)}
                className="bg-neutral-800 hover:bg-neutral-700 text-amber-300 px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 border border-neutral-700"
              >
                {showConfigGuide ? 'Hide' : 'Setup Guide'}
              </button>
            </div>

            {showConfigGuide && (
              <div className="mt-2.5 pt-2 border-t border-neutral-700/80 text-[11px] text-neutral-300 space-y-1.5">
                <p>1. Open Google Cloud Console & enable <strong>Maps JavaScript API</strong>.</p>
                <p>2. Create an API Key restricted to website referrer <code>http://localhost:3000/*</code>.</p>
                <p>3. Set in <code>client/.env.local</code>:</p>
                <code className="block bg-neutral-900 p-1.5 rounded text-tactical-chaser text-[10px] font-mono select-all">
                  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSy...
                </code>
              </div>
            )}
          </div>
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
        {mapEngine === 'google' && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
