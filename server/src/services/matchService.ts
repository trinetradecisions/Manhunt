import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { canTransitionState } from '../engine/stateMachine.js';
import {
  validateCatchProximity,
  checkPlayZoneBoundary,
  checkVelocitySanity,
  calculateHaversineDistance,
} from '../engine/geo.js';
import {
  CatchAttempt,
  MatchSummary,
  PlayerLocation,
  RoomState,
  ScheduledRunnerSnapshot,
  DynamicZoneState,
  ScoreLedger,
} from '../types/game.js';
import { RoomService } from './roomService.js';
import { PlayerStatsService } from './playerStatsService.js';
import { ScoringService } from './scoringService.js';
import { MissionService } from './missionService.js';
import { VoiceService } from './voiceService.js';

export class MatchService {
  private io: Server;
  private roomService: RoomService;
  private playerStatsService?: PlayerStatsService;
  public scoringService: ScoringService;
  public missionService: MissionService;
  private voiceService?: VoiceService;
  private matchIntervals: Map<string, NodeJS.Timeout> = new Map();
  private snapshotIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pendingCatches: Map<string, CatchAttempt> = new Map();
  private failedCodeAttempts: Map<string, { count: number; lastAttempt: number }> = new Map();
  private catchCodeRequests: Map<string, number> = new Map(); // runnerId -> lastRequestTime

  public setVoiceService(voiceService: VoiceService): void {
    this.voiceService = voiceService;
  }

  constructor(
    io: Server,
    roomService: RoomService,
    playerStatsService?: PlayerStatsService,
    scoringService?: ScoringService,
    missionService?: MissionService
  ) {
    this.io = io;
    this.roomService = roomService;
    this.playerStatsService = playerStatsService;
    this.scoringService = scoringService || new ScoringService();
    this.missionService = missionService || new MissionService(this.scoringService);
  }

  public startMatch(
    roomCode: string,
    initiatorId: string
  ): { success: boolean; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const initiator = room.members[initiatorId];
    if (!initiator || room.hostId !== initiatorId) {
      return { success: false, error: 'Only Host can start the match' };
    }

    const runners = Object.values(room.members).filter((m) => m.team === 'RUNNERS');
    const chasers = Object.values(room.members).filter((m) => m.team === 'CHASERS');

    if (runners.length === 0 || chasers.length === 0) {
      return {
        success: false,
        error: 'Match requires at least one Runner and one Chaser assigned',
      };
    }

    const check = canTransitionState(room.state, 'READY_CHECK', 'HOST');
    if (!check.allowed && room.state !== 'LOBBY') {
      return { success: false, error: check.reason };
    }

    // Begin with 5-second countdown
    room.state = 'COUNTDOWN';
    this.broadcastRoomState(room);

    // Reset distance tracker for all participating members
    if (this.playerStatsService) {
      for (const m of Object.values(room.members)) {
        this.playerStatsService.resetCurrentMatchDistance(m.id);
      }
    }

    let countdownSeconds = 5;
    const countdownTimer = setInterval(() => {
      countdownSeconds -= 1;
      this.io.to(roomCode).emit('match:countdown_tick', {
        remainingSeconds: countdownSeconds,
      });

      if (countdownSeconds <= 0) {
        clearInterval(countdownTimer);
        this.transitionToHeadStart(room);
      }
    }, 1000);

    return { success: true };
  }

  private transitionToHeadStart(room: RoomState): void {
    room.state = 'RUNNER_HEADSTART';

    const now = Date.now();
    const headStartMs = room.config.globalHeadStartSeconds * 1000;
    const matchDurationMs = room.config.durationSeconds * 1000;

    let dynamicZoneState: DynamicZoneState | undefined;
    if (room.config.dynamicZone?.enabled) {
      const dz = room.config.dynamicZone;
      const initialR = dz.initialRadiusMeters || room.config.playZone.radiusMeters || 500;
      const minR = dz.minRadiusMeters || 100;
      const shrinkPct = Math.min(90, Math.max(5, dz.shrinkPercentage || 20));
      const nextR = Math.max(minR, Math.round(initialR * (1 - shrinkPct / 100)));
      const delayMs = (dz.initialDelaySeconds || 0) * 1000;
      const intervalMs = (dz.shrinkIntervalSeconds || 180) * 1000;
      const warnMs = (dz.warningDurationSeconds || 30) * 1000;
      const firstShrinkAt = now + headStartMs + delayMs + intervalMs;
      const firstWarningAt = firstShrinkAt - warnMs;

      dynamicZoneState = {
        currentRadiusMeters: initialR,
        nextRadiusMeters: nextR,
        currentPhase: 1,
        nextShrinkAt: firstShrinkAt,
        warningAt: firstWarningAt,
        isWarningActive: false,
        isFinalZone: initialR <= minR,
      };
    }

    const scoreLedger = this.scoringService.createEmptyLedger(room.members);

    room.match = {
      startedAt: now,
      headStartEndsAt: now + headStartMs,
      gameStartedAt: now + headStartMs,
      gameEndsAt: now + headStartMs + matchDurationMs,
      totalDurationSeconds: room.config.durationSeconds,
      remainingSeconds: room.config.durationSeconds,
      totalPausedSeconds: 0,
      catches: [],
      dynamicZoneState,
      scoreLedger,
      activeMissions: {},
      completedMissions: [],
    };

    // Initialize individual runner missions
    this.missionService.initializeMatchMissions(room);

    const codeExpirySec = room.config.missions?.catchCodeExpirySeconds || 300;
    for (const m of Object.values(room.members)) {
      m.isCaught = false;
      m.isEliminated = false;
      delete m.caughtAt;
      if (m.team === 'RUNNERS') {
        if (!m.catchCode || (m.catchCodeExpiresAt && m.catchCodeExpiresAt <= now)) {
          m.catchCode = crypto.randomInt(1000, 10000).toString();
          m.catchCodeExpiresAt = now + codeExpirySec * 1000;
        }
        if (room.config.individualHeadStarts?.[m.id]) {
          m.individualHeadStartSeconds = room.config.individualHeadStarts[m.id];
        }
      } else {
        delete m.catchCode;
        delete m.catchCodeExpiresAt;
      }
    }

    this.broadcastRoomState(room);
    this.startActiveMatchLoop(room);
  }

  private startActiveMatchLoop(room: RoomState): void {
    this.clearRoomTimers(room.roomCode);

    const interval = setInterval(() => {
      if (!room.match) return;

      if (room.state === 'SAFETY_PAUSED') {
        return; // Timers suspended while paused
      }

      const now = Date.now();

      // Head-start phase timing
      if (room.state === 'RUNNER_HEADSTART') {
        const remainingHeadStart = Math.max(
          0,
          Math.floor((room.match.headStartEndsAt - now) / 1000)
        );

        // Transition from HEADSTART to ACTIVE when head start deadline passes
        if (now >= room.match.headStartEndsAt) {
          room.state = 'ACTIVE';
          this.io.to(room.roomCode).emit('match:alert', {
            type: 'INFO',
            title: 'Chasers Released!',
            message: 'The chase has officially begun. Evade and survive!',
            timestamp: now,
          });
          this.broadcastRoomState(room);

          // Start server-scheduled 120-second runner location snapshots to chasers
          this.startScheduledSnapshots(room);
        }
        return;
      }

      // Active hunt phase timing
      if (room.state === 'ACTIVE') {
        const remaining = Math.max(
          0,
          Math.ceil((room.match.gameEndsAt - now) / 1000)
        );
        room.match.remainingSeconds = remaining;

        // Dynamic Shrinking Play Zone Progression
        if (room.config.dynamicZone?.enabled && room.match.dynamicZoneState) {
          const dzState = room.match.dynamicZoneState;
          const dzConfig = room.config.dynamicZone;

          if (!dzState.isFinalZone) {
            // Check warning threshold
            if (now >= dzState.warningAt && !dzState.isWarningActive) {
              dzState.isWarningActive = true;
              const secToShrink = Math.max(0, Math.ceil((dzState.nextShrinkAt - now) / 1000));
              this.io.to(room.roomCode).emit('dynamic_zone:warning', {
                secondsRemaining: secToShrink,
                currentRadiusMeters: dzState.currentRadiusMeters,
                nextRadiusMeters: dzState.nextRadiusMeters,
                phase: dzState.currentPhase,
              });
              this.io.to(room.roomCode).emit('match:alert', {
                type: 'BOUNDARY_WARNING',
                title: 'ZONE SHRINKING IN 30 SECONDS',
                message: `Safe boundary shrinking to ${dzState.nextRadiusMeters}m! Move inwards!`,
                timestamp: now,
              });
            }

            // Check shrink execution threshold
            if (now >= dzState.nextShrinkAt) {
              dzState.currentRadiusMeters = dzState.nextRadiusMeters;
              dzState.currentPhase += 1;
              dzState.isWarningActive = false;

              const minR = dzConfig.minRadiusMeters || 100;
              const shrinkPct = Math.min(90, Math.max(5, dzConfig.shrinkPercentage || 20));
              const upcomingR = Math.max(minR, Math.round(dzState.currentRadiusMeters * (1 - shrinkPct / 100)));
              dzState.nextRadiusMeters = upcomingR;

              if (dzState.currentRadiusMeters <= minR) {
                dzState.isFinalZone = true;
                this.io.to(room.roomCode).emit('match:alert', {
                  type: 'BOUNDARY_WARNING',
                  title: 'FINAL ZONE ACTIVE',
                  message: `Zone reached minimum safe radius of ${minR}m!`,
                  timestamp: now,
                });
              } else {
                const intervalMs = (dzConfig.shrinkIntervalSeconds || 180) * 1000;
                const warnMs = (dzConfig.warningDurationSeconds || 30) * 1000;
                dzState.nextShrinkAt = now + intervalMs;
                dzState.warningAt = dzState.nextShrinkAt - warnMs;
              }

              this.io.to(room.roomCode).emit('dynamic_zone:shrink', {
                currentRadiusMeters: dzState.currentRadiusMeters,
                nextRadiusMeters: dzState.nextRadiusMeters,
                phase: dzState.currentPhase,
                isFinalZone: dzState.isFinalZone,
              });

              this.broadcastRoomState(room);
            }
          }
        }

        // Check survival milestones for active runners
        const completedMilestones = this.missionService.checkSurvivalMilestones(room);
        if (completedMilestones.length > 0) {
          for (const cm of completedMilestones) {
            this.io.to(room.roomCode).emit('match:alert', {
              type: 'INFO',
              title: 'SURVIVAL MILESTONE REACHED',
              message: `${cm.playerNickname} achieved survival milestone (+${cm.rewardIndividual} Solo / +${cm.rewardTeam} Team)!`,
              timestamp: now,
            });
          }
          this.broadcastRoomState(room);
        }

        // Check chaser patrol / control milestones
        this.checkChaserMilestones(room, now);

        this.io.to(room.roomCode).emit('match:tick', {
          remainingSeconds: remaining,
          gameEndsAt: room.match.gameEndsAt,
          phase: 'ACTIVE',
        });

        // Time expiration victory check
        if (remaining <= 0) {
          this.endMatch(room, undefined, 'Time expired! Match finished.');
        }
      }
    }, 1000);

    this.matchIntervals.set(room.roomCode, interval);
  }

  /**
   * Starts the server-authoritative 120-second runner location snapshot scheduler.
   */
  private startScheduledSnapshots(room: RoomState): void {
    if (this.snapshotIntervals.has(room.roomCode)) {
      clearInterval(this.snapshotIntervals.get(room.roomCode)!);
    }

    const intervalSec = room.config.runnerSnapshotIntervalSeconds || 120;

    // Send first snapshot immediately upon active hunt start
    this.executeScheduledRunnerSnapshot(room);

    const snapshotInterval = setInterval(() => {
      if (room.state !== 'ACTIVE') return;
      this.executeScheduledRunnerSnapshot(room);
    }, intervalSec * 1000);

    this.snapshotIntervals.set(room.roomCode, snapshotInterval);
  }

  /**
   * Executes a scheduled runner snapshot and dispatches exclusively to Chasers and Referees.
   */
  public executeScheduledRunnerSnapshot(room: RoomState): void {
    if (room.state !== 'ACTIVE' || !room.match) return;

    const now = Date.now();
    const intervalSec = room.config.runnerSnapshotIntervalSeconds || 120;
    const nextExpected = now + intervalSec * 1000;

    const activeRunners = Object.values(room.members).filter(
      (m) => m.team === 'RUNNERS' && !m.isCaught && m.lastLocation
    );

    // Only include readings that are fresh (<= 45 seconds old) and valid
    const runnersData = activeRunners
      .filter((r) => {
        const ageSec = (now - r.lastLocation!.timestamp) / 1000;
        return ageSec <= 45;
      })
      .map((r) => ({
        playerId: r.id,
        nickname: r.nickname,
        latitude: r.lastLocation!.latitude,
        longitude: r.lastLocation!.longitude,
        accuracy: r.lastLocation!.accuracy,
        snapshotAgeSeconds: Math.floor((now - r.lastLocation!.timestamp) / 1000),
      }));

    const snapshot: ScheduledRunnerSnapshot = {
      snapshotTimestamp: now,
      nextExpectedSnapshotAt: nextExpected,
      intervalSeconds: intervalSec,
      runners: runnersData,
    };

    room.match.lastScheduledSnapshot = snapshot;

    // Dispatch strictly to Chasers and Referees (Runners do not need chaser radar snapshots)
    for (const member of Object.values(room.members)) {
      if (member.team === 'CHASERS' || member.role === 'REFEREE') {
        this.io.to(member.socketId).emit('location:scheduled_snapshot', snapshot);
      }
    }
  }

  public updatePlayerLocation(
    roomCode: string,
    playerId: string,
    location: PlayerLocation
  ): void {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return;

    const member = room.members[playerId];
    if (!member) return;

    // Validate coordinate integrity & reject invalid timestamps
    if (
      !location ||
      typeof location.latitude !== 'number' ||
      typeof location.longitude !== 'number' ||
      isNaN(location.latitude) ||
      isNaN(location.longitude) ||
      location.latitude < -90 ||
      location.latitude > 90 ||
      location.longitude < -180 ||
      location.longitude > 180 ||
      !location.timestamp ||
      (member.lastLocation && location.timestamp <= member.lastLocation.timestamp)
    ) {
      return;
    }

    // Velocity sanity check: reject impossible GPS jumps (> ~43.2 km/h)
    if (member.lastLocation && !checkVelocitySanity(member.lastLocation, location)) {
      return;
    }

    member.lastLocation = location;
    member.gpsStatus = 'GRANTED';

    // Record authoritative GPS distance with jitter & jump filtering
    if (this.playerStatsService) {
      this.playerStatsService.recordLocation(
        playerId,
        location,
        room.state === 'ACTIVE',
        member.nickname
      );
    }

    // Evaluate active runner mission progress
    if (
      (room.state === 'ACTIVE' || room.state === 'RUNNER_HEADSTART') &&
      member.team === 'RUNNERS' &&
      !member.isCaught &&
      !member.isEliminated
    ) {
      const evalRes = this.missionService.evaluateMissionProgress(room, playerId, location);
      if (evalRes.completedMissions.length > 0) {
        for (const cm of evalRes.completedMissions) {
          this.io.to(room.roomCode).emit('match:alert', {
            type: 'INFO',
            title: 'MISSION ACCOMPLISHED',
            message: `Runner ${cm.playerNickname} completed [${cm.title}]! (+${cm.rewardIndividual} Solo / +${cm.rewardTeam} Team)`,
            timestamp: Date.now(),
          });
        }
        this.broadcastRoomState(room);
      }
    }

    // Evaluate chaser interception objectives if active and enabled
    if (room.state === 'ACTIVE' && room.config.missions?.chaserObjectivesEnabled !== false) {
      this.evaluateChaserInterceptions(room, playerId);
    }

    // Teammate live coordinate sync (Runners see Runners; Chasers see Chasers)
    // Server guarantees Chasers NEVER get raw runner updates here!
    if (member.team !== 'NONE') {
      for (const m of Object.values(room.members)) {
        if (m.id !== member.id && (m.team === member.team || m.role === 'REFEREE')) {
          this.io.to(m.socketId).emit('location:teammate_update', {
            playerId: member.id,
            nickname: member.nickname,
            team: member.team,
            location: member.lastLocation,
          });
        }
      }
    }

    // Boundary check during active match (enforcing dynamic shrinking radius if enabled)
    if (room.state === 'ACTIVE' || room.state === 'RUNNER_HEADSTART') {
      const activeZone = (room.config.dynamicZone?.enabled && room.match?.dynamicZoneState)
        ? {
            ...room.config.playZone,
            radiusMeters: room.match.dynamicZoneState.currentRadiusMeters,
          }
        : room.config.playZone;

      const boundary = checkPlayZoneBoundary(location, activeZone);
      const accuracyBuffer = typeof location.accuracy === 'number' ? location.accuracy : 15;
      const effectiveDistanceOutside = boundary.distanceToBoundary - accuracyBuffer / 2;

      if (boundary.isApproachingBoundary) {
        this.io.to(member.socketId).emit('match:alert', {
          type: 'BOUNDARY_WARNING',
          title: 'Approaching Boundary',
          message: `You are within ${Math.round(boundary.distanceToBoundary)}m of the boundary edge!`,
          timestamp: Date.now(),
        });
      } else if (!boundary.isInside && effectiveDistanceOutside > 0) {
        this.io.to(member.socketId).emit('match:alert', {
          type: 'BOUNDARY_WARNING',
          title: 'OUT OF BOUNDS!',
          message: room.config.dynamicZone?.enabled
            ? `You are outside the shrinking safe zone (${activeZone.radiusMeters}m). Return immediately!`
            : 'You have left the designated play area. Return immediately!',
          timestamp: Date.now(),
        });
      }
    }
  }

  public attemptCatch(
    roomCode: string,
    chaserId: string,
    targetRunnerId: string
  ): { success: boolean; attempt?: CatchAttempt; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.state !== 'ACTIVE')
      return { success: false, error: 'Catch attempts only allowed when active' };

    const chaser = room.members[chaserId];
    const runner = room.members[targetRunnerId];

    if (!chaser || chaser.team !== 'CHASERS') {
      return { success: false, error: 'Only chasers can attempt catches' };
    }
    if (!runner || runner.team !== 'RUNNERS') {
      return { success: false, error: 'Target must be an active runner' };
    }
    if (runner.isCaught) {
      return { success: false, error: 'Runner is already caught' };
    }

    if (!chaser.lastLocation || !runner.lastLocation) {
      return {
        success: false,
        error: 'Recent location readings required for both players',
      };
    }

    const validation = validateCatchProximity(
      chaser.lastLocation,
      runner.lastLocation,
      room.config.catchProximityThresholdMeters
    );

    if (!validation.isValid) {
      return {
        success: false,
        error: `Too far! Distance is ${Math.round(validation.rawDistance)}m (Max: ${room.config.catchProximityThresholdMeters}m)`,
      };
    }

    const attempt: CatchAttempt = {
      id: uuidv4(),
      chaserId,
      chaserNickname: chaser.nickname,
      runnerId: targetRunnerId,
      runnerNickname: runner.nickname,
      distanceMeters: Math.round(validation.rawDistance),
      timestamp: Date.now(),
      status: 'PENDING',
      verificationType: 'PROXIMITY_CONFIRMED',
    };

    this.pendingCatches.set(attempt.id, attempt);

    // Notify runner with confirmation prompt
    this.io.to(runner.socketId).emit('catch:pending', attempt);
    // Notify chaser that attempt is registered
    this.io.to(chaser.socketId).emit('catch:pending', attempt);

    return { success: true, attempt };
  }

  public requestCatchCode(
    roomCode: string,
    runnerId: string
  ): { success: boolean; catchCode?: string; expiresAt?: number; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.state !== 'ACTIVE' && room.state !== 'RUNNER_HEADSTART') {
      return { success: false, error: 'Match is not active' };
    }

    const runner = room.members[runnerId];
    if (!runner || runner.team !== 'RUNNERS' || runner.isCaught || runner.isEliminated) {
      return { success: false, error: 'Only active uncaught runners can generate catch codes' };
    }

    const now = Date.now();
    // Return existing code if still valid (stable code during validity window)
    if (runner.catchCode && runner.catchCodeExpiresAt && runner.catchCodeExpiresAt > now) {
      return {
        success: true,
        catchCode: runner.catchCode,
        expiresAt: runner.catchCodeExpiresAt,
      };
    }

    const lastRequest = this.catchCodeRequests.get(runnerId) || 0;
    // Rate-limit catch code generation to once every 3s
    if (now - lastRequest < 3000) {
      return { success: false, error: 'Please wait a moment before requesting a new code' };
    }
    this.catchCodeRequests.set(runnerId, now);

    const code = crypto.randomInt(1000, 10000).toString();
    const expirySec = room.config.missions?.catchCodeExpirySeconds || 300;
    const expiresAt = now + expirySec * 1000;

    runner.catchCode = code;
    runner.catchCodeExpiresAt = expiresAt;

    return {
      success: true,
      catchCode: code,
      expiresAt,
    };
  }

  public attemptCatchWithCode(
    roomCode: string,
    chaserId: string,
    targetRunnerId: string,
    catchCode: string
  ): { success: boolean; attempt?: CatchAttempt; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.state !== 'ACTIVE') {
      return { success: false, error: 'Catches only allowed during active match' };
    }

    const chaser = room.members[chaserId];
    const runner = room.members[targetRunnerId];

    if (!chaser || chaser.team !== 'CHASERS') {
      return { success: false, error: 'Only chasers can tag runners' };
    }
    if (!runner || runner.team !== 'RUNNERS') {
      return { success: false, error: 'Target must be a runner' };
    }
    if (runner.isCaught || runner.isEliminated) {
      return { success: false, error: 'Runner already tagged or eliminated' };
    }

    // Rate limiting & lockout check (3 failed attempts -> 30s lockout)
    const failKey = `${chaserId}:${targetRunnerId}`;
    const failInfo = this.failedCodeAttempts.get(failKey) || { count: 0, lastAttempt: 0 };
    const now = Date.now();

    if (failInfo.count >= 3 && now - failInfo.lastAttempt < 30000) {
      const waitSec = Math.ceil((30000 - (now - failInfo.lastAttempt)) / 1000);
      return {
        success: false,
        error: `Too many failed attempts! Locked out for ${waitSec}s`,
      };
    }

    // Validate catch code
    if (!runner.catchCode || runner.catchCode !== catchCode.trim()) {
      failInfo.count += 1;
      failInfo.lastAttempt = now;
      this.failedCodeAttempts.set(failKey, failInfo);
      return { success: false, error: 'Incorrect Catch Code. Verification failed.' };
    }

    // Check catch code expiration
    if (runner.catchCodeExpiresAt && now > runner.catchCodeExpiresAt) {
      failInfo.count += 1;
      failInfo.lastAttempt = now;
      this.failedCodeAttempts.set(failKey, failInfo);
      return { success: false, error: 'Catch Code has expired. Ask the runner to refresh their code.' };
    }

    // Optional GPS Proximity Check if enabled in host configuration
    let measuredDistance = 0;
    if (room.config.missions?.catchRequiresGpsProximity) {
      if (!chaser.lastLocation || !runner.lastLocation) {
        return {
          success: false,
          error: 'GPS proximity required, but recent location is missing for one or both players',
        };
      }

      const freshnessSec = room.config.missions.catchGpsFreshnessSeconds || 30;
      if (
        now - chaser.lastLocation.timestamp > freshnessSec * 1000 ||
        now - runner.lastLocation.timestamp > freshnessSec * 1000
      ) {
        return {
          success: false,
          error: `GPS observations are too stale for proximity verification (> ${freshnessSec}s)`,
        };
      }

      measuredDistance = calculateHaversineDistance(
        chaser.lastLocation.latitude,
        chaser.lastLocation.longitude,
        runner.lastLocation.latitude,
        runner.lastLocation.longitude
      );

      const catchRadius = room.config.missions.catchRadiusMeters || room.config.catchProximityThresholdMeters || 15;
      const chaserAcc = chaser.lastLocation.accuracy || 15;
      const runnerAcc = runner.lastLocation.accuracy || 15;
      const effectiveThreshold = catchRadius + (chaserAcc + runnerAcc) / 2;

      if (measuredDistance > effectiveThreshold) {
        return {
          success: false,
          error: `Too far! Distance is ${Math.round(measuredDistance)}m (required within ${catchRadius}m)`,
        };
      }
    }

    // Code and proximity validated! Clear failure record
    this.failedCodeAttempts.delete(failKey);

    const attempt: CatchAttempt = {
      id: uuidv4(),
      chaserId,
      chaserNickname: chaser.nickname,
      runnerId: targetRunnerId,
      runnerNickname: runner.nickname,
      distanceMeters: Math.round(measuredDistance),
      timestamp: now,
      status: 'CONFIRMED',
      verificationType: 'CODE_VERIFIED',
    };

    this.resolveConfirmedCatch(attempt, room);
    return { success: true, attempt };
  }

  public answerLandmarkClue(
    roomCode: string,
    playerId: string,
    answer: string
  ): { success: boolean; completed?: boolean; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.state !== 'ACTIVE') return { success: false, error: 'Match is not active' };

    const member = room.members[playerId];
    if (!member || member.team !== 'RUNNERS' || member.isCaught || member.isEliminated) {
      return { success: false, error: 'Only active runners can solve landmark clues' };
    }

    const mission = room.match?.activeMissions?.[playerId];
    if (!mission || mission.type !== 'LANDMARK_RECON') {
      return { success: false, error: 'No active Landmark Recon mission found' };
    }

    if (!mission.landmarkClue || !mission.landmarkClue.answer) {
      return { success: false, error: 'Mission does not require a clue answer' };
    }

    const expected = mission.landmarkClue.answer.trim().toLowerCase();
    const provided = answer.trim().toLowerCase();

    if (provided !== expected) {
      return { success: false, completed: false, error: 'Incorrect clue answer. Try again!' };
    }

    // Verify presence at landmark if targetLocation exists
    if (member.lastLocation && mission.targetLocation) {
      const targetLat = mission.targetLocation.latitude ?? mission.targetLocation.lat;
      const targetLng = mission.targetLocation.longitude ?? mission.targetLocation.lng;
      const dist = calculateHaversineDistance(
        member.lastLocation.latitude,
        member.lastLocation.longitude,
        targetLat,
        targetLng
      );
      const radius = mission.targetRadiusMeters || 30;
      const acc = member.lastLocation.accuracy || 15;
      if (dist > radius + acc) {
        return {
          success: false,
          error: `You must be within ${radius}m of the landmark to submit! Current distance: ${Math.round(dist)}m`,
        };
      }
    }

    mission.progress = 100;
    mission.status = 'COMPLETED';

    const completed = this.missionService.completeMission(room, mission);

    this.io.to(room.roomCode).emit('match:alert', {
      type: 'INFO',
      title: 'LANDMARK RECON SOLVED',
      message: `${member.nickname} solved [${mission.title}]! (+${mission.rewardIndividual} Solo / +${mission.rewardTeam} Team)`,
      timestamp: Date.now(),
    });

    this.broadcastRoomState(room);
    return { success: true, completed: true };
  }

  public respondCatch(
    attemptId: string,
    runnerId: string,
    response: 'CONFIRM' | 'DISPUTE'
  ): { success: boolean; error?: string } {
    const attempt = this.pendingCatches.get(attemptId);
    if (!attempt) return { success: false, error: 'Catch attempt not found' };
    if (attempt.runnerId !== runnerId)
      return { success: false, error: 'Unauthorized to respond to this catch' };

    const room = this.findRoomByMemberId(runnerId);
    if (!room) return { success: false, error: 'Room not found' };

    if (response === 'CONFIRM') {
      attempt.status = 'CONFIRMED';
      this.resolveConfirmedCatch(attempt, room);
    } else {
      attempt.status = 'DISPUTED';
      this.io.to(room.roomCode).emit('catch:resolved', {
        catchAttemptId: attempt.id,
        runnerId: attempt.runnerId,
        runnerNickname: attempt.runnerNickname,
        status: 'DISPUTED',
      });
    }

    this.pendingCatches.delete(attemptId);
    return { success: true };
  }

  public overrideCatch(
    roomCode: string,
    actorId: string,
    attemptId: string,
    decision: 'CONFIRM' | 'DISMISS'
  ): { success: boolean; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const actor = room.members[actorId];
    if (!actor || (actor.role !== 'HOST' && actor.role !== 'REFEREE')) {
      return { success: false, error: 'Only Host or Referee can override catches' };
    }

    const attempt = this.pendingCatches.get(attemptId);
    if (!attempt) return { success: false, error: 'Catch attempt not found' };

    if (decision === 'CONFIRM') {
      attempt.status = 'CONFIRMED';
      attempt.verificationType = 'REFEREE_OVERRIDE';
      attempt.resolvedBy = actor.nickname;
      this.resolveConfirmedCatch(attempt, room);
    } else {
      attempt.status = 'DISMISSED';
      this.io.to(room.roomCode).emit('catch:resolved', {
        catchAttemptId: attempt.id,
        status: 'DISMISSED',
        resolvedBy: actor.nickname,
      });
    }

    this.pendingCatches.delete(attemptId);
    return { success: true };
  }

  /**
   * Evaluates host-configurable chaser interception objectives.
   * Awards points when a chaser closes within 25m of a runner who is actively at/contesting their mission objective.
   * Keyed idempotently per chaser, runner, and runner mission ID to prevent duplicate scoring.
   */
  public evaluateChaserInterceptions(room: RoomState, movingMemberId: string): void {
    if (!room.match || !room.match.scoreLedger) return;
    if (room.config.missions?.chaserObjectivesEnabled === false) return;

    const movingMember = room.members[movingMemberId];
    if (!movingMember || !movingMember.lastLocation) return;

    const matchId = room.match.startedAt ? `match-${room.match.startedAt}` : 'match';
    const rewardInd = room.config.missions?.rewardInterception?.individual ?? 25;
    const rewardTeam = room.config.missions?.rewardInterception?.team ?? 25;

    const chasers =
      movingMember.team === 'CHASERS'
        ? [movingMember]
        : Object.values(room.members).filter(
            (m) => m.team === 'CHASERS' && !m.isEliminated && m.lastLocation
          );

    const runners =
      movingMember.team === 'RUNNERS'
        ? [movingMember]
        : Object.values(room.members).filter(
            (m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated && m.lastLocation
          );

    let awardedAny = false;

    for (const chaser of chasers) {
      if (!chaser.lastLocation) continue;
      for (const runner of runners) {
        if (!runner.lastLocation) continue;
        const activeMission = room.match.activeMissions?.[runner.id];
        if (!activeMission || !activeMission.targetLocation) continue;

        const targetLat =
          activeMission.targetLocation.latitude ?? (activeMission.targetLocation as any).lat;
        const targetLng =
          activeMission.targetLocation.longitude ?? (activeMission.targetLocation as any).lng;
        if (typeof targetLat !== 'number' || typeof targetLng !== 'number') continue;

        // Check if runner is currently at/contesting objective
        const distRunnerToTarget = calculateHaversineDistance(
          runner.lastLocation.latitude,
          runner.lastLocation.longitude,
          targetLat,
          targetLng
        );
        const missionRadius = (activeMission.targetRadiusMeters || 30) + 10;
        const isRunnerAtObjective = activeMission.isInRadius || distRunnerToTarget <= missionRadius;

        if (!isRunnerAtObjective) continue;

        // Check physical distance between chaser and runner
        const distChaserToRunner = calculateHaversineDistance(
          chaser.lastLocation.latitude,
          chaser.lastLocation.longitude,
          runner.lastLocation.latitude,
          runner.lastLocation.longitude
        );

        if (distChaserToRunner <= 25) {
          const idempotencyKey = `chaser-intercept:${matchId}:${chaser.id}:${runner.id}:${activeMission.id}`;
          const awardRes = this.scoringService.awardPoints({
            ledger: room.match.scoreLedger,
            playerId: chaser.id,
            playerNickname: chaser.nickname,
            team: 'CHASERS',
            pointsIndividual: rewardInd,
            pointsTeam: rewardTeam,
            type: 'INTERCEPTION',
            reason: `Chaser ${chaser.nickname} intercepted runner ${runner.nickname} at [${activeMission.title}]`,
            idempotencyKey,
          });

          if (awardRes.success && !awardRes.alreadyAwarded) {
            awardedAny = true;
            this.io.to(room.roomCode).emit('match:alert', {
              type: 'INFO',
              title: 'OBJECTIVE INTERCEPTED!',
              message: `Chaser ${chaser.nickname} disrupted ${runner.nickname} at [${activeMission.title}]! (+${rewardInd} Solo / +${rewardTeam} Chaser Team)`,
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    if (awardedAny) {
      this.broadcastRoomState(room);
    }
  }

  /**
   * Evaluates host-configurable chaser control/patrol milestones (default: every 5 minutes of active match).
   * Idempotently awarded per active chaser per milestone step so points survive reconnects and restarts.
   */
  public checkChaserMilestones(room: RoomState, now: number): void {
    if (!room.match || !room.match.scoreLedger) return;
    if (room.config.missions?.chaserObjectivesEnabled === false) return;
    if (room.state !== 'ACTIVE') return;

    const matchId = room.match.startedAt ? `match-${room.match.startedAt}` : 'match';
    const intervalSec = room.config.missions?.chaserMilestoneSeconds || 300;
    const elapsedSec = Math.floor((now - (room.match.gameStartedAt || room.match.startedAt)) / 1000);
    if (elapsedSec < intervalSec) return;

    const currentStep = Math.floor(elapsedSec / intervalSec);
    const rewardInd = room.config.missions?.rewardChaserMilestone?.individual ?? 25;
    const rewardTeam = room.config.missions?.rewardChaserMilestone?.team ?? 25;

    const activeChasers = Object.values(room.members).filter(
      (m) => m.team === 'CHASERS' && !m.isEliminated
    );

    let awardedAny = false;
    for (const chaser of activeChasers) {
      for (let step = 1; step <= currentStep; step++) {
        const idempotencyKey = `chaser-milestone:${matchId}:${chaser.id}:${step}`;
        const awardRes = this.scoringService.awardPoints({
          ledger: room.match.scoreLedger,
          playerId: chaser.id,
          playerNickname: chaser.nickname,
          team: 'CHASERS',
          pointsIndividual: rewardInd,
          pointsTeam: rewardTeam,
          type: 'CHASER_MILESTONE',
          reason: `Chaser Patrol Milestone ${step} (${Math.round((step * intervalSec) / 60)} min) - ${chaser.nickname}`,
          idempotencyKey,
        });

        if (awardRes.success && !awardRes.alreadyAwarded) {
          awardedAny = true;
          this.io.to(chaser.socketId).emit('match:alert', {
            type: 'INFO',
            title: 'CHASER MILESTONE REACHED',
            message: `Territory patrol milestone ${step} achieved! (+${rewardInd} Solo / +${rewardTeam} Team)`,
            timestamp: now,
          });
        }
      }
    }

    if (awardedAny) {
      this.broadcastRoomState(room);
    }
  }

  private resolveConfirmedCatch(attempt: CatchAttempt, attemptRoom: RoomState): void {
    const runner = attemptRoom.members[attempt.runnerId];
    if (runner) {
      runner.isCaught = true;
      runner.caughtAt = Date.now();
      delete runner.catchCode;
      delete runner.catchCodeExpiresAt;
    }

    if (attemptRoom.match) {
      attemptRoom.match.catches.push(attempt);

      // Award individual and team points to chasers
      const rewardInd = attemptRoom.config.missions?.catchReward?.individual ?? attemptRoom.config.missions?.rewardCatchIndividual ?? 100;
      const rewardTeam = attemptRoom.config.missions?.catchReward?.team ?? attemptRoom.config.missions?.rewardCatchTeam ?? 100;
      if (attemptRoom.match.scoreLedger) {
        this.scoringService.awardPoints({
          ledger: attemptRoom.match.scoreLedger,
          idempotencyKey: `catch-${attempt.id}`,
          playerId: attempt.chaserId,
          playerNickname: attempt.chaserNickname,
          team: 'CHASERS',
          pointsIndividual: rewardInd,
          pointsTeam: rewardTeam,
          type: 'CATCH_AWARD',
          reason: `Catch confirmed for runner ${attempt.runnerNickname}`,
        });
      }

      // Remove runner's active mission
      if (attemptRoom.match.activeMissions?.[attempt.runnerId]) {
        delete attemptRoom.match.activeMissions[attempt.runnerId];
      }
    }

    // Apply host's configured caught-runner rule
    const caughtRule = attemptRoom.config.missions?.caughtRunnerRule || 'CONVERT_TO_CHASER';
    if (runner) {
      if (caughtRule === 'CONVERT_TO_CHASER') {
        runner.team = 'CHASERS';
        runner.role = 'CHASER';
        // Sever old squad voice channel so they don't overhear runners and join chaser squad cleanly
        if (this.voiceService) {
          this.voiceService.leaveVoiceChannel(attemptRoom.roomCode, runner.id);
        }
      } else if (caughtRule === 'ELIMINATE') {
        runner.isEliminated = true;
      }
    }

    this.io.to(attemptRoom.roomCode).emit('catch:resolved', {
      catchAttemptId: attempt.id,
      runnerId: attempt.runnerId,
      runnerNickname: attempt.runnerNickname,
      status: 'CAUGHT',
      verificationType: attempt.verificationType || 'CODE_VERIFIED',
      resolvedBy: attempt.resolvedBy || attempt.chaserNickname,
      newRole: runner?.role,
      newTeam: runner?.team,
      isEliminated: runner?.isEliminated,
    });

    this.io.to(attemptRoom.roomCode).emit('match:alert', {
      type: 'CATCH_CONFIRMED',
      title: 'RUNNER CAUGHT!',
      message: `${attempt.chaserNickname} tagged ${attempt.runnerNickname}! ${
        caughtRule === 'CONVERT_TO_CHASER'
          ? `${attempt.runnerNickname} has joined the Chasers!`
          : `${attempt.runnerNickname} is eliminated!`
      }`,
      timestamp: Date.now(),
    });

    // Check early-end rule: All runners caught?
    const remainingRunners = Object.values(attemptRoom.members).filter(
      (m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated
    );

    const earlyEndEnabled = attemptRoom.config.missions?.allRunnersCaughtEndsMatch ?? true;
    if (remainingRunners.length === 0 && earlyEndEnabled) {
      this.endMatch(
        attemptRoom,
        'CHASERS',
        'All runners caught! Chasers win!'
      );
    } else {
      this.broadcastRoomState(attemptRoom);
    }
  }

  public safetyPause(
    roomCode: string,
    initiatorId: string,
    reason?: string
  ): { success: boolean; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const initiator = room.members[initiatorId];
    if (!initiator || (initiator.role !== 'HOST' && initiator.role !== 'REFEREE')) {
      return { success: false, error: 'Only Host or Referee can pause' };
    }

    if (room.state === 'SAFETY_PAUSED') {
      return { success: false, error: 'Match already paused' };
    }

    room.state = 'SAFETY_PAUSED';
    if (room.match) {
      room.match.pausedAt = Date.now();
    }

    this.io.to(roomCode).emit('match:alert', {
      type: 'SAFETY_PAUSE',
      title: 'EMERGENCY / SAFETY PAUSE',
      message:
        reason ||
        `Game frozen by ${initiator.nickname}. Stop running and check your surroundings!`,
      timestamp: Date.now(),
    });

    this.broadcastRoomState(room);
    return { success: true };
  }

  public resumeMatch(
    roomCode: string,
    initiatorId: string
  ): { success: boolean; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const initiator = room.members[initiatorId];
    if (!initiator || initiator.role !== 'HOST') {
      return { success: false, error: 'Only Host can resume match' };
    }

    if (room.state !== 'SAFETY_PAUSED') {
      return { success: false, error: 'Match is not paused' };
    }

    if (room.match && room.match.pausedAt) {
      const pausedDurationMs = Date.now() - room.match.pausedAt;
      room.match.headStartEndsAt += pausedDurationMs;
      room.match.gameStartedAt += pausedDurationMs;
      room.match.gameEndsAt += pausedDurationMs;
      room.match.totalPausedSeconds += Math.floor(pausedDurationMs / 1000);
      delete room.match.pausedAt;
    }

    // Return to appropriate phase (HEADSTART vs ACTIVE)
    const now = Date.now();
    if (room.match && now < room.match.headStartEndsAt) {
      room.state = 'RUNNER_HEADSTART';
    } else {
      room.state = 'ACTIVE';
    }

    this.io.to(roomCode).emit('match:alert', {
      type: 'INFO',
      title: 'Match Resumed',
      message: 'Safety pause lifted. Gameplay is active!',
      timestamp: Date.now(),
    });

    this.broadcastRoomState(room);
    return { success: true };
  }

  public endMatch(
    room: RoomState,
    forcedWinner?: 'RUNNERS' | 'CHASERS' | 'DRAW',
    announcement?: string
  ): void {
    this.clearRoomTimers(room.roomCode);

    room.state = 'COMPLETED';

    const remainingRunners = Object.values(room.members).filter(
      (m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated
    );

    let winner = forcedWinner;
    if (!winner && room.match?.scoreLedger) {
      winner = this.scoringService.determineWinner(
        room.match.scoreLedger,
        remainingRunners.length,
        room.config.missions
      );
    }
    if (!winner) {
      winner = 'DRAW';
    }

    if (room.match) {
      room.match.winnerTeam = winner;
      room.match.remainingSeconds = 0;

      if (room.match.scoreLedger) {
        this.scoringService.awardVictoryBonus(
          room.match.scoreLedger,
          winner,
          room.members,
          room.config.missions
        );
      }
    }

    // Authoritative match outcome & stats recording
    if (this.playerStatsService && room.match) {
      const duration = Math.max(0, Math.round((Date.now() - room.match.gameStartedAt) / 1000));
      this.playerStatsService.recordMatchOutcome(
        room.roomCode,
        room.match.startedAt.toString(),
        duration,
        winner,
        Object.values(room.members).map((m) => ({
          id: m.id,
          nickname: m.nickname,
          role: m.role,
          team: m.team,
          isCaught: m.isCaught,
        }))
      );
    }

    const finalMsg =
      announcement ||
      (winner === 'DRAW'
        ? 'Match ended in a DRAW!'
        : `${winner} VICTORY! Match complete.`);

    this.io.to(room.roomCode).emit('match:alert', {
      type: 'VICTORY',
      title: 'GAME OVER',
      message: finalMsg,
      timestamp: Date.now(),
    });

    this.broadcastRoomState(room);
  }

  public clearRoomTimers(roomCode: string): void {
    if (this.matchIntervals.has(roomCode)) {
      clearInterval(this.matchIntervals.get(roomCode)!);
      this.matchIntervals.delete(roomCode);
    }
    if (this.snapshotIntervals.has(roomCode)) {
      clearInterval(this.snapshotIntervals.get(roomCode)!);
      this.snapshotIntervals.delete(roomCode);
    }
  }

  public broadcastRoomState(room: RoomState): void {
    for (const member of Object.values(room.members)) {
      const sanitized = this.roomService.getSanitizedRoomView(room, member.id);
      this.io.to(member.socketId).emit('room:state', sanitized);
    }
  }

  private findRoomByMemberId(memberId: string): RoomState | undefined {
    return this.roomService.findRoomByMemberId(memberId);
  }
}
