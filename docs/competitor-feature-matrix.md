# Competitor Feature Matrix

Evaluation categories compare verified behaviors across the six reference systems.
Status key:
- **Verified**: Directly observed via live site inspection, verified app store disclosure, or published research.
- **Partially verified**: Documented in public announcements or third-party overviews without direct interactive confirmation.
- **Not verified**: Feature could not be confirmed via public technical evidence.
- **Not applicable**: Feature is outside the scope or design intent of the referenced product.

| Feature Category | Hunting Game | SCRAM: Hide & Seek | GeoHunt | Manhunt IRL | Convaya | Can You See Me Now? | Our Manhunt MVP |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Platform Model** | Native App (iOS/Android) + Web Spectator | Native App (iOS/Android) | Native App | Hybrid (iOS App + Web Browser) | Pure Web (Mobile/Desktop) | Custom Hardware + Web Stream | **Pure Web First (Next.js/Node)** |
| **Account Requirement** | Account required for host / guests | Account required | Account required | Guest join via web browser | Guest nickname only | Anonymous web session | **Guest Nickname (Zero friction)** |
| **Room Code / Join Link** | Verified (6-char code) | Verified (6-char code) | Verified | Verified (4-char code & QR) | Verified (Room URL) | Partially verified | **Verified (6-char code + Invite URL)** |
| **Role Types** | Chaser, Runner, Referee (Family) | Hunter, Runner | Seeker, Hider | Chaser, Runner | Multiple roles | Chaser, Virtual Runner | **Host, Runner, Chaser, Referee, Spectator** |
| **Head Start Mechanic** | Partially verified | Verified (Host scatter timer) | Verified (2-5 min) | Verified (2-4 min) | Not verified | Not applicable | **Verified (Shared & Individual Runner Timers)** |
| **Playable Boundary** | Verified (Circular zone) | Verified (Shrinking circle) | Verified (Circle) | Verified (Circle/Map) | Verified (Zone overlays) | Not applicable (City streets) | **Verified (Circular zone + Proximity warnings)** |
| **GPS Sharing Policy** | Verified (Periodic interval) | Verified (Periodic pings + age) | Verified (Interval) | Verified (Fuzzy circles) | Verified (Real-time map) | Verified (Continuous GPS) | **Verified (Server-validated periodic pings & roles)** |
| **Catch Validation** | Verified (Runner Catch Code entry) | Verified ("I got tagged" button) | Verified (Proximity / 6-digit code) | Verified (Server proximity check) | Verified (Proximity trigger) | Verified (5m virtual proximity) | **Verified (Proximity check + Runner confirmation + Referee override)** |
| **Voice / Radio** | Not verified (Chat mentioned) | Verified (Push-to-talk team radio) | Not verified | Not verified | Not verified | Verified (Live walkie-talkie stream) | **Verified (Store-and-Listen async Voice with LISTEN/IGNORE)** |
| **Haptic Alerts** | Not verified | Verified (Silent buzzing) | Not verified | Verified (Heartbeat proximity pulse) | Not verified | Not applicable | **Verified (Vibration API with visual fallback)** |
| **Safety Pause** | Partially verified (Safety rules) | Not verified | Not verified | Not verified | Not verified | Not applicable | **Verified (Host/Referee immediate safety freeze)** |
| **Data Purge Policy** | Verified (5 min post-game deletion) | Verified (7 day deletion) | Not verified | Not verified | Not verified | Not applicable | **Verified (Immediate purge upon room close or 5 min grace)** |
