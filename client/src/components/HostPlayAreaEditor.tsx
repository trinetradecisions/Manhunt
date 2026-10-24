'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import {
  Compass,
  Crosshair,
  Search,
  Check,
  X,
  Undo2,
  Redo2,
  Trash2,
  Circle as CircleIcon,
  Square,
  Pentagon,
  PenTool,
  MapPin,
  AlertTriangle,
  RotateCcw,
  Layers,
  Info,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import {
  PlayZone,
  PlayBoundaryShape,
  MapPoint,
  TacticalMarker,
  TacticalMarkerType,
  PlayerLocation,
} from '../types/game';
import {
  calculateHaversineDistance,
  calculatePolygonAreaMeters,
  calculatePolygonPerimeterMeters,
  calculateRectangleAreaMeters,
  checkPolygonSelfIntersection,
  simplifyPoints,
  formatArea,
} from '../utils/geoUtils';

type ActiveTool = 'POINTER' | 'CIRCLE' | 'RECTANGLE' | 'POLYGON' | 'FREEHAND';

interface HostPlayAreaEditorProps {
  initialPlayZone: PlayZone;
  myLocation: PlayerLocation | null;
  onSave: (updatedZone: PlayZone) => void;
  onClose: () => void;
}

export default function HostPlayAreaEditor({
  initialPlayZone,
  myLocation,
  onSave,
  onClose,
}: HostPlayAreaEditorProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Layers
  const shapeLayerRef = useRef<L.LayerGroup | null>(null);
  const handlesLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  // Current boundary state being edited
  const [currentZone, setCurrentZone] = useState<PlayZone>(() => ({
    ...initialPlayZone,
    shapeType: initialPlayZone.shapeType || 'CIRCLE',
    markers: initialPlayZone.markers || [],
  }));

  // History stack for Undo / Redo
  const [history, setHistory] = useState<PlayZone[]>([
    {
      ...initialPlayZone,
      shapeType: initialPlayZone.shapeType || 'CIRCLE',
      markers: initialPlayZone.markers || [],
    },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Active Tool state
  const [activeTool, setActiveTool] = useState<ActiveTool>(() => {
    return (initialPlayZone.shapeType as ActiveTool) || 'CIRCLE';
  });

  // In-progress drawing states
  const [polygonDrawingPoints, setPolygonDrawingPoints] = useState<MapPoint[]>([]);
  const [freehandPoints, setFreehandPoints] = useState<MapPoint[]>([]);
  const [isFreehandDrawing, setIsFreehandDrawing] = useState(false);
  const [rectStartPoint, setRectStartPoint] = useState<MapPoint | null>(null);

  // Selected Marker for editing
  const [selectedMarker, setSelectedMarker] = useState<TacticalMarker | null>(null);
  const [showMarkerModal, setShowMarkerModal] = useState(false);
  const [newMarkerLabel, setNewMarkerLabel] = useState('Checkpoint');
  const [newMarkerType, setNewMarkerType] = useState<TacticalMarkerType>('START_POINT');

  // Search Geocoding state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Dirty state confirmation
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmDiscardModal, setConfirmDiscardModal] = useState(false);

  // Push new state to history stack
  const pushState = useCallback((newZone: PlayZone) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, newZone];
    });
    setHistoryIndex((prev) => prev + 1);
    setCurrentZone(newZone);
    setHasUnsavedChanges(true);
  }, [historyIndex]);

  // Undo
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setCurrentZone(prev);
      setHasUnsavedChanges(true);
    }
  }, [history, historyIndex]);

  // Redo
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setCurrentZone(next);
      setHasUnsavedChanges(true);
    }
  }, [history, historyIndex]);

  // Clear boundary
  const handleClearBoundary = () => {
    const cleared: PlayZone = {
      shapeType: activeTool === 'POINTER' ? 'CIRCLE' : (activeTool as PlayBoundaryShape),
      centerLat: currentZone.centerLat,
      centerLng: currentZone.centerLng,
      radiusMeters: 500,
      vertices: [],
      northEast: undefined,
      southWest: undefined,
      markers: currentZone.markers || [],
      version: (currentZone.version || 1) + 1,
    };
    pushState(cleared);
    setPolygonDrawingPoints([]);
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialLat = currentZone.centerLat || (myLocation ? myLocation.latitude : 51.5074);
      const initialLng = currentZone.centerLng || (myLocation ? myLocation.longitude : -0.1278);

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true,
        maxZoom: 19,
        minZoom: 11,
      }).setView([initialLat, initialLng], 15);

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);

      shapeLayerRef.current = L.layerGroup().addTo(map);
      handlesLayerRef.current = L.layerGroup().addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Recalculate Live Metrics
  const calculatedMetrics = useCallback(() => {
    const shape = currentZone.shapeType || 'CIRCLE';
    let area = 0;
    let perimeter = 0;
    let dimensionStr = '';

    if (shape === 'CIRCLE') {
      const r = currentZone.radiusMeters || 500;
      area = Math.PI * r * r;
      perimeter = 2 * Math.PI * r;
      dimensionStr = `Radius: ${Math.round(r)} m`;
    } else if (shape === 'RECTANGLE' && currentZone.northEast && currentZone.southWest) {
      area = calculateRectangleAreaMeters(currentZone.northEast, currentZone.southWest);
      const h = calculateHaversineDistance(
        currentZone.southWest.lat,
        currentZone.southWest.lng,
        currentZone.northEast.lat,
        currentZone.southWest.lng
      );
      const w = calculateHaversineDistance(
        currentZone.southWest.lat,
        currentZone.southWest.lng,
        currentZone.southWest.lat,
        currentZone.northEast.lng
      );
      perimeter = 2 * (w + h);
      dimensionStr = `${Math.round(w)} m × ${Math.round(h)} m`;
    } else if (shape === 'POLYGON' && currentZone.vertices && currentZone.vertices.length >= 3) {
      area = calculatePolygonAreaMeters(currentZone.vertices);
      perimeter = calculatePolygonPerimeterMeters(currentZone.vertices);
      dimensionStr = `${currentZone.vertices.length} vertices`;
    }

    const isSelfIntersecting =
      shape === 'POLYGON' &&
      currentZone.vertices &&
      currentZone.vertices.length >= 4 &&
      checkPolygonSelfIntersection(currentZone.vertices);

    const isTooSmall = area > 0 && area < 500;
    const isTooLarge = area > 25000000;
    const isValid = area >= 500 && area <= 25000000 && !isSelfIntersecting;

    return {
      area,
      perimeter,
      dimensionStr,
      isSelfIntersecting,
      isTooSmall,
      isTooLarge,
      isValid,
    };
  }, [currentZone]);

  const metrics = calculatedMetrics();

  // Render current shape, handles, and markers to Leaflet layers
  useEffect(() => {
    if (!mapInstanceRef.current || !shapeLayerRef.current || !handlesLayerRef.current || !markersLayerRef.current)
      return;

    shapeLayerRef.current.clearLayers();
    handlesLayerRef.current.clearLayers();
    markersLayerRef.current.clearLayers();

    const shape = currentZone.shapeType || 'CIRCLE';
    const boundaryColor = metrics.isSelfIntersecting ? '#ef4444' : '#84cc16'; // Crimson if self-intersecting, lime if clean

    // 1. Draw Primary Boundary Shape
    if (shape === 'CIRCLE') {
      const center: L.LatLngTuple = [currentZone.centerLat, currentZone.centerLng];
      const r = currentZone.radiusMeters || 500;

      // Outer boundary circle
      L.circle(center, {
        radius: r,
        color: boundaryColor,
        weight: 3,
        fillColor: boundaryColor,
        fillOpacity: 0.15,
        dashArray: '6, 6',
      }).addTo(shapeLayerRef.current);

      // Center draggable handle
      const centerHandleIcon = L.divIcon({
        className: 'center-handle-div',
        html: `<div style="width: 18px; height: 18px; border-radius: 9999px; background-color: #84cc16; border: 2.5px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.6); cursor: grab;"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      const centerMarker = L.marker(center, { icon: centerHandleIcon, draggable: true }).addTo(
        handlesLayerRef.current
      );

      centerMarker.on('drag', (e: any) => {
        const newPos = e.target.getLatLng();
        // Reposition circle visually during drag
        shapeLayerRef.current?.clearLayers();
        L.circle([newPos.lat, newPos.lng], {
          radius: r,
          color: boundaryColor,
          weight: 3,
          fillColor: boundaryColor,
          fillOpacity: 0.15,
          dashArray: '6, 6',
        }).addTo(shapeLayerRef.current!);
      });

      centerMarker.on('dragend', (e: any) => {
        const newPos = e.target.getLatLng();
        pushState({
          ...currentZone,
          centerLat: newPos.lat,
          centerLng: newPos.lng,
        });
      });

      // Edge radius resizing handle (due East)
      const degToMetersLng = 111320 * Math.cos((currentZone.centerLat * Math.PI) / 180);
      const edgeLng = currentZone.centerLng + r / degToMetersLng;
      const edgePos: L.LatLngTuple = [currentZone.centerLat, edgeLng];

      const radiusHandleIcon = L.divIcon({
        className: 'radius-handle-div',
        html: `<div style="width: 14px; height: 14px; border-radius: 4px; background-color: #ffffff; border: 2.5px solid #84cc16; box-shadow: 0 2px 6px rgba(0,0,0,0.6); cursor: ew-resize;"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const radiusMarker = L.marker(edgePos, { icon: radiusHandleIcon, draggable: true }).addTo(
        handlesLayerRef.current
      );

      radiusMarker.on('dragend', (e: any) => {
        const newEdge = e.target.getLatLng();
        const newRadius = calculateHaversineDistance(
          currentZone.centerLat,
          currentZone.centerLng,
          currentZone.centerLat,
          newEdge.lng
        );
        pushState({
          ...currentZone,
          radiusMeters: Math.max(50, Math.min(5000, Math.round(newRadius))),
        });
      });
    } else if (shape === 'RECTANGLE' && currentZone.northEast && currentZone.southWest) {
      const { northEast: ne, southWest: sw } = currentZone;
      const bounds: L.LatLngBoundsExpression = [
        [sw.lat, sw.lng],
        [ne.lat, ne.lng],
      ];

      L.rectangle(bounds, {
        color: boundaryColor,
        weight: 3,
        fillColor: boundaryColor,
        fillOpacity: 0.15,
        dashArray: '6, 6',
      }).addTo(shapeLayerRef.current);

      // 4 Corner draggable handles
      const corners: Array<{ key: 'ne' | 'nw' | 'se' | 'sw'; lat: number; lng: number }> = [
        { key: 'ne', lat: ne.lat, lng: ne.lng },
        { key: 'nw', lat: ne.lat, lng: sw.lng },
        { key: 'se', lat: sw.lat, lng: ne.lng },
        { key: 'sw', lat: sw.lat, lng: sw.lng },
      ];

      for (const corner of corners) {
        const cornerIcon = L.divIcon({
          className: 'corner-handle-div',
          html: `<div style="width: 14px; height: 14px; border-radius: 3px; background-color: #ffffff; border: 2.5px solid #84cc16; box-shadow: 0 2px 6px rgba(0,0,0,0.6); cursor: crosshair;"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        const cornerMarker = L.marker([corner.lat, corner.lng], { icon: cornerIcon, draggable: true }).addTo(
          handlesLayerRef.current
        );

        cornerMarker.on('dragend', (e: any) => {
          const newPos = e.target.getLatLng();
          let newSwLat = sw.lat;
          let newSwLng = sw.lng;
          let newNeLat = ne.lat;
          let newNeLng = ne.lng;

          if (corner.key === 'ne') {
            newNeLat = newPos.lat;
            newNeLng = newPos.lng;
          } else if (corner.key === 'sw') {
            newSwLat = newPos.lat;
            newSwLng = newPos.lng;
          } else if (corner.key === 'nw') {
            newNeLat = newPos.lat;
            newSwLng = newPos.lng;
          } else if (corner.key === 'se') {
            newSwLat = newPos.lat;
            newNeLng = newPos.lng;
          }

          const finalSw = {
            lat: Math.min(newSwLat, newNeLat),
            lng: Math.min(newSwLng, newNeLng),
          };
          const finalNe = {
            lat: Math.max(newSwLat, newNeLat),
            lng: Math.max(newSwLng, newNeLng),
          };

          pushState({
            ...currentZone,
            northEast: finalNe,
            southWest: finalSw,
            centerLat: (finalSw.lat + finalNe.lat) / 2,
            centerLng: (finalSw.lng + finalNe.lng) / 2,
          });
        });
      }
    } else if (shape === 'POLYGON' && currentZone.vertices && currentZone.vertices.length >= 3) {
      const latLngs = currentZone.vertices.map((v) => [v.lat, v.lng] as L.LatLngTuple);

      L.polygon(latLngs, {
        color: boundaryColor,
        weight: 3,
        fillColor: boundaryColor,
        fillOpacity: 0.15,
        dashArray: '6, 6',
      }).addTo(shapeLayerRef.current);

      // Draggable vertex handles
      currentZone.vertices.forEach((vertex, idx) => {
        const vertexIcon = L.divIcon({
          className: 'vertex-handle-div',
          html: `<div style="width: 14px; height: 14px; border-radius: 9999px; background-color: #ffffff; border: 2.5px solid #84cc16; box-shadow: 0 2px 6px rgba(0,0,0,0.6); cursor: grab; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 900; color: #000;">${
            idx + 1
          }</div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        const vMarker = L.marker([vertex.lat, vertex.lng], { icon: vertexIcon, draggable: true }).addTo(
          handlesLayerRef.current!
        );

        vMarker.on('dragend', (e: any) => {
          const newPos = e.target.getLatLng();
          const newVertices = [...currentZone.vertices!];
          newVertices[idx] = { lat: newPos.lat, lng: newPos.lng };

          // Recompute centroid
          let sumLat = 0;
          let sumLng = 0;
          for (const v of newVertices) {
            sumLat += v.lat;
            sumLng += v.lng;
          }

          pushState({
            ...currentZone,
            vertices: newVertices,
            centerLat: sumLat / newVertices.length,
            centerLng: sumLng / newVertices.length,
          });
        });
      });
    }

    // 2. Render In-Progress Polygon Preview
    if (polygonDrawingPoints.length > 0) {
      const previewLatLngs = polygonDrawingPoints.map((p) => [p.lat, p.lng] as L.LatLngTuple);

      L.polyline(previewLatLngs, {
        color: '#06b6d4',
        weight: 3,
        dashArray: '4, 4',
      }).addTo(shapeLayerRef.current);

      polygonDrawingPoints.forEach((p, i) => {
        const previewIcon = L.divIcon({
          className: 'preview-point-div',
          html: `<div style="width: 12px; height: 12px; border-radius: 9999px; background-color: #06b6d4; border: 2px solid #ffffff;"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        L.marker([p.lat, p.lng], { icon: previewIcon }).addTo(handlesLayerRef.current!);
      });
    }

    // 3. Render Strategic Markers (Points of Interest)
    if (currentZone.markers && currentZone.markers.length > 0) {
      currentZone.markers.forEach((m) => {
        let badgeColor = '#06b6d4';
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
          <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            <div style="width: 16px; height: 16px; border-radius: 9999px; background-color: ${badgeColor}; border: 2.5px solid #ffffff; box-shadow: 0 3px 6px rgba(0,0,0,0.6);"></div>
            <div style="background-color: rgba(15, 23, 42, 0.95); border: 1px solid ${badgeColor}; border-radius: 4px; padding: 1px 5px; font-size: 8px; font-weight: 800; color: #ffffff; white-space: nowrap; margin-top: 2px;">
              [${typeLabel}] ${m.label}
            </div>
          </div>
        `;

        const icon = L.divIcon({
          className: 'tactical-marker-item',
          html: markerHtml,
          iconSize: [24, 24],
          iconAnchor: [12, 8],
        });

        const mapMarker = L.marker([m.lat, m.lng], { icon, draggable: true }).addTo(markersLayerRef.current!);

        mapMarker.on('click', () => {
          setSelectedMarker(m);
        });

        mapMarker.on('dragend', (e: any) => {
          const newPos = e.target.getLatLng();
          const updatedMarkers = currentZone.markers!.map((item) =>
            item.id === m.id ? { ...item, lat: newPos.lat, lng: newPos.lng } : item
          );
          pushState({ ...currentZone, markers: updatedMarkers });
        });
      });
    }
  }, [currentZone, polygonDrawingPoints, metrics.isSelfIntersecting]);

  // Click & Drawing Event Listeners on Leaflet Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const clickPoint: MapPoint = { lat: e.latlng.lat, lng: e.latlng.lng };

      if (activeTool === 'POINTER') {
        // Place new tactical marker at click position
        const newMarker: TacticalMarker = {
          id: 'poi_' + Math.random().toString(36).substring(2, 9),
          lat: clickPoint.lat,
          lng: clickPoint.lng,
          label: 'Checkpoint ' + ((currentZone.markers?.length || 0) + 1),
          type: 'START_POINT',
        };
        setSelectedMarker(newMarker);
        setNewMarkerLabel(newMarker.label);
        setNewMarkerType('START_POINT');
        setShowMarkerModal(true);
      } else if (activeTool === 'CIRCLE') {
        // Set new circle center
        pushState({
          ...currentZone,
          shapeType: 'CIRCLE',
          centerLat: clickPoint.lat,
          centerLng: clickPoint.lng,
          radiusMeters: currentZone.radiusMeters || 500,
        });
      } else if (activeTool === 'RECTANGLE') {
        if (!rectStartPoint) {
          // First corner clicked
          setRectStartPoint(clickPoint);
        } else {
          // Second corner clicked: finalize rectangle
          const sw = {
            lat: Math.min(rectStartPoint.lat, clickPoint.lat),
            lng: Math.min(rectStartPoint.lng, clickPoint.lng),
          };
          const ne = {
            lat: Math.max(rectStartPoint.lat, clickPoint.lat),
            lng: Math.max(rectStartPoint.lng, clickPoint.lng),
          };
          pushState({
            ...currentZone,
            shapeType: 'RECTANGLE',
            northEast: ne,
            southWest: sw,
            centerLat: (sw.lat + ne.lat) / 2,
            centerLng: (sw.lng + ne.lng) / 2,
          });
          setRectStartPoint(null);
        }
      } else if (activeTool === 'POLYGON') {
        // Add vertex to in-progress polygon
        setPolygonDrawingPoints((prev) => [...prev, clickPoint]);
      }
    };

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
    };
  }, [activeTool, rectStartPoint, currentZone, pushState]);

  // Freehand Drawing Listeners
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || activeTool !== 'FREEHAND') return;

    map.dragging.disable();

    const handleMouseDown = (e: L.LeafletMouseEvent) => {
      setIsFreehandDrawing(true);
      setFreehandPoints([{ lat: e.latlng.lat, lng: e.latlng.lng }]);
    };

    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      if (!isFreehandDrawing) return;
      setFreehandPoints((prev) => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    };

    const handleMouseUp = () => {
      if (!isFreehandDrawing || freehandPoints.length < 5) {
        setIsFreehandDrawing(false);
        setFreehandPoints([]);
        return;
      }

      // Simplify points using RDP algorithm
      const simplified = simplifyPoints(freehandPoints, 0.00015);
      if (simplified.length >= 3) {
        let sumLat = 0;
        let sumLng = 0;
        for (const p of simplified) {
          sumLat += p.lat;
          sumLng += p.lng;
        }

        pushState({
          ...currentZone,
          shapeType: 'POLYGON',
          vertices: simplified,
          centerLat: sumLat / simplified.length,
          centerLng: sumLng / simplified.length,
        });
      }

      setIsFreehandDrawing(false);
      setFreehandPoints([]);
      setActiveTool('POLYGON');
      map.dragging.enable();
    };

    map.on('mousedown', handleMouseDown);
    map.on('mousemove', handleMouseMove);
    map.on('mouseup', handleMouseUp);

    return () => {
      map.off('mousedown', handleMouseDown);
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', handleMouseUp);
      map.dragging.enable();
    };
  }, [activeTool, isFreehandDrawing, freehandPoints, currentZone, pushState]);

  // Finish Polygon Drawing
  const handleFinishPolygon = () => {
    if (polygonDrawingPoints.length < 3) return;

    let sumLat = 0;
    let sumLng = 0;
    for (const p of polygonDrawingPoints) {
      sumLat += p.lat;
      sumLng += p.lng;
    }

    pushState({
      ...currentZone,
      shapeType: 'POLYGON',
      vertices: polygonDrawingPoints,
      centerLat: sumLat / polygonDrawingPoints.length,
      centerLng: sumLng / polygonDrawingPoints.length,
    });
    setPolygonDrawingPoints([]);
  };

  // Undo Last Polygon Vertex
  const handleUndoPolygonVertex = () => {
    setPolygonDrawingPoints((prev) => prev.slice(0, -1));
  };

  // OpenStreetMap Nominatim Geocoding Search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery.trim()
        )}&limit=5`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      setSearchResults(data);
      setSearchOpen(true);
    } catch {
      // Offline fallback
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: { lat: string; lon: string; display_name: string }) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    if (!isNaN(lat) && !isNaN(lon) && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lon], 16);
      setSearchOpen(false);
      setSearchQuery(result.display_name.split(',')[0]);
    }
  };

  // Recenter on Host's Actual GPS
  const handleCenterOnGPS = () => {
    if (myLocation && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([myLocation.latitude, myLocation.longitude], 17);
    }
  };

  // Save Confirmed Marker
  const handleSaveMarkerModal = () => {
    if (!selectedMarker) return;
    const updated: TacticalMarker = {
      ...selectedMarker,
      label: newMarkerLabel.trim() || 'Checkpoint',
      type: newMarkerType,
    };

    const existingIdx = (currentZone.markers || []).findIndex((m) => m.id === updated.id);
    let newMarkersList = [...(currentZone.markers || [])];
    if (existingIdx >= 0) {
      newMarkersList[existingIdx] = updated;
    } else {
      newMarkersList.push(updated);
    }

    pushState({ ...currentZone, markers: newMarkersList });
    setShowMarkerModal(false);
    setSelectedMarker(null);
  };

  // Delete Marker
  const handleDeleteMarker = (id: string) => {
    const filtered = (currentZone.markers || []).filter((m) => m.id !== id);
    pushState({ ...currentZone, markers: filtered });
    setShowMarkerModal(false);
    setSelectedMarker(null);
  };

  // Save Play Zone
  const handleSavePlayZone = () => {
    if (!metrics.isValid) return;

    const validatedZone: PlayZone = {
      ...currentZone,
      shapeType: currentZone.shapeType || 'CIRCLE',
      areaSquareMeters: metrics.area,
      perimeterMeters: metrics.perimeter,
      version: (currentZone.version || 1) + 1,
      updatedAt: Date.now(),
    };

    onSave(validatedZone);
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-background text-neutral-100 flex flex-col select-none overflow-hidden">
      {/* 1. Header Control Bar */}
      <header className="h-14 bg-surface border-b border-neutral-800 px-4 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-neutral-900 border border-neutral-700 flex items-center justify-center text-tactical-lime shadow-inner">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-mono font-black uppercase tracking-wider text-white">
                Host Play Area Editor
              </h1>
              <span className="text-[10px] font-mono bg-neutral-800 px-2 py-0.5 rounded text-neutral-400">
                REV v{currentZone.version || 1}
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 hidden sm:block">
              Draw and define the authoritative real-world boundary for all operatives.
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <div className="flex items-center border border-neutral-800 rounded-xl overflow-hidden bg-surface-elevated">
            <button
              onClick={handleUndo}
              disabled={historyIndex === 0}
              title="Undo (Ctrl+Z)"
              className="p-2 text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-neutral-800" />
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              title="Redo (Ctrl+Y)"
              className="p-2 text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          {/* Reset / Clear */}
          <button
            onClick={handleClearBoundary}
            title="Clear Boundary"
            className="p-2 rounded-xl bg-surface-elevated border border-neutral-800 text-neutral-400 hover:text-tactical-danger transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Cancel */}
          <button
            onClick={() => {
              if (hasUnsavedChanges) {
                setConfirmDiscardModal(true);
              } else {
                onClose();
              }
            }}
            className="px-3 py-2 rounded-xl border border-neutral-700 hover:bg-neutral-800 text-xs font-bold text-neutral-300"
          >
            Cancel
          </button>

          {/* Save Play Area */}
          <button
            onClick={handleSavePlayZone}
            disabled={!metrics.isValid}
            className="px-4 py-2 bg-tactical-lime hover:brightness-110 active:scale-98 text-neutral-950 font-black rounded-xl text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-lime-glow disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Save Play Area</span>
          </button>
        </div>
      </header>

      {/* 2. Interactive Map Container */}
      <div className="relative flex-1 w-full h-full bg-neutral-950">
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Search & GPS Bar (Floating Top Left) */}
        <div className="absolute top-3 left-3 z-[400] max-w-sm w-full space-y-2 pointer-events-auto">
          <form onSubmit={handleSearch} className="relative flex items-center gap-1">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search town, campus, park..."
                className="w-full bg-surface/95 backdrop-blur-md border border-neutral-700/80 rounded-xl pl-9 pr-4 py-2 text-xs font-semibold text-white focus:outline-none focus:border-tactical-lime shadow-xl placeholder:text-neutral-500"
              />
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
            </div>

            <button
              type="submit"
              disabled={isSearching}
              className="p-2 bg-surface border border-neutral-700 hover:bg-neutral-800 text-neutral-200 rounded-xl"
            >
              {isSearching ? (
                <div className="w-4 h-4 border-2 border-tactical-lime border-t-transparent rounded-full animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </button>

            {myLocation && (
              <button
                type="button"
                onClick={handleCenterOnGPS}
                title="Center on My GPS"
                className="p-2 bg-surface border border-neutral-700 hover:bg-neutral-800 text-cyan-400 rounded-xl"
              >
                <Crosshair className="w-4 h-4" />
              </button>
            )}
          </form>

          {/* Search Dropdown Results */}
          {searchOpen && searchResults.length > 0 && (
            <div className="bg-surface/95 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl p-1 max-h-48 overflow-y-auto space-y-1">
              {searchResults.map((res, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectSearchResult(res)}
                  className="w-full text-left px-3 py-2 rounded-lg text-[11px] text-neutral-200 hover:bg-neutral-800 hover:text-white transition-colors truncate block"
                >
                  {res.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 3. Drawing Toolbar (Floating Left) */}
        <div className="absolute top-20 left-3 z-[400] flex flex-col gap-1.5 p-1.5 bg-surface/95 backdrop-blur-md border border-neutral-800 rounded-2xl shadow-2xl pointer-events-auto">
          {/* Tool 1: Circle */}
          <button
            onClick={() => {
              setActiveTool('CIRCLE');
              pushState({
                ...currentZone,
                shapeType: 'CIRCLE',
                radiusMeters: currentZone.radiusMeters || 500,
              });
            }}
            title="Circle Tool (Center & Radius)"
            className={`p-2.5 rounded-xl flex items-center justify-center transition-all ${
              activeTool === 'CIRCLE'
                ? 'bg-tactical-lime text-neutral-950 font-bold shadow-lime-glow'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <CircleIcon className="w-4 h-4" />
          </button>

          {/* Tool 2: Rectangle */}
          <button
            onClick={() => {
              setActiveTool('RECTANGLE');
              setRectStartPoint(null);
            }}
            title="Rectangle Tool (Click 2 corners)"
            className={`p-2.5 rounded-xl flex items-center justify-center transition-all ${
              activeTool === 'RECTANGLE'
                ? 'bg-tactical-lime text-neutral-950 font-bold shadow-lime-glow'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <Square className="w-4 h-4" />
          </button>

          {/* Tool 3: Custom Polygon */}
          <button
            onClick={() => {
              setActiveTool('POLYGON');
              setPolygonDrawingPoints([]);
            }}
            title="Custom Polygon Tool (Click points)"
            className={`p-2.5 rounded-xl flex items-center justify-center transition-all ${
              activeTool === 'POLYGON'
                ? 'bg-tactical-lime text-neutral-950 font-bold shadow-lime-glow'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <Pentagon className="w-4 h-4" />
          </button>

          {/* Tool 4: Freehand Trace */}
          <button
            onClick={() => {
              setActiveTool('FREEHAND');
              setFreehandPoints([]);
            }}
            title="Freehand Tool (Drag across map to sketch)"
            className={`p-2.5 rounded-xl flex items-center justify-center transition-all ${
              activeTool === 'FREEHAND'
                ? 'bg-tactical-lime text-neutral-950 font-bold shadow-lime-glow'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <PenTool className="w-4 h-4" />
          </button>

          <div className="w-full h-px bg-neutral-800 my-0.5" />

          {/* Tool 5: Tactical POI Marker */}
          <button
            onClick={() => setActiveTool('POINTER')}
            title="Marker Tool (Place Start Point, Safe Zone, Meeting Point)"
            className={`p-2.5 rounded-xl flex items-center justify-center transition-all ${
              activeTool === 'POINTER'
                ? 'bg-cyan-400 text-neutral-950 font-bold shadow-cyan-glow'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
            }`}
          >
            <MapPin className="w-4 h-4" />
          </button>
        </div>

        {/* 4. Polygon In-Progress Actions Pill (Floating Top Center) */}
        {activeTool === 'POLYGON' && polygonDrawingPoints.length > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[400] flex items-center gap-2 bg-surface/95 backdrop-blur-md border border-cyan-500/50 px-3 py-1.5 rounded-full shadow-2xl text-xs font-mono">
            <span className="text-cyan-400">{polygonDrawingPoints.length} points placed</span>
            <button
              onClick={handleUndoPolygonVertex}
              className="text-neutral-400 hover:text-white font-bold ml-1"
            >
              Undo
            </button>
            <button
              onClick={handleFinishPolygon}
              disabled={polygonDrawingPoints.length < 3}
              className="bg-cyan-500 hover:bg-cyan-400 text-neutral-950 px-2.5 py-0.5 rounded-full font-black text-[11px] disabled:opacity-40"
            >
              Finish Boundary
            </button>
          </div>
        )}

        {/* 5. Live Tactical Boundary Metrics Panel (Floating Bottom) */}
        <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:w-80 z-[400] bg-surface/95 backdrop-blur-md border border-neutral-800 p-3.5 rounded-2xl shadow-2xl space-y-2 pointer-events-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-tactical-lime animate-pulse" />
              <span className="font-mono text-xs font-bold text-white uppercase tracking-wider">
                Shape: {currentZone.shapeType || 'CIRCLE'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-neutral-400">{metrics.dimensionStr}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-surface-elevated/80 border border-neutral-800 p-2 rounded-xl">
              <span className="text-[10px] text-neutral-400 block font-mono">TOTAL AREA</span>
              <span className="font-mono font-black text-white text-sm">
                {formatArea(metrics.area)}
              </span>
            </div>
            <div className="bg-surface-elevated/80 border border-neutral-800 p-2 rounded-xl">
              <span className="text-[10px] text-neutral-400 block font-mono">PERIMETER</span>
              <span className="font-mono font-black text-neutral-200 text-sm">
                {Math.round(metrics.perimeter).toLocaleString()} m
              </span>
            </div>
          </div>

          {/* Validation Alerts */}
          {metrics.isSelfIntersecting && (
            <div className="bg-red-950/80 border border-red-500 text-red-300 p-2 rounded-xl text-[11px] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>Boundary lines cross each other! Fix vertex positions.</span>
            </div>
          )}

          {metrics.isTooSmall && (
            <div className="bg-amber-950/80 border border-amber-500 text-amber-300 p-2 rounded-xl text-[11px] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>Area is too small ({formatArea(metrics.area)}). Minimum is 500 m².</span>
            </div>
          )}

          {metrics.isTooLarge && (
            <div className="bg-red-950/80 border border-red-500 text-red-300 p-2 rounded-xl text-[11px] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>Area exceeds 25 km² tactical limit.</span>
            </div>
          )}

          {/* Instructions Guidance */}
          <div className="text-[10px] text-neutral-400 leading-snug">
            {activeTool === 'CIRCLE' && 'Click map to place center. Drag the edge handle to resize radius.'}
            {activeTool === 'RECTANGLE' && 'Click first corner, then click opposite corner to form rectangle.'}
            {activeTool === 'POLYGON' && 'Click successive points to outline zone. Click Finish Boundary when done.'}
            {activeTool === 'FREEHAND' && 'Drag mouse/finger to trace boundary. Auto-simplifies upon release.'}
            {activeTool === 'POINTER' && 'Click anywhere on map to add a tactical checkpoint or safe zone.'}
          </div>
        </div>
      </div>

      {/* 6. Strategic Marker Configuration Modal */}
      {showMarkerModal && selectedMarker && (
        <div className="fixed inset-0 z-[1100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-neutral-700 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <h3 className="font-mono font-bold text-xs uppercase tracking-wider text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-tactical-lime" />
                Configure Tactical Marker
              </h3>
              <button
                onClick={() => {
                  setShowMarkerModal(false);
                  setSelectedMarker(null);
                }}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-mono uppercase text-neutral-400 block mb-1">
                  Marker Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { type: 'START_POINT', label: 'Start Point', color: 'border-lime-500' },
                      { type: 'SAFE_ZONE', label: 'Safe Zone', color: 'border-emerald-500' },
                      { type: 'MEETING_POINT', label: 'Meeting Point', color: 'border-amber-500' },
                      { type: 'CUSTOM', label: 'Custom Point', color: 'border-purple-500' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.type}
                      type="button"
                      onClick={() => setNewMarkerType(t.type)}
                      className={`p-2 rounded-xl text-xs font-bold border text-left transition-all ${
                        newMarkerType === t.type
                          ? `bg-surface-elevated text-white ${t.color}`
                          : 'bg-surface border-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase text-neutral-400 block mb-1">
                  Call-Sign / Label
                </label>
                <input
                  type="text"
                  value={newMarkerLabel}
                  onChange={(e) => setNewMarkerLabel(e.target.value)}
                  maxLength={30}
                  className="w-full bg-surface-elevated border border-neutral-700 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-tactical-lime"
                />
              </div>

              <div className="text-[10px] text-neutral-500 font-mono">
                Coordinates: {selectedMarker.lat.toFixed(5)}, {selectedMarker.lng.toFixed(5)}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleDeleteMarker(selectedMarker.id)}
                className="p-2.5 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-950/40"
                title="Delete Marker"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleSaveMarkerModal}
                className="flex-1 py-2.5 bg-tactical-lime hover:brightness-110 text-neutral-950 font-black rounded-xl text-xs uppercase tracking-wider"
              >
                Confirm Marker
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Discard Changes Confirmation Modal */}
      {confirmDiscardModal && (
        <div className="fixed inset-0 z-[1200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-neutral-700 w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-mono font-bold text-xs uppercase tracking-wider text-white">
                Discard Play Area Changes?
              </h3>
            </div>
            <p className="text-xs text-neutral-300">
              You have unsaved changes to the map boundary. Leaving now will discard your edits.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setConfirmDiscardModal(false)}
                className="flex-1 py-2.5 bg-surface-elevated border border-neutral-700 hover:bg-neutral-800 text-xs font-bold text-neutral-300 rounded-xl"
              >
                Keep Editing
              </button>
              <button
                onClick={() => {
                  setConfirmDiscardModal(false);
                  onClose();
                }}
                className="flex-1 py-2.5 bg-tactical-danger hover:brightness-110 text-white text-xs font-black rounded-xl uppercase tracking-wider"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
