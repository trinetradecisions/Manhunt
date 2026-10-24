# Product Opportunity Analysis

This document synthesizes findings from competitor research and defines our competitive wedge, core value proposition, and technical strategy.

---

## 1. Recurring Design Patterns Across Products
1. **Periodic Asymmetric Information**: Continuous live GPS pins turn outdoor games into heads-down navigation. The most successful games (Hunting Game, SCRAM, Manhunt IRL) use **periodic pings, age timestamps, or directional compasses** so players keep their eyes up on the physical world.
2. **Friction-Free Joining**: Players assemble spontaneously in parks, campuses, or streets. Requiring app store downloads or email registration causes massive drop-off. Browser-first join codes (proven by Convaya and Manhunt IRL web clients) offer the highest engagement velocity.
3. **Catch Ambiguity Mitigation**: Physical contact in competitive outdoor running creates injury risks and disputes. Every top product uses software mediation:
   - Runner dynamic Catch Codes (Hunting Game, GeoHunt).
   - Server proximity bounding (Manhunt IRL, Can You See Me Now?).
   - Runner manual tap / Referee mediation.
4. **Safety & Private Boundary Enforcement**: Clear visual zones, approaching-boundary warnings, and safety-pause controls are essential for parent/guardian comfort and real-world legal adherence.

---

## 2. Specific Learnings from Hunting Game
- **Catch Code Entry**: Having the chaser input a code displayed on the runner's screen eliminates physical tackling while guaranteeing proximity and mutual consent.
- **Directional Compass vs. Full Map**: Giving runners a directional compass pointing to chasers preserves tactical escape excitement without trivializing chaser stealth.
- **Short Data Retention**: Strict 5-minute post-match location deletion is both a compelling privacy guarantee and reduces cloud storage costs to zero.
- **Spectator Mode**: A dedicated spectator view using the room code allows friends or parents to monitor the game safely from a bench.

---

## 3. General Concepts to Implement Independently
- **Server-Authoritative Head Start**: Staggered releases (individual runner scatter periods before chaser countdown completes) enforced on the backend, not the client clock.
- **Store-and-Listen Team Radio**: A walkie-talkie experience with short asynchronous audio recordings, encrypted access, and a `LISTEN` / `IGNORE` action interface. Avoids the battery drain and connection flakiness of full-duplex WebRTC in browser background.
- **Tactical Vibration Alerts**: Utilizing the Web Vibration API for incoming radio pings, approaching boundaries, and proximity alerts, with guaranteed visual fallbacks for iOS Safari (which lacks Web Vibration support).

---

## 4. Complex, Unreliable, or Unnecessary Features (Avoid for MVP)
- **Continuous Background Web Tracking**: Mobile browsers aggressively throttle or suspend JavaScript execution in background tabs. Promising unbroken background tracking in mobile browsers leads to failure. Instead, design for **active tab recovery**, visual warnings when location is stale, and resume sync.
- **Full-Duplex WebRTC Live Mesh**: High bandwidth, CPU heat, battery consumption, and complex NAT traversal on cellular 4G/5G. Asynchronous store-and-listen audio is reliable, lightweight, and perfectly mirrors tactical radio transmissions.
- **Account Signups & OAuth**: Unnecessary friction for party play. Session-based guest tokens in localStorage/cookies provide seamless room isolation.

---

## 5. What Our Product Does Differently
1. **Zero-Install Full Stack Web**: Host, runner, chaser, referee, and spectator all run in modern mobile web browsers with zero installation.
2. **Individual & Staggered Head Starts**: Fine-grained release times per runner, calculated and enforced server-side.
3. **Three-Tier Catch Fair-Play Protocol**:
   - Tier 1: Server proximity check (<25m calculated with haversine formula accounting for GPS accuracy).
   - Tier 2: Catch Attempt state requiring Runner Confirmation (or catch code input).
   - Tier 3: Referee / Host instant dispute resolution.
4. **Tactical Store-and-Listen Walkie-Talkie**: High-fidelity, team-isolated voice bursts with explicit `LISTEN` / `IGNORE` controls and short-term private storage.
5. **Instant Emergency Safety Pause**: Host or Referee can freeze all match timers, alert all devices, and display a regroup map immediately.

---

## 6. MVP Scope vs. Postponed Features

### In MVP:
- Host creates private room; generates 6-character room code and shareable URL.
- Guest nicknames; role assignments (Host, Runner, Chaser, Referee, Spectator).
- Fixed circular Play Zone (configurable center & radius in meters).
- Browser Geolocation API with accuracy indicator and stale-reading detection.
- Server-authoritative state machine: `LOBBY` -> `READY_CHECK` -> `COUNTDOWN` -> `RUNNER_HEADSTART` -> `ACTIVE` -> `SAFETY_PAUSED` -> `COMPLETED` / `CANCELLED`.
- Individual runner head-start release schedules.
- Classic Manhunt mode with periodic server-filtered GPS pings.
- Proximity-based catch attempt + runner confirmation + referee dispute override.
- Store-and-Listen Team Radio with private team uploads, `LISTEN` / `IGNORE`, vibration alerts, and visual fallbacks.
- Match results, rematch flow, and immediate match data purge.
- Complete unit and integration test suite.

### Postponed to Future Iterations:
- Infection, Jailbreak, Capture the Flag modes.
- Shrinking polygon zones and safe zones.
- Continuous live WebRTC audio mesh.
- Native iOS/Android app wrappers (Capacitor/React Native).
- User accounts, XP leveling, and persistent leaderboards.
