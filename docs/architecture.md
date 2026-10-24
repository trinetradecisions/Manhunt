# System Architecture

## 1. Architectural Approach
We employ a **Modular Monolith** pattern:
- Cleanly decoupled frontend and backend within a single repository for simplified development, synchronization, testing, and unified type sharing.
- **Frontend**: Next.js with React 19 / 18, TypeScript, Tailwind CSS, Leaflet for OpenStreetMap rendering.
- **Backend**: Node.js HTTP + Socket.IO persistent server running TypeScript.
- **Storage**: Pluggable storage adapter (`LocalDiskStorage` for local development; `SupabaseStorage` / `S3Storage` for production).
- **Communication Protocol**:
  - HTTP REST: Room creation, radio audio upload, health checks.
  - WebSockets (Socket.IO): High-frequency real-time match events, lobby sync, proximity alerts, catch mediation.

---

## 2. Component Diagram

```mermaid
graph TD
    subgraph Client ["Client Tier (Mobile Web Safari / Chrome)"]
        UI[Mobile First UI / Tailwind]
        Map[Leaflet OpenStreetMap]
        GPS[Browser Geolocation API]
        AudioRec[MediaRecorder Audio Capture]
        AudioPlay[HTML5 Audio Player]
        SocketClient[Socket.IO Client]
    end

    subgraph Server ["Server Tier (Node.js / Express / Socket.IO)"]
        HTTP[Express REST Router]
        SocketServer[Socket.IO Event Engine]
        StateMachine[Game State Machine Engine]
        Proximity[Haversine Geo Engine]
        AudioStore[Audio Storage Adapter]
        AuthEngine[Session & Role Guard]
    end

    subgraph Storage ["Data Tier"]
        DB[(PostgreSQL / SQLite Storage)]
        AudioDisk[(Local Audio / Object Storage)]
    end

    UI --> SocketClient
    GPS --> SocketClient
    AudioRec --> HTTP
    SocketClient <--> SocketServer
    HTTP --> AudioStore
    AudioStore --> AudioDisk
    SocketServer --> StateMachine
    SocketServer --> Proximity
    SocketServer --> AuthEngine
    StateMachine --> DB
```

---

## 3. Directory Layout
```
/
├── docs/                      # Research, specs, architecture, test plan
├── client/                    # Next.js mobile-first frontend application
│   ├── src/
│   │   ├── components/        # Map, Radio, Lobby, CatchDialog, HUD
│   │   ├── hooks/             # useGeolocation, useSocket, useRadio
│   │   ├── pages/ or app/     # Pages & Routing
│   │   └── styles/            # CSS & Tailwind
├── server/                    # Node.js + Socket.IO backend service
│   ├── src/
│   │   ├── engine/            # StateMachine, Proximity, ReleaseScheduler
│   │   ├── handlers/          # Socket event handlers
│   │   ├── services/          # RoomService, MatchService, RadioService
│   │   ├── storage/           # LocalStorageAdapter, AudioStorage
│   │   └── types/             # Shared TypeScript schemas & contracts
├── package.json               # Monorepo root workspace configuration
└── README.md
```
