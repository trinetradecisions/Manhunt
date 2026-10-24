# REA Evidence Ledger

This ledger records all primary and secondary evidence collected during the reverse engineering and competitor analysis phase.

---

## Evidence Entry EVD-001: Hunting Game Primary Website & Rules
- **Target URL**: `https://www.hunting-game.com/`, `https://www.hunting-game.com/how-to-play-manhunt-in-real-life`, `https://www.hunting-game.com/privacy-policy`
- **Method of Inspection**: Live HTTP content extraction via REA `read_url_content` and HTML structure parsing.
- **Timestamp**: 2026-10-24T09:20:00+05:30
- **Confidence Level**: High (Direct primary public disclosure & web application source)
- **Verified Observations**:
  1. **Game Roles & Setup**: Requires at least 1 chaser and 1 runner. Game lobby supports 2-4 players (free tier) and up to 20 (Pro). Uses 6-character room code.
  2. **Location Transmission**: Chasers receive periodic runner coordinates at a configured interval. Runners do *not* receive full map positions of chasers; instead, runners have a directional compass pointing toward nearby chasers.
  3. **Catch Mechanism**: When a chaser catches up to a runner, the chaser asks the runner for a dynamic **catch code** displayed on the runner's phone and enters it into the chaser's app. Physical tackling/contact is discouraged/not required.
  4. **Boundary & Zones**: Configurable circular Play Zone with center and radius. Instructions explicitly mandate keeping busy roads, water, railways, and private property outside the zone.
  5. **Modes**: Classic Manhunt, Family mode (adds a Referee role with full god-mode map visibility), and Hide and Seek (Pro mode with runners hiding in a zone with zero GPS updates).
  6. **Power-ups**: 5 distinct power-ups: Stealth (hide next ping), Map (temporary reveal), Scan (force ping), Decoy (fake location), Blackout (blind opponent map).
  7. **Location Privacy & Retention**: Live locations, route history, and chat messages are permanently purged from database/storage ~5 minutes after game ends. Tracking ceases when game terminates. Spectator web view (`/spectate`) requires room join code.
- **Limitations & Unknowns**: Native background GPS continuous update mechanism on iOS/Android uses OS background location services; mobile web browser background tracking is constrained by browser lifecycle suspension.

---

## Evidence Entry EVD-002: SCRAM: Hide and Seek
- **Target Source**: App Store disclosures, public documentation & release notes (`scramhideandseek.com`).
- **Method of Inspection**: Structured web retrieval of verified product specifications.
- **Timestamp**: 2026-10-24T09:20:25+05:30
- **Confidence Level**: High (Verified public app documentation)
- **Verified Observations**:
  1. **Head Start Mechanic**: Runners receive a customizable scatter timer before hunters are released.
  2. **Pings with Staleness**: Hunters receive periodic GPS pings with a relative timestamp indicator ("recorded X seconds ago") to indicate data staleness.
  3. **Information Asymmetry**: Hunters see runner pings periodically; runners never see hunters on their map, sustaining suspense.
  4. **Boundary Violation Penalty**: 30-second grace countdown when stepping outside bounds; if uncorrected, the runner's live GPS location is continuously broadcast to hunters as a penalty.
  5. **Audio & Alert Stealth**: Uses subtle haptic vibration patterns instead of audible ringtones to avoid revealing runner hiding spots.
  6. **Team Walkie-Talkie**: Integrated push-to-talk voice channel segregated by team.
  7. **Catch Confirmation**: In-person tag with a runner-side "I got tagged" confirmation button.

---

## Evidence Entry EVD-003: GeoHunt
- **Target Source**: Public product descriptions and game rule repositories.
- **Method of Inspection**: Structured web retrieval and feature cross-examination.
- **Timestamp**: 2026-10-24T09:20:30+05:30
- **Confidence Level**: Medium-High (Verified published mechanics)
- **Verified Observations**:
  1. **Play Zone Enclosure**: Circular boundary with host selection.
  2. **Head Start**: 2-5 minute grace period for scattering before chase commences.
  3. **Catch Verification**: Dual options: proximity-based tag (<10-20m server threshold) and unique 6-digit catch code verification to prevent false long-range claims.
  4. **Role Elimination**: Jailed or flipped into hunter upon verified catch.

---

## Evidence Entry EVD-004: Manhunt IRL
- **Target Source**: Apple App Store listing and `manhuntgame.com` web portal.
- **Method of Inspection**: Structured web search and public app profile inspection.
- **Timestamp**: 2026-10-24T09:20:40+05:30
- **Confidence Level**: High (Verified application documentation)
- **Verified Observations**:
  1. **Zero-Install Web Access**: Host can run app; other players join via 4-character join code or QR code directly inside a mobile web browser with guest nickname (no account creation required).
  2. **Fuzzy GPS Privacy**: Instead of exact coordinate pins, hunters see fuzzy uncertainty circles to encourage visual search rather than nose-in-screen navigation.
  3. **Heartbeat Proximity Haptics**: Uses progressive haptic vibration pulses (e.g., at 80m, 50m, 25m) without directional pointers, giving visceral tension.
  4. **Jail & Jailbreak Mechanics**: Tagged runners enter a designated Jail point; free runners can trigger a 5-second physical hold to release jailed teammates.
  5. **Anti-Cheat Validation**: Server validates tag proximity against reported accuracy radii.

---

## Evidence Entry EVD-005: Convaya
- **Target Source**: `convaya.com` public web platform.
- **Method of Inspection**: Public geo-gaming platform documentation.
- **Timestamp**: 2026-10-24T09:20:45+05:30
- **Confidence Level**: High (Verified public documentation)
- **Verified Observations**:
  1. **Browser-Native Architecture**: Operates 100% in mobile/desktop browser without native app downloads.
  2. **Multi-Mode Modular Framework**: Shared spatial engine supporting Tag, Manhunt, Infection, Capture the Flag, Territory Control, and Checkpoints.
  3. **Instant Join Flow**: Guest name entry into active room without friction.

---

## Evidence Entry EVD-006: Can You See Me Now? (Blast Theory)
- **Target Source**: Blast Theory archives and Mixed Reality Lab (University of Nottingham) published research.
- **Method of Inspection**: Historical analysis of public mixed-reality documentation.
- **Timestamp**: 2026-10-24T09:20:50+05:30
- **Confidence Level**: High (Academic & artistic historical record)
- **Verified Observations**:
  1. **Audio Immersion**: Physical street runners broadcast live walkie-talkie audio. Pursued players listen to the breath, footsteps, and tactical calls of pursuers.
  2. **Virtual Catch Radius**: Catch registered when physical GPS coordinates match player coordinates within a <5m server threshold.
  3. **Psychological Tension**: Audio communication combined with delayed spatial positioning yields intense engagement even with low-frequency spatial updates.
