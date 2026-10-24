# Security Threat Model

## 1. Threat Matrix & Mitigations

| Threat Vector | Attack Scenario | Impact | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **Room Code Brute-Force** | Attacker iterates 4-letter or 6-letter room codes to eavesdrop or disrupt matches. | Unauthorized room access | Cryptographically random 6-character alphanumeric space ($32^6 \approx 10^9$ combinations); strict IP-based rate limiting on room join attempts (max 10 failed joins per minute per IP). |
| **Impersonation & Session Hijacking** | Player mimics host or teammate by spoofing `playerId` in socket payloads. | Unauthorized state mutations | Cryptographic player session token generated on join; server validates session token on every socket event and API request. |
| **GPS Spoofing & Impossible Teleportation** | Malicious chaser sends fake coordinates right on top of a runner. | Fraudulent catch trigger | Velocity sanity checks: server rejects updates implying ground speed $> 35 \text{ km/h}$ (sprint limit); catch attempts require corroborating runner confirmation or dynamic runner-side catch code. |
| **Cross-Room / Cross-Team Leakage** | Player listens on Socket.IO broadcast channels to intercept opponent coordinates or radio audio. | Game-breaking unfair advantage | Strict room and team socket channel segregation. Sensitive location pings are unicast or room-team scoped. Server-side authorization check before dispatching every payload. |
| **Malicious Audio Uploads** | Attacker uploads oversized or executable files to `/api/radio/upload`. | Server disk exhaustion or RCE | Strict MIME type verification (`audio/webm`, `audio/ogg`, `audio/mp4`), file size cap (max 2MB), magic number verification, and rate limiting (max 1 upload per 10 seconds per player). |
| **Safety Pause Denial-of-Service** | Disgruntled runner spams safety pause to stall the match. | Game disruption | Only Host and designated Referee can trigger safety pauses. All pause events are audited with player identity. |
| **Raw Coordinate Retention** | Database or log leak exposes historical real-world movement paths of participants. | Real-world stalking / privacy violation | Coordinates are kept only in ephemeral room memory during active matches. No persistent database logging of raw lat/lng breadcrumbs. Automatic memory cleanup on room termination. |
