import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { canTransitionState } from '../engine/stateMachine.js';
import { validateCatchProximity, checkPlayZoneBoundary } from '../engine/geo.js';
import {
  CatchAttempt,
  MatchSummary,
  PlayerLocation,
  RoomState,
} from '../types/game.js';
import { RoomService } from './roomService.js';

export class MatchService {
  private io: Server;
  private roomService: RoomService;
  private matchIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pendingCatches: Map<string, CatchAttempt> = new Map();
  private failedCodeAttempts: Map<string, { count: number; lastAttempt: number }> = new Map();

  constructor(io: Server, roomService: RoomService) {
    this.io = io;
    this.roomService = roomService;
  }

  public startMatch(
    roomCode: string,
    initiatorId: string
  ): { success: boolean; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const initiator = room.members[initiatorId];
    if (!initiator || initiator.role !== 'HOST') {
      return { success: false, error: 'Only Host can start the match' };
    }

    const runners = Object.values(room.members).filter((m) => m.team === 'RUNNERS');
    const chasers = Object.values(room.members).filter((m) => m.team === 'CHASERS');

    if (runners.length === 0 || chasers.length === 0) {
      return {
        success: false,
        error: 'Match requires at least one Runner and one Chaser',
      };
    }

    const check = canTransitionState(room.state, 'READY_CHECK', 'HOST');
    if (!check.allowed && room.state !== 'LOBBY') {
      return { success: false, error: check.reason };
    }

    // Begin with 5-second countdown
    room.state = 'COUNTDOWN';
    this.broadcastRoomState(room);

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

    room.match = {
      startedAt: now,
      endsAt: now + headStartMs + matchDurationMs,
      totalDurationSeconds: room.config.durationSeconds,
      remainingSeconds: room.config.durationSeconds,
      totalPausedSeconds: 0,
      catches: [],
    };

    // Reset member caught states and setup individual head starts
    for (const m of Object.values(room.members)) {
      m.isCaught = false;
      delete m.caughtAt;
      if (m.team === 'RUNNERS' && room.config.individualHeadStarts?.[m.id]) {
        m.individualHeadStartSeconds = room.config.individualHeadStarts[m.id];
      }
    }

    this.broadcastRoomState(room);
    this.startActiveMatchLoop(room);
  }

  private startActiveMatchLoop(room: RoomState): void {
    if (this.matchIntervals.has(room.roomCode)) {
      clearInterval(this.matchIntervals.get(room.roomCode)!);
    }

    let lastPingTime = 0;

    const interval = setInterval(() => {
      if (!room.match) return;

      if (room.state === 'SAFETY_PAUSED') {
        return; // Timers suspended
      }

      const now = Date.now();
      const elapsedSinceStart = (now - room.match.startedAt) / 1000;
      const headStartSeconds = room.config.globalHeadStartSeconds;

      // Transition from HEADSTART to ACTIVE when head start expires
      if (
        room.state === 'RUNNER_HEADSTART' &&
        elapsedSinceStart >= headStartSeconds
      ) {
        room.state = 'ACTIVE';
        this.io.to(room.roomCode).emit('match:alert', {
          type: 'INFO',
          title: 'Chasers Released!',
          message: 'The chase has officially begun. Evade and survive!',
          timestamp: now,
        });
        this.broadcastRoomState(room);
      }

      // Check remaining match time
      if (room.state === 'ACTIVE') {
        const remaining = Math.max(
          0,
          Math.floor((room.match.endsAt - now) / 1000)
        );
        room.match.remainingSeconds = remaining;

        // Periodic location ping emission to chasers
        if (now - lastPingTime >= room.config.pingIntervalSeconds * 1000) {
          lastPingTime = now;
          this.emitFilteredLocationPings(room);
        }

        // Time expiration victory check
        if (remaining <= 0) {
          this.endMatch(room, 'RUNNERS', 'Time expired! Runners survived the hunt.');
        }
      }
    }, 1000);

    this.matchIntervals.set(room.roomCode, interval);
  }

  private emitFilteredLocationPings(room: RoomState): void {
    const runners = Object.values(room.members).filter(
      (m) => m.team === 'RUNNERS' && !m.isCaught && m.lastLocation
    );

    const now = Date.now();
    const pings = runners.map((r) => ({
      playerId: r.id,
      nickname: r.nickname,
      latitude: r.lastLocation!.latitude,
      longitude: r.lastLocation!.longitude,
      accuracy: r.lastLocation!.accuracy,
      ageSeconds: Math.floor((now - r.lastLocation!.timestamp) / 1000),
    }));

    // Send only to chasers and referees
    for (const member of Object.values(room.members)) {
      if (member.team === 'CHASERS' || member.role === 'REFEREE') {
        this.io.to(member.socketId).emit('location:batch_pings', { pings });
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

    // Validate coordinate integrity
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
      return;
    }

    member.lastLocation = location;
    member.gpsStatus = 'GRANTED';

    // Boundary check during active match
    if (room.state === 'ACTIVE' || room.state === 'RUNNER_HEADSTART') {
      const boundary = checkPlayZoneBoundary(location, room.config.playZone);
      if (boundary.isApproachingBoundary) {
        this.io.to(member.socketId).emit('match:alert', {
          type: 'BOUNDARY_WARNING',
          title: 'Approaching Boundary',
          message: `You are within ${Math.round(boundary.distanceToBoundary)}m of the boundary edge!`,
          timestamp: Date.now(),
        });
      } else if (!boundary.isInside) {
        this.io.to(member.socketId).emit('match:alert', {
          type: 'BOUNDARY_WARNING',
          title: 'OUT OF BOUNDS!',
          message: 'You have left the Play Zone. Return immediately!',
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

  public attemptCatchWithCode(
    roomCode: string,
    chaserId: string,
    targetRunnerId: string,
    catchCode: string
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

    // Rate limiting: 3 failed attempts lockout for 30s
    const throttleKey = `${chaserId}:${targetRunnerId}`;
    const throttle = this.failedCodeAttempts.get(throttleKey);
    const now = Date.now();
    if (throttle && throttle.count >= 3 && now - throttle.lastAttempt < 30000) {
      const waitSec = Math.ceil((30000 - (now - throttle.lastAttempt)) / 1000);
      return {
        success: false,
        error: `Too many failed code attempts. Locked out for ${waitSec}s`,
      };
    }

    if (!runner.catchCode || runner.catchCode !== catchCode.trim()) {
      const currentCount = (throttle?.count || 0) + 1;
      this.failedCodeAttempts.set(throttleKey, {
        count: currentCount,
        lastAttempt: now,
      });
      return {
        success: false,
        error: `Incorrect Catch Code (${3 - (currentCount % 3 || 3)} attempts remaining)`,
      };
    }

    // Correct code: reset throttle
    this.failedCodeAttempts.delete(throttleKey);

    const attempt: CatchAttempt = {
      id: uuidv4(),
      chaserId,
      chaserNickname: chaser.nickname,
      runnerId: targetRunnerId,
      runnerNickname: runner.nickname,
      distanceMeters: 0, // In-person code verified
      timestamp: Date.now(),
      status: 'CONFIRMED',
      verificationType: 'CODE_VERIFIED',
      resolvedBy: chaser.nickname,
    };

    this.pendingCatches.set(attempt.id, attempt);
    this.finalizeCatch(attempt, room);

    return { success: true, attempt };
  }

  public respondCatch(
    attemptId: string,
    runnerId: string,
    response: 'CONFIRM' | 'DISPUTE'
  ): { success: boolean; error?: string } {
    const attempt = this.pendingCatches.get(attemptId);
    if (!attempt) return { success: false, error: 'Catch attempt not found' };
    if (attempt.runnerId !== runnerId) {
      return { success: false, error: 'Unauthorized to respond to this catch' };
    }

    attempt.status = response === 'CONFIRM' ? 'CONFIRMED' : 'DISPUTED';

    if (response === 'CONFIRM') {
      this.finalizeCatch(attempt);
    } else {
      // Disputed: alert host/referee
      this.io.emit('catch:resolved', {
        catchAttemptId: attempt.id,
        runnerId: attempt.runnerId,
        runnerNickname: attempt.runnerNickname,
        status: 'DISPUTED',
        resolvedBy: runnerId,
      });
    }

    return { success: true };
  }

  public overrideCatch(
    roomCode: string,
    actorId: string,
    attemptId: string,
    decision: 'CONFIRMED' | 'REJECTED'
  ): { success: boolean; error?: string } {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    const actor = room.members[actorId];
    if (!actor || (actor.role !== 'HOST' && actor.role !== 'REFEREE')) {
      return { success: false, error: 'Only Host or Referee can override catches' };
    }

    const attempt = this.pendingCatches.get(attemptId);
    if (!attempt) return { success: false, error: 'Catch attempt not found' };

    attempt.resolvedBy = actor.nickname;
    if (decision === 'CONFIRMED') {
      attempt.status = 'CONFIRMED';
      attempt.verificationType = 'REFEREE_OVERRIDE';
      this.finalizeCatch(attempt, room);
    } else {
      attempt.status = 'DISMISSED';
      this.io.to(roomCode).emit('catch:resolved', {
        catchAttemptId: attempt.id,
        runnerId: attempt.runnerId,
        runnerNickname: attempt.runnerNickname,
        status: 'DISMISSED',
        resolvedBy: actor.nickname,
      });
    }

    return { success: true };
  }

  private finalizeCatch(attempt: CatchAttempt, roomState?: RoomState): void {
    const attemptRoom =
      roomState ||
      Array.from(this.roomService['rooms'].values()).find(
        (r) => r.members[attempt.runnerId]
      );

    if (!attemptRoom) return;

    const runner = attemptRoom.members[attempt.runnerId];
    if (runner) {
      runner.isCaught = true;
      runner.caughtAt = Date.now();
    }

    if (attemptRoom.match) {
      attemptRoom.match.catches.push(attempt);
    }

    this.io.to(attemptRoom.roomCode).emit('catch:resolved', {
      catchAttemptId: attempt.id,
      runnerId: attempt.runnerId,
      runnerNickname: attempt.runnerNickname,
      status: 'CAUGHT',
      verificationType: attempt.verificationType || 'PROXIMITY_CONFIRMED',
      resolvedBy: attempt.resolvedBy || attempt.chaserNickname,
    });

    this.broadcastRoomState(attemptRoom);

    // Victory check: Are all runners caught?
    const remainingRunners = Object.values(attemptRoom.members).filter(
      (m) => m.team === 'RUNNERS' && !m.isCaught
    );

    if (remainingRunners.length === 0) {
      this.endMatch(
        attemptRoom,
        'CHASERS',
        'All runners caught! Chasers win!'
      );
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
      room.match.endsAt += pausedDurationMs;
      room.match.totalPausedSeconds += Math.floor(pausedDurationMs / 1000);
      delete room.match.pausedAt;
    }

    room.state = 'ACTIVE';
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
    winner: 'RUNNERS' | 'CHASERS' | 'DRAW',
    announcement: string
  ): void {
    if (this.matchIntervals.has(room.roomCode)) {
      clearInterval(this.matchIntervals.get(room.roomCode)!);
      this.matchIntervals.delete(room.roomCode);
    }

    room.state = 'COMPLETED';
    if (room.match) {
      room.match.winnerTeam = winner;
      room.match.remainingSeconds = 0;
    }

    this.io.to(room.roomCode).emit('match:alert', {
      type: 'VICTORY',
      title: 'GAME OVER',
      message: announcement,
      timestamp: Date.now(),
    });

    this.broadcastRoomState(room);
  }

  public broadcastRoomState(room: RoomState): void {
    for (const member of Object.values(room.members)) {
      const sanitized = this.roomService.getSanitizedRoomView(room, member.id);
      this.io.to(member.socketId).emit('room:state', sanitized);
    }
  }
}
