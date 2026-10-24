# Manhunt Web

A mobile-browser-first, real-world GPS multiplayer pursuit game inspired by outdoor hide-and-seek and tactical pursuit operations.

---

## ⚡ Quickstart: Local Playtest

### Prerequisites
- Node.js (v18+ or v20+ / tested on v24.15.0)
- npm (v9+ / tested on v11.12.1)

### 1. Install Dependencies
```bash
# In the repository root
npm install --workspace=server
npm install --workspace=client
```

### 2. Run the Development Servers
In two separate terminals:

**Terminal 1 (Backend Node.js + Socket.IO Server on Port 4000):**
```bash
cd server
npm run dev
```

**Terminal 2 (Frontend Next.js Client on Port 3000):**
```bash
cd client
npm run dev
```

Open your browser to:
```
http://localhost:3000
```

---

## 📱 Multi-Player & Mobile Testing Instructions

### Local Multi-Session Simulation (Same Computer)
1. Open an Incognito window or separate browser profile (e.g. Chrome + Firefox or Safari).
2. Browser 1: Enter nickname "Commander", click **Create Private Game Room**. You are the **Host**.
3. Copy the 6-character room code or invite URL.
4. Browser 2: Enter nickname "Speedy", paste the code and click **Join**.
5. Browser 3: Enter nickname "Hunter", paste the code and click **Join**.
6. On the Host screen:
   - Assign "Speedy" as **Runner**.
   - Assign "Hunter" as **Chaser**.
   - Adjust duration and boundary radius if desired.
7. Click **Start Chase ⚡**.
8. Observe:
   - 5-second countdown triggers synchronously on all 3 browsers.
   - Head Start begins for the runner. The chaser is locked with a release countdown.
   - Chasers receive periodic radar pings of the runner's location.
   - When the chaser approaches (<25m), the chaser taps **⚡ Tag Nearby Runner**.
   - The runner receives a high-contrast confirmation dialog: **Confirm Tag** or **Dispute Tag**.
   - Pressing **🚨 Pause** on the Host screen immediately freezes the match clock for all players.

### Testing on Real Phones (Same Wi-Fi Network)
1. Find your machine's local IP address (e.g. `ipconfig` -> `192.168.1.50`).
2. Update `client/.env.local`:
   ```bash
   NEXT_PUBLIC_SOCKET_URL=http://192.168.1.50:4000
   ```
3. Run the client with host flag:
   ```bash
   npm run dev -- -H 0.0.0.0
   ```
4. On smartphones connected to the same Wi-Fi, navigate to `http://192.168.1.50:3000`.
   *(Note: Modern mobile browsers require HTTPS for geolocation and microphone outside of `localhost`. For full field outdoor GPS testing, use tools like ngrok/Cloudflare Tunnel: `ngrok http 3000`)*.

---

## 🧪 Running Automated Tests
```bash
cd server
npm run test
```
All 14 unit and integration tests covering geospatial calculations, state machine transitions, catch proximity verification, dynamic catch codes, team radio isolation, and safety pauses will execute.

To test the production build:
```bash
cd client
npm run build
```

---

## 🚀 Production Deployment & Hosting Guide

### Architecture Overview
- **Client (Frontend)**: Next.js 15 (React 19 / TypeScript / Tailwind CSS / Leaflet). Fully static & SSR compatible, ideal for deployment on **Vercel**, Cloudflare Pages, or Netlify.
  - Requires **HTTPS** in production for browser Geolocation API (`navigator.geolocation`) and MediaDevices (`navigator.mediaDevices.getUserMedia`).
  - Configure `NEXT_PUBLIC_SOCKET_URL` pointing to your deployed backend origin.
- **Server (Backend)**: Node.js (Express / Socket.IO / WebRTC Signaling / In-Memory Match Loops).
  - Requires a persistent Node.js environment with long-lived WebSocket support, such as **Render**, **Railway**, **Fly.io**, **AWS ECS/EC2**, or **DigitalOcean App Platform**.
  - **Important**: Do not deploy the backend as serverless functions (e.g. AWS Lambda / Vercel Serverless) as match timers, radar loops, and WebSocket connections require a persistent process.
  - Health check endpoint available at `/health` and `/api/health`.

### Environment Variables

#### Client (`client/.env.production`)
```env
NEXT_PUBLIC_SOCKET_URL=https://api.yourdomain.com
NEXT_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
# Optional WebRTC STUN/TURN (defaults to Google Public STUN)
NEXT_PUBLIC_STUN_URL=stun:stun.l.google.com:19302
# NEXT_PUBLIC_TURN_URL=turn:turn.yourdomain.com:3478
# NEXT_PUBLIC_TURN_USERNAME=username
# NEXT_PUBLIC_TURN_CREDENTIAL=password
```

#### Server (`server/.env.production`)
```env
PORT=4000
NODE_ENV=production
CORS_ORIGIN=https://manhunt.yourdomain.com
MAX_AUDIO_SIZE_BYTES=5242880
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=120
```

### Game Scoring & Match Lifecycle
- **Authoritative Server Validation**: All catches, GPS distances, mission completions, and team points are validated on the server.
- **Winning Team Bonus**: **+500 points** awarded to the victorious team exactly once upon match termination.
- **Individual Winner Bonus**: **+100 points** awarded to each player on the winning squad.
- **Catch Scoring**: Verified catch awards +100 individual points to the chaser and +100 team points to the Chasers team.
- **Catch Security**: 4-digit expiring dynamic catch codes with GPS proximity verification (<25m), anti-replay guards, and rate limits.
- **State Durability**: Active match rooms run in-memory for zero-latency multiplayer sync. Long-term player records and dossiers are saved locally in `server/data/player_stats.json`. (Note: Server process restarts will terminate active in-memory matches; players can re-join new lobbies immediately).

---

## 📚 Complete Project Documentation
- [Evidence Ledger](file:///C:/Users/chanu/Projects/Manhunt/docs/evidence-ledger.md)
- [Competitor Research](file:///C:/Users/chanu/Projects/Manhunt/docs/competitor-research.md)
- [Competitor Feature Matrix](file:///C:/Users/chanu/Projects/Manhunt/docs/competitor-feature-matrix.md)
- [Product Opportunity Analysis](file:///C:/Users/chanu/Projects/Manhunt/docs/product-opportunity-analysis.md)
- [Product Requirements Document](file:///C:/Users/chanu/Projects/Manhunt/docs/product-requirements.md)
- [Game Rules](file:///C:/Users/chanu/Projects/Manhunt/docs/game-rules.md)
- [Game State Machine](file:///C:/Users/chanu/Projects/Manhunt/docs/game-state-machine.md)
- [Socket Event Contracts](file:///C:/Users/chanu/Projects/Manhunt/docs/socket-event-contracts.md)
- [Location Architecture & Privacy](file:///C:/Users/chanu/Projects/Manhunt/docs/location-and-privacy.md)
- [Radio Design](file:///C:/Users/chanu/Projects/Manhunt/docs/radio-design.md)
- [Security Threat Model](file:///C:/Users/chanu/Projects/Manhunt/docs/security-threat-model.md)
- [Database Schema](file:///C:/Users/chanu/Projects/Manhunt/docs/database-schema.md)
- [Test Plan](file:///C:/Users/chanu/Projects/Manhunt/docs/test-plan.md)
- [Implementation Status](file:///C:/Users/chanu/Projects/Manhunt/docs/implementation-status.md)

