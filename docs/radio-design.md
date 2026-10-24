# Team Walkie-Talkie Radio Design

## 1. System Overview
The Team Radio enables tactical walkie-talkie communication between team members using an asynchronous **Store-and-Listen** model:
- Avoids the battery drain, echo, and connection brittleness of full-duplex WebRTC mesh.
- Emulates authentic tactical VHF/UHF tactical radio behavior ("Record message -> Release -> Transmit -> Teammates notified -> Listen or Ignore").

---

## 2. Audio Pipeline Flow
1. **Push-to-Talk Recording**:
   - Player taps and holds or clicks "Record" in the Radio panel.
   - Browser calls `navigator.mediaDevices.getUserMedia({ audio: true })`.
   - `MediaRecorder` encodes audio into `audio/webm;codecs=opus` (or `audio/mp4` on iOS Safari).
   - Maximum duration enforced: 15 seconds (automatic cutoff).
2. **Secure Upload**:
   - Audio blob is posted to `POST /api/radio/upload`.
   - Request includes `roomCode`, `playerId`, and session authorization.
   - Backend verifies sender is an active member of the designated team (Runner or Chaser).
   - Stored in ephemeral local storage or private bucket with unique GUID.
3. **Real-time Dispatch**:
   - Server emits `radio:incoming` event **strictly** to socket connections belonging to teammates in that room.
   - Referees receive all transmissions for match auditing.
   - Opponents receive zero bytes and zero notification metadata.
4. **Receiver Interface**:
   - Teammates receive an alert banner with:
     - Sender nickname.
     - Audio duration.
     - Two high-contrast touch actions: **`LISTEN`** (plays audio immediately) and **`IGNORE`** (dismisses notification).
   - If Vibration API is supported (`navigator.vibrate`), triggers a 3-pulse vibration (`[150, 80, 150, 80, 150]`).
   - If Vibration is unsupported (iOS Safari), the prominent visual banner and sound cue act as the fallback.
5. **Auto-Purge & Retention**:
   - Audio files expire 10 minutes after transmission or immediately when the match concludes.

---

## 3. Storage Adapters
- **Local Dev Adapter**: Files saved in `temp_audio/` within the backend directory and served via authenticated private endpoint.
- **Production Adapter (Extensible Interface)**: Clean interface `AudioStorageProvider` allowing seamless drop-in of Supabase Storage or S3-compatible private buckets with pre-signed URLs.
