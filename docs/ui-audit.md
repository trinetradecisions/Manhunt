# UI & Architecture Audit

This audit evaluates the current Manhunt Web application state, identifies technical and visual gaps, and establishes the blueprint for production-readiness.

---

## 1. Audit Summary & Findings

### 1.1 Maps & Geospatial System
- **Current State**: Uses Leaflet (`leaflet` v1.9.4) with CARTO dark raster tiles.
- **Identified Deficiencies**:
  - Requires Leaflet CSS stylesheet injection and dynamic SSR disabling (`ssr: false`) to avoid server crash.
  - No native Google Maps support or vector rendering.
  - Lacks dedicated Google Cloud API key configuration flow and graceful fallback mechanisms for keyless development.
- **Prescribed Remediation**:
  - Integrate `@googlemaps/js-api-loader` with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
  - Provide a high-visibility, informative Google Maps API setup banner and guidance when unconfigured.
  - Support a seamless local development fallback mode so offline and keyless developers can test without blocking.
  - Render custom SVG tactical markers (Player, Teammates, Chaser Radar Pings) and `google.maps.Circle` for the Play Zone.
  - Implement dynamic recenter controls, zoom controls, and boundary buffer alerts.

---

### 1.2 User Interface & Visual System
- **Current State**: Prototype-style dark mode with arbitrary margins, lack of mobile safe-area insets, and unrefined typography.
- **Identified Deficiencies**:
  - Touch targets on mobile screens are inconsistent.
  - Header cards take excessive vertical space, crowding out the interactive map.
  - Lack of clear visual distinction between runner and chaser interfaces.
  - Emergency safety pause button is small and lacks prominent emergency cues.
  - Audio recording lacks cancellation and pre-send preview/review.
- **Prescribed Remediation**:
  - Implement a modern tactical gaming aesthetic with midnight/charcoal backgrounds (`#070b14`), dark navy elevated cards (`#0f172a`), electric green action accents (`#22c55e`), tactical amber for countdowns/chasers (`#f59e0b`), and crimson for boundaries/emergencies (`#ef4444`).
  - Introduce safe-area insets (`env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`).
  - Compact HUD layout prioritizing the map while keeping essential stats (Match Clock, GPS Accuracy, Role, Catch Code) visible.
  - Polish all 15 required screens with responsive desktop bounding containers (max-w-md centered mobile viewport).

---

### 1.3 Multiplayer & Sockets
- **Current State**: Sockets broadcast without acknowledgement callbacks.
- **Identified Deficiencies**:
  - Integration tests revealed race conditions where clients sent role changes before the server finished processing the join event.
  - Catch attempt handler lacked Catch Code validation and brute-force guessing throttle.
  - Uncaught runner list in Chaser HUD didn't provide a direct 4-digit code entry input.
- **Prescribed Remediation**:
  - Add explicit server acknowledgement callbacks and error payloads to Socket events.
  - Support dual catch mechanisms:
    1. Distance-based Proximity Tag (<25m).
    2. Runner Dynamic 4-Digit Catch Code with brute-force rate-limiting (max 3 failed guesses per chaser).
  - Add individual runner head-start duration inputs in Host configuration.

---

### 1.4 Team Walkie-Talkie Radio
- **Current State**: Pressing record instantly sends the blob on release without review.
- **Identified Deficiencies**:
  - If a user speaks accidentally or needs to cancel, there is no cancel option.
  - No visual review/replay waveform or progress bar before sending.
  - Upload status isn't shown to the user.
- **Prescribed Remediation**:
  - Revamp `useRadio.ts` to support two modes:
    - Quick Push-to-Talk (Hold to record, release to review).
    - Review & Confirm mode: Playback snippet, Cancel button, and Send Transmission button.
  - Display clear upload states (`Recording...` -> `Reviewing` -> `Uploading...` -> `Sent!`).
  - Teammate notification dialog with prominent `LISTEN` and `IGNORE` buttons, vibration haptics on supported devices, and fallback toast.

---

## 2. Component & Screen Inventory

| Screen / Component | Current Implementation | Action Needed |
| :--- | :--- | :--- |
| **Landing View** | Basic form in `page.tsx` | Redesign with tactical operative card, room join/create tabs, quick-start guide. |
| **Lobby Screen** | `LobbyView.tsx` | Redesign with shareable code card, individual head-start config, GPS readiness list. |
| **Tactical Map** | `TacticalMap.tsx` (Leaflet) | Rewrite to Google Maps JavaScript API with keyless development fallback. |
| **Active Game HUD** | `ActiveGameHUD.tsx` | Compact floating top bar, role-specific action dock, dynamic catch code display. |
| **Catch Modal** | Basic confirm in `ActiveGameHUD` | Redesign into dedicated component with proximity tag + 4-digit Catch Code input. |
| **Safety Pause Modal**| Small header button | Redesign into full-screen emergency alert modal with regroup instructions. |
| **Team Radio Panel** | Minimal bar at bottom | Add recording wave meter, pre-send preview modal, and incoming transmission card. |
| **Match Results** | `MatchResultsModal.tsx` | Enhance with stats summary, caught operative timeline, and rematch flow. |
