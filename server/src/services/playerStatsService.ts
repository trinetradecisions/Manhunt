import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerLocation, PlayerStats, MatchHistoryRecord, PlayerRole, PlayerTeam } from '../types/game.js';
import { calculateHaversineDistance } from '../engine/geo.js';

const isServerless = Boolean(
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.VERCEL_REGION ||
  process.env.NOW_REGION ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  (process.env.NODE_ENV === 'production' && !process.env.MANHUNT_STANDALONE)
);

const STATS_FILE = isServerless
  ? path.join('/tmp', 'manhunt', 'data', 'player_stats.json')
  : path.join(__dirname, '../../data/player_stats.json');

// GPS validation constraints
const MAX_VALID_ACCURACY_METERS = 35; // Readings with worse accuracy are ignored for distance accumulation
const MAX_FEASIBLE_SPEED_MPS = 12.0;   // ~43.2 km/h - max human sprint/cycling speed
const MIN_JITTER_THRESHOLD_METERS = 3.0; // Stationary jitter filter: movements < 3m ignored unless speed > 1 m/s

export class PlayerStatsService {
  private stats: Map<string, PlayerStats> = new Map();
  private lastAcceptedLocations: Map<string, PlayerLocation> = new Map();

  constructor() {
    this.loadStats();
  }

  private loadStats(): void {
    try {
      const dataDir = path.dirname(STATS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (fs.existsSync(STATS_FILE)) {
        const raw = fs.readFileSync(STATS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const [id, stat] of Object.entries(parsed)) {
          this.stats.set(id, stat as PlayerStats);
        }
      }
    } catch (err) {
      console.warn('[PlayerStatsService] Error loading player stats from disk:', err);
    }
  }

  public saveStats(): void {
    try {
      const dataDir = path.dirname(STATS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const obj: Record<string, PlayerStats> = {};
      for (const [id, stat] of this.stats.entries()) {
        obj[id] = stat;
      }
      fs.writeFileSync(STATS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[PlayerStatsService] Error saving player stats to disk:', err);
    }
  }

  /**
   * Retrieves or initializes stats for a given player ID.
   */
  public getOrCreateStats(playerId: string, nickname?: string): PlayerStats {
    let stat = this.stats.get(playerId);
    if (!stat) {
      stat = {
        playerId,
        nickname: nickname || `Operative_${playerId.slice(-4)}`,
        totalDistanceMeters: 0,
        currentMatchDistanceMeters: 0,
        totalPlaytimeSeconds: 0,
        matchesPlayed: 0,
        matchesWon: 0,
        timesCaught: 0,
        escapes: 0,
        matchHistory: [],
      };
      this.stats.set(playerId, stat);
    } else if (nickname && stat.nickname !== nickname) {
      stat.nickname = nickname;
    }
    return stat;
  }

  /**
   * Resets the current match distance for all players entering a new match.
   */
  public resetCurrentMatchDistance(playerId: string): void {
    const stat = this.getOrCreateStats(playerId);
    stat.currentMatchDistanceMeters = 0;
    this.lastAcceptedLocations.delete(playerId);
  }

  /**
   * Authoritative GPS position evaluation and distance accumulator.
   * Filters out:
   * 1. Duplicate or backwards timestamps
   * 2. Invalid coordinates (NaN or out of bounds)
   * 3. Poor-accuracy readings (> 35m)
   * 4. Teleportation / implausible jumps (> 12 m/s)
   * 5. Stationary GPS jitter (< 3m)
   */
  public recordLocation(
    playerId: string,
    location: PlayerLocation,
    isMatchActive: boolean,
    nickname?: string
  ): { distanceAdded: number; accepted: boolean; reason?: string } {
    if (
      !location ||
      typeof location.latitude !== 'number' ||
      typeof location.longitude !== 'number' ||
      isNaN(location.latitude) ||
      isNaN(location.longitude) ||
      location.latitude < -90 ||
      location.latitude > 90 ||
      location.longitude < -180 ||
      location.longitude > 180
    ) {
      return { distanceAdded: 0, accepted: false, reason: 'Invalid coordinate values' };
    }

    const stat = this.getOrCreateStats(playerId, nickname);
    const lastLoc = this.lastAcceptedLocations.get(playerId);

    if (!lastLoc) {
      this.lastAcceptedLocations.set(playerId, location);
      return { distanceAdded: 0, accepted: true };
    }

    // 1. Ignore duplicate or backwards timestamps
    const timeDeltaMs = location.timestamp - lastLoc.timestamp;
    if (timeDeltaMs <= 0) {
      return { distanceAdded: 0, accepted: false, reason: 'Duplicate or backwards timestamp' };
    }

    const timeDeltaSec = timeDeltaMs / 1000;

    // 2. Reject poor-accuracy readings for distance accumulation
    if (typeof location.accuracy === 'number' && location.accuracy > MAX_VALID_ACCURACY_METERS) {
      return { distanceAdded: 0, accepted: false, reason: 'Accuracy exceeds threshold' };
    }

    // 3. Calculate distance via Haversine
    const distanceMeters = calculateHaversineDistance(
      lastLoc.latitude,
      lastLoc.longitude,
      location.latitude,
      location.longitude
    );

    // 4. Check for implausible movement speed (GPS jump / car / spoofing)
    const speedMps = distanceMeters / timeDeltaSec;
    if (speedMps > MAX_FEASIBLE_SPEED_MPS && distanceMeters > 20) {
      return {
        distanceAdded: 0,
        accepted: false,
        reason: `Implausible speed: ${speedMps.toFixed(1)} m/s`,
      };
    }

    // 5. Stationary GPS jitter filter: do not accumulate tiny movements < 3m
    if (distanceMeters < MIN_JITTER_THRESHOLD_METERS) {
      // Still update the timestamp so we don't get artificial leaps later
      lastLoc.timestamp = location.timestamp;
      return { distanceAdded: 0, accepted: true, reason: 'Stationary jitter filtered' };
    }

    // Accepted valid movement!
    stat.totalDistanceMeters += distanceMeters;
    if (isMatchActive) {
      stat.currentMatchDistanceMeters += distanceMeters;
    }
    this.lastAcceptedLocations.set(playerId, location);

    return { distanceAdded: distanceMeters, accepted: true };
  }

  /**
   * Finalizes match statistics for all participating members when a match completes.
   */
  public recordMatchOutcome(
    roomCode: string,
    matchId: string,
    durationSeconds: number,
    winnerTeam: 'RUNNERS' | 'CHASERS' | 'DRAW',
    members: Array<{
      id: string;
      nickname: string;
      role: PlayerRole;
      team: PlayerTeam;
      isCaught?: boolean;
    }>
  ): void {
    const timestamp = Date.now();

    for (const m of members) {
      if (m.team === 'NONE') continue; // Spectators or unassigned do not log match stats

      const stat = this.getOrCreateStats(m.id, m.nickname);
      stat.matchesPlayed += 1;
      stat.totalPlaytimeSeconds += durationSeconds;

      const won = m.team === winnerTeam;
      if (won) {
        stat.matchesWon += 1;
      }

      if (m.team === 'RUNNERS') {
        if (m.isCaught) {
          stat.timesCaught += 1;
        } else {
          stat.escapes += 1;
        }
      }

      const historyRecord: MatchHistoryRecord = {
        matchId,
        roomCode,
        role: m.role,
        team: m.team,
        won,
        distanceMeters: Math.round(stat.currentMatchDistanceMeters),
        durationSeconds,
        timestamp,
      };

      if (!stat.matchHistory) {
        stat.matchHistory = [];
      }
      stat.matchHistory.unshift(historyRecord);
      if (stat.matchHistory.length > 20) {
        stat.matchHistory.pop();
      }
    }

    this.saveStats();
  }

  /**
   * Clear tracked location state when a player leaves or disconnects.
   */
  public clearPlayerTracking(playerId: string): void {
    this.lastAcceptedLocations.delete(playerId);
  }
}
