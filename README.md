# Manhunt Web

A real-world, mobile-browser-first, GPS multiplayer pursuit game inspired by outdoor hide-and-seek and tactical pursuit games.

---

## Key Features
- **Zero-Install Mobile Play**: Players create and join games directly from their smartphone browser via short 6-character room codes.
- **Server-Authoritative Match Logic**: Release countdowns, head starts, boundary violations, and catch events are validated by the backend.
- **Fair Catch Validation Protocol**: Proximity checks (<25m), runner dynamic catch codes / confirmation dialogs, and referee override.
- **Store-and-Listen Team Radio**: Short, tactical push-to-talk voice bursts with `LISTEN` and `IGNORE` controls, haptic vibration alerts, and visual fallbacks.
- **Emergency Safety Pause**: Instant freeze button for Host and Referee with regroup map guidance.
- **Privacy First**: Ephemeral location handling; zero permanent coordinate storage post-match.

---

## Architecture & Technology Stack
- **Frontend**: Next.js, React, TypeScript, Leaflet, Tailwind CSS, Browser Geolocation & MediaRecorder APIs.
- **Backend**: Node.js, Express, Socket.IO, TypeScript.
- **Storage**: Local filesystem storage adapter with pluggable interface for S3 / Supabase.
- **Testing**: Vitest for unit and integration testing.

---

## Documentation
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

---

## Local Development Quickstart
Refer to setup instructions upon Phase 2 completion.
