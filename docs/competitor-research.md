# Competitor and Reference Research

This document details the comparative research into the six reference systems, examining game mechanics, networking, safety controls, user experience, and technical implementation trade-offs.

---

## 1. Reference A: Hunting Game (`https://www.hunting-game.com/`)
- **Category**: Commercial Mobile GPS Manhunt App (iOS / Android / Web Spectator).
- **Primary Value Proposition**: "Play manhunt in real life with friends. Chasers track runners on a GPS map; runners use a compass and power-ups to escape."
- **Observed Flow**:
  1. **Lobby & Roles**: Host creates a private game; generates a 6-character code. Minimum 1 chaser and 1 runner. Free tier accommodates up to 4 players, Pro up to 20.
  2. **Play Zone**: The host draws/defines a circular or bounded area before game start. Explicit safety rules advise avoiding railways, busy roads, and bodies of water.
  3. **Release & Tracking**: Chasers receive runner updates at configured intervals (e.g. 1 min, 2 min). Runners have a directional compass pointing to nearby chasers instead of a god-view map.
  4. **Catch Execution**: The chaser asks the runner for their on-screen dynamic catch code and inputs it into the chaser phone. This eliminates physical tackles and violent disputes.
  5. **Data Protection**: Live routes and chat are purged within 5 minutes after game conclusion.
  6. **Spectate**: Web-based spectator view (`/spectate`) permits third parties with the room code to watch matches in real time.

---

## 2. Reference B: SCRAM: Hide and Seek
- **Category**: Mobile App Store Game (iOS/Android).
- **Key Mechanics**:
  - **Head Start Scatter**: Host sets a scatter timer. Hunters are frozen in the lobby/start zone.
  - **Pings with Age Indicator**: Hunters' map updates in periodic batches, showing how many seconds ago each runner was observed.
  - **Boundary Enforcer**: 30-second countdown for out-of-bounds runners; failing to re-enter forces continuous live GPS broadcast to hunters.
  - **Haptic Stealth**: Silent vibration alerts prevent the phone from giving away hiding spots with ringtones.
  - **Push-to-Talk Team Radio**: Encrypted team-only audio for coordinate sharing.
  - **Catch**: "I got tagged" confirmation on runner phone.

---

## 3. Reference C: GeoHunt
- **Category**: Real-World GPS Tag & Pursuit.
- **Key Mechanics**:
  - Configurable circular boundaries.
  - Staggered head starts (2 to 5 minutes).
  - Dual catch validation: distance threshold (<15m) + confirmation code.
  - Elimination / team conversion modes.

---

## 4. Reference D: Manhunt IRL (`manhuntgame.com`)
- **Category**: Hybrid iOS + Mobile Web GPS Tag.
- **Key Mechanics**:
  - **Zero-Install Web Participation**: Guests join directly in Safari/Chrome via short code or QR code.
  - **Fuzzy GPS Circles**: Opponents see accuracy bubbles rather than pinpoint dots to encourage line-of-sight visual pursuit.
  - **Heartbeat Haptics**: Progressive vibration frequency as chasers draw closer (80m, 50m, 25m).
  - **Jail & Jailbreak**: Tagged players assemble at a designated real-world spot; an uncaught teammate standing inside the zone for 5 seconds triggers an alarm and frees them.

---

## 5. Reference E: Convaya (`convaya.com`)
- **Category**: Web-Based Geo-Gaming Platform.
- **Key Mechanics**:
  - 100% browser-based multiplayer without native installation.
  - Modular game mode engine (Tag, Manhunt, Infection, Capture the Flag, Zones).
  - Lightweight room codes and instant guest nickname authorization.

---

## 6. Reference F: Can You See Me Now? (Blast Theory)
- **Category**: Pioneering Mixed-Reality GPS Art Project (Blast Theory & Mixed Reality Lab).
- **Key Mechanics**:
  - **Audio Stream Eavesdropping**: Real-world runners broadcast live walkie-talkie audio, letting virtual fugitives hear their breath, footsteps, and chase coordination.
  - **Catch Radius Threshold**: Proximity check (<5m) registering a virtual capture.
  - Proves that audio communication is dramatically more immersive than pure visual map dots.
