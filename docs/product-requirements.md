# Product Requirements Document (PRD)

## 1. Executive Summary
**Project Name**: Manhunt Web (Internal: Manhunt)  
**Target Platform**: Mobile-first Web Application (iOS Safari, Android Chrome, Desktop responsive)  
**Primary Objective**: Deliver a functional, playable, local-development MVP for real-world GPS pursuit multiplayer games with zero client install friction, server-authoritative rules, fair catch validation, and store-and-listen walkie-talkie communication.

---

## 2. User Roles & Authorization

### 2.1 Host
- Creates room with unique 6-character room code.
- Configures game settings:
  - Game mode (`CLASSIC_MANHUNT`).
  - Total match duration (e.g., 10 to 60 minutes).
  - Playable circular zone: latitude, longitude, radius (meters).
  - Periodic location ping frequency (e.g. 30s, 60s, 120s).
  - Team assignments (Runner / Chaser).
  - Head start durations: Default global runner head start or individual runner stagger.
  - Catch verification policy: Proximity + Runner Confirmation or Referee Override.
  - Team radio toggle (Enable/Disable).
- Triggers match lifecycle transitions: Start, Safety Pause, Resume, End, Rematch.
- Assigns Referee or Spectator roles.

### 2.2 Runner
- Receives dynamic countdown to individual release.
- Views own location and boundary warning overlays.
- Receives team radio audio transmissions from fellow runners.
- Has access to the dynamic Catch Code / Catch Confirmation dialog when challenged by a nearby chaser.
- Can report technical issues or trigger emergency distress notification to the host.

### 2.3 Chaser
- Held in waiting state during runner head-start scatter period.
- Receives runner GPS pings filtered and released at the server-scheduled intervals.
- Can trigger a Catch Attempt when within validated proximity (<25m) of a runner.
- Receives team radio transmissions from fellow chasers.

### 2.4 Referee
- Granted spectator access to live locations of all players (God View).
- Can override disputed catch attempts.
- Can trigger an emergency or safety pause.

### 2.5 Spectator
- Can observe game status, scores, timers, and permitted non-secret team updates.
- No access to raw runner GPS during active evasion or private team radio.

---

## 3. Core Feature Requirements

### 3.1 Room & Lobby System
- Unique collision-free 6-character room code (alphanumeric uppercase, excluding ambiguous characters like `0`, `O`, `1`, `I`).
- Shareable join URL (`https://.../?room=XXXXXX`).
- Guest nickname entry with session token stored in browser session.
- Real-time lobby readiness indicators and geolocation permission status icons (`GRANTED`, `DENIED`, `PROMPT`).
- Host controls to change roles or kick participants.

### 3.2 GPS & Boundary Management
- Browser Geolocation API integration with explicit user permission request.
- Stale location detection (visual warning if no GPS reading received within 45 seconds).
- Circular Play Zone rendered on Leaflet/OpenStreetMap.
- Real-time client-side and server-side haversine distance calculation to circle center.
- Boundary warning threshold: triggers alert when within 20 meters of boundary perimeter.
- Boundary violation grace period (30s) before penalty/alert.

### 3.3 Server-Authoritative Timing & Head Starts
- Server maintains absolute timestamps for match start, individual runner releases, chaser release, and match conclusion.
- Pauses preserve remaining elapsed time safely without resetting release schedules.
- Reconnections recalculate exact remaining seconds from server clock.

### 3.4 Catch Verification System
- Proximity check: Chaser sends catch request with current coordinates. Server compares against runner's latest accepted position and accuracy radius.
- Must satisfy `distance <= 25m + (chaser_accuracy + runner_accuracy) / 2`.
- Transitions target runner into `PENDING_CONFIRMATION` state.
- Runner can tap `CONFIRM` or `DISPUTE`.
- Alternatively, chaser enters runner's 4-digit dynamic Catch Code.
- Referee or Host can resolve disputes via immediate override.

### 3.5 Store-and-Listen Team Radio
- Audio recording using browser MediaRecorder API (compressed Opus/WebM or AAC).
- Max recording duration: 15 seconds.
- Uploaded to private server endpoint / local storage adapter.
- Real-time socket notification sent exclusively to verified teammates.
- UI displays incoming transmission alert with two explicit buttons: `LISTEN` and `IGNORE`.
- Haptic vibration pattern on supported devices (3 short buzzes) with visual banner fallback.
- Audio files automatically purged after match completion.

### 3.6 Safety & Emergency Pause
- Instant freeze button available to Host and Referee.
- Immediately halts match timer, disables catch attempts, and broadcasts high-priority safety alert.
- Prompts players to stop running, check surroundings, and regroup at designated center.

---

## 4. Non-Functional Requirements
- **Latency**: Socket event propagation < 250ms under typical mobile 4G.
- **Privacy**: No persistent storage of raw coordinates post-game; zero third-party location trackers.
- **Portability**: Runs on modern iOS Safari (15+) and Android Chrome (90+).
- **Security**: Server-side role and room membership validation for every mutation.
