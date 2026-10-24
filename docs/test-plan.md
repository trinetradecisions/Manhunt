# Test Plan

## 1. Testing Strategy
Our automated testing strategy covers three layers:
1. **Unit Tests (Vitest)**:
   - Haversine distance calculations and accuracy threshold tolerance.
   - Server-side Game State Machine transitions and permission guards.
   - Individual head-start calculation engine.
   - Catch validation rules (boundary, distance, role verification).
2. **Integration Tests (Supertest + Socket.IO Client)**:
   - Room creation, 6-character code uniqueness, rate-limiting.
   - Multi-client lobby join, readiness check, role assignment.
   - Match lifecycle transitions: Countdown -> Runner Headstart -> Active -> Safety Pause -> Completed.
   - Radio audio upload validation, teammate-only dispatch, and unauthorized access rejection.
3. **End-to-End Simulation**:
   - Multi-session simulated match with 1 Host, 2 Runners, 2 Chasers.
   - Verifying chasers cannot see runner coordinates until release and ping intervals.
   - Catch attempt trigger and runner confirmation flow.

---

## 2. Test Execution Matrix

| Test Suite | File Path | Scope |
| :--- | :--- | :--- |
| **Geo Engine Tests** | `server/test/geo.test.ts` | Haversine formula, boundary crossing, uncertainty buffers. |
| **State Machine Tests** | `server/test/stateMachine.test.ts` | State transitions, unauthorized transition rejection, pause/resume time delta preservation. |
| **Room & Match Tests** | `server/test/room.test.ts` | Room creation, guest sessions, role permissions, readiness. |
| **Catch Validation Tests** | `server/test/catch.test.ts` | Proximity check, runner confirmation, referee override, duplicate prevention. |
| **Radio Service Tests** | `server/test/radio.test.ts` | Audio MIME checks, size limits, team isolation, cleanup. |
