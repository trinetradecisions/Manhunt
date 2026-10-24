# Location Architecture & Privacy Controls

## 1. Real-World GPS Principles & Limitations
In a mobile web environment (Safari on iOS, Chrome on Android), geolocation is subject to browser security restrictions and OS power-saving heuristics:
1. **HTTPS Enforcement**: Web Geolocation API (`navigator.geolocation`) requires a secure context (HTTPS) in production and `localhost` during development.
2. **Tab Throttling**: Mobile browsers throttle timer callbacks and suspend WebSocket connections when the user locks their screen or switches tabs.
3. **No Background Tracking Guarantee**: Browsers do not guarantee continuous background execution without active native service workers or audio wakelocks.
4. **Accuracy Variability**: GPS accuracy in urban canyons can fluctuate from 5m to 100m.

---

## 2. Mitigation & Robustness Strategies
- **Graceful Staleness Detection**: The UI tracks `lastLocationUpdateTimestamp`. If no reading is received for >45 seconds, an amber "GPS Stale" indicator appears with troubleshooting hints (e.g., "Keep screen awake or reopen tab").
- **Haversine Distance with Uncertainty**: Boundary crossings and catch proximity calculations always incorporate reported horizontal accuracy:
  $$\text{Effective Distance} = \max(0, \text{Haversine}(p_1, p_2) - \frac{\text{acc}_1 + \text{acc}_2}{2})$$
- **Boundary Warning Buffer**: Rather than instantly penalizing players at the exact perimeter, a 20-meter "Approaching Boundary" buffer warns players to turn around. If a player crosses the line, a 30-second grace timer is granted before marking out-of-bounds.
- **Asymmetric Role-Based Disclosure**: Opposing chasers never receive uninterrupted live coordinates. The server filters and releases runner coordinates at fixed intervals (e.g., 60s) with added staleness metrics.

---

## 3. Privacy & Data Lifecycle
1. **Zero Permanent Coordinate Storage**: Player coordinates are held strictly in memory in the active room session.
2. **Post-Match Purge**: As soon as a match ends or a room is closed, all coordinates, breadcrumbs, and location logs are immediately deleted.
3. **Public Isolation**: Public room discovery does not expose room codes or player coordinates. Rooms can only be accessed via the explicit 6-character room code or private invite token.
4. **No Third-Party Analytics Trackers**: No Google Maps API keys or third-party ad networks track user coordinates. We use Leaflet with OpenStreetMap / CARTO raster tiles without personal identifier transmission.
