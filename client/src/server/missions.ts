import {
  ActiveMission,
  SharedMission,
  GameConfig,
  MapPoint,
  MissionCheckpoint,
  MissionsConfig,
  MissionTemplateType,
  MissionDifficulty,
  PlayerLocation,
  PlayerMember,
  PlayZone,
  RoomState,
} from '../types/game';
import {
  calculateHaversineDistance,
  generateRandomPointInZone,
} from './geo';
import { ScoringService } from './scoring';

function randomId(prefix = 'm'): string {
  return `${prefix}_` + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
}

export class MissionService {
  private scoringService: ScoringService;
  // Track consecutive GPS observation times per mission to calculate stay time accurately
  private lastStayVerificationTime: Map<string, number> = new Map();

  constructor(scoringService: ScoringService) {
    this.scoringService = scoringService;
  }

  public getDefaultConfig(): MissionsConfig {
    return {
      enabled: true,
      enabledMissionTypes: [
        'SECURE_POINT',
        'CHECKPOINT_RUN',
        'SURVIVAL_MILESTONE',
        'CLOSE_ENCOUNTER',
        'LANDMARK_RECON',
      ],
      difficultyWeights: {
        easy: 45,
        medium: 35,
        hard: 20,
      },
      rewards: {
        securePoint: { individual: 100, team: 100 },
        checkpointRun: { individual: 150, team: 150 },
        survivalMilestone: { individual: 50, team: 50 },
        closeEncounter: { individual: 150, team: 150 },
        landmarkRecon: { individual: 100, team: 100 },
      },
      securePointRadiusMeters: 25,
      securePointDurationSeconds: 90,
      securePointLeaveBehavior: 'RESET',
      checkpointCount: 3,
      checkpointDeadlineSeconds: 480,
      survivalMilestoneSeconds: 300,
      closeEncounterDistanceMeters: 50,
      closeEncounterDurationSeconds: 60,
      landmarkRadiusMeters: 25,
      catchCodeExpirySeconds: 30,
      catchRequiresGpsProximity: false,
      catchGpsFreshnessSeconds: 30,
      caughtRunnerRule: 'CONVERT_TO_CHASER',
      catchReward: { individual: 100, team: 100 },
      winningTeamBonus: 500,
      winningIndividualBonus: 100,
      earlyEndAllRunnersCaught: true,
      tieBreakerRule: 'DRAW',
      chaserObjectivesEnabled: true,
      rewardInterception: { individual: 25, team: 25 },
      rewardChaserMilestone: { individual: 25, team: 25 },
      chaserMilestoneSeconds: 300,
    };
  }

  /**
   * Initializes authoritative shared missions for the entire match.
   * All enabled mission types become shared match objectives visible to all players.
   */
  public initializeSharedMissions(room: RoomState): SharedMission[] {
    if (!room.match) return [];
    const defaultConfig = this.getDefaultConfig();
    const config = { ...defaultConfig, ...(room.config.missions || {}) };
    if (config.enabled === false) {
      room.match.sharedMissions = [];
      return [];
    }

    const rawEnabled = config.enabledTypes || config.enabledMissionTypes || [
      'SECURE_POINT',
      'CHECKPOINT_RUN',
      'SURVIVAL_MILESTONE',
      'CLOSE_ENCOUNTER',
      'LANDMARK_RECON',
    ];
    const enabledTypes = rawEnabled as MissionTemplateType[];

    const activeZone =
      room.config.dynamicZone?.enabled && room.match.dynamicZoneState
        ? {
            ...room.config.playZone,
            radiusMeters: room.match.dynamicZoneState.currentRadiusMeters,
          }
        : room.config.playZone;

    const now = Date.now();
    const matchId = room.match.startedAt.toString();
    const sharedMissions: SharedMission[] = [];

    for (const rawType of enabledTypes) {
      const type: MissionTemplateType =
        rawType === 'SECURE_THE_POINT' ? 'SECURE_POINT' : rawType;
      const missionId = randomId('shared_' + type.toLowerCase());

      switch (type) {
        case 'SECURE_POINT': {
          const pt = generateRandomPointInZone(activeZone, 25);
          const durationSec = config.securePointDurationSeconds || 90;
          const radius = config.securePointRadiusMeters || 25;
          const rewards = config.rewards?.securePoint || { individual: 100, team: 100 };

          sharedMissions.push({
            id: missionId,
            playerId: 'shared',
            playerNickname: 'Runners Team',
            roomCode: room.roomCode,
            matchId,
            type: 'SECURE_POINT',
            templateType: 'SECURE_POINT',
            title: 'Sector Alpha Secure',
            description: `Advance to the designated objective and hold the sector for ${durationSec}s.`,
            difficulty: 'EASY',
            rewardIndividual: rewards.individual,
            rewardTeam: rewards.team,
            assignedAt: now,
            deadlineAt: null,
            targetLocation: pt,
            targetRadiusMeters: radius,
            requiredStaySeconds: durationSec,
            currentStaySeconds: 0,
            stayDurationSeconds: 0,
            stayResetOnDeparture: config.securePointLeaveBehavior !== 'PAUSE',
            progress: 0,
            status: 'ACTIVE',
          });
          break;
        }

        case 'CHECKPOINT_RUN': {
          const count = Math.max(2, Math.min(5, config.checkpointCount || 3));
          const checkpoints: MissionCheckpoint[] = [];
          for (let i = 0; i < count; i++) {
            const pt = generateRandomPointInZone(activeZone, 25);
            checkpoints.push({
              id: `cp_${missionId}_${i + 1}`,
              index: i + 1,
              latitude: pt.lat,
              longitude: pt.lng,
              radiusMeters: 25,
              completed: false,
              isCompleted: false,
            });
          }
          const deadlineSec = config.checkpointDeadlineSeconds || 480;
          const rewards = config.rewards?.checkpointRun || { individual: 150, team: 150 };

          sharedMissions.push({
            id: missionId,
            playerId: 'shared',
            playerNickname: 'Runners Team',
            roomCode: room.roomCode,
            matchId,
            type: 'CHECKPOINT_RUN',
            templateType: 'CHECKPOINT_RUN',
            title: `Checkpoint Sweep (1/${count})`,
            description: `Reach all ${count} tactical checkpoints in numerical sequence.`,
            difficulty: 'MEDIUM',
            rewardIndividual: rewards.individual,
            rewardTeam: rewards.team,
            assignedAt: now,
            deadlineAt: now + deadlineSec * 1000,
            targetLocation: {
              lat: checkpoints[0].latitude,
              lng: checkpoints[0].longitude,
              latitude: checkpoints[0].latitude,
              longitude: checkpoints[0].longitude,
            },
            targetRadiusMeters: 25,
            requiredStaySeconds: 0,
            currentStaySeconds: 0,
            stayDurationSeconds: 0,
            checkpoints,
            currentCheckpointIndex: 0,
            progress: 0,
            status: 'ACTIVE',
          });
          break;
        }

        case 'SURVIVAL_MILESTONE': {
          const milestoneSec = config.survivalMilestoneSeconds || 300;
          const rewards = config.rewards?.survivalMilestone || { individual: 50, team: 50 };

          sharedMissions.push({
            id: missionId,
            playerId: 'shared',
            playerNickname: 'Runners Team',
            roomCode: room.roomCode,
            matchId,
            type: 'SURVIVAL_MILESTONE',
            templateType: 'SURVIVAL_MILESTONE',
            title: 'Tactical Survival Protocol',
            description: `Evade chasers and survive for ${Math.round(milestoneSec / 60)} minutes without being tagged.`,
            difficulty: 'EASY',
            rewardIndividual: rewards.individual,
            rewardTeam: rewards.team,
            assignedAt: now,
            deadlineAt: now + milestoneSec * 1000,
            targetRadiusMeters: 0,
            requiredStaySeconds: milestoneSec,
            currentStaySeconds: 0,
            stayDurationSeconds: 0,
            milestoneMinutes: Math.round(milestoneSec / 60),
            progress: 0,
            status: 'ACTIVE',
          });
          break;
        }

        case 'CLOSE_ENCOUNTER': {
          const dist = config.closeEncounterDistanceMeters || 50;
          const durationSec = config.closeEncounterDurationSeconds || 60;
          const rewards = config.rewards?.closeEncounter || { individual: 150, team: 150 };

          sharedMissions.push({
            id: missionId,
            playerId: 'shared',
            playerNickname: 'Runners Team',
            roomCode: room.roomCode,
            matchId,
            type: 'CLOSE_ENCOUNTER',
            templateType: 'CLOSE_ENCOUNTER',
            title: 'Ghost Operative: Close Encounter',
            description: `Shadow an active chaser within ${dist}m for ${durationSec}s without being tagged!`,
            difficulty: 'HARD',
            rewardIndividual: rewards.individual,
            rewardTeam: rewards.team,
            assignedAt: now,
            deadlineAt: null,
            targetRadiusMeters: dist,
            proximityDistanceMeters: dist,
            requiredStaySeconds: durationSec,
            currentStaySeconds: 0,
            stayDurationSeconds: 0,
            progress: 0,
            status: 'ACTIVE',
          });
          break;
        }

        case 'LANDMARK_RECON': {
          const markers = activeZone.markers || activeZone.bases || [];
          let landmarkPt: MapPoint;
          let landmarkName = 'Strategic Waypoint';
          if (markers.length > 0) {
            const selected = markers[Math.floor(Math.random() * markers.length)];
            landmarkPt = { lat: selected.lat, lng: selected.lng, latitude: selected.lat, longitude: selected.lng };
            landmarkName = selected.label;
          } else {
            landmarkPt = generateRandomPointInZone(activeZone, 25);
            landmarkName = 'Alpha Sector Outpost';
          }

          const code = Math.floor(1000 + Math.random() * 9000).toString();
          const rewards = config.rewards?.landmarkRecon || { individual: 100, team: 100 };

          sharedMissions.push({
            id: missionId,
            playerId: 'shared',
            playerNickname: 'Runners Team',
            roomCode: room.roomCode,
            matchId,
            type: 'LANDMARK_RECON',
            templateType: 'LANDMARK_RECON',
            title: `Recon: ${landmarkName}`,
            description: `Proceed to ${landmarkName} and verify intelligence code.`,
            difficulty: 'MEDIUM',
            rewardIndividual: rewards.individual,
            rewardTeam: rewards.team,
            assignedAt: now,
            deadlineAt: null,
            targetLocation: landmarkPt,
            targetRadiusMeters: config.landmarkRadiusMeters || 25,
            requiredStaySeconds: 0,
            currentStaySeconds: 0,
            stayDurationSeconds: 0,
            progress: 0,
            landmarkClue: {
              name: landmarkName,
              question: `Recon Intel: Enter security confirmation PIN [${code}]`,
              answer: code,
              isAnswered: false,
            },
            status: 'ACTIVE',
          });
          break;
        }
      }
    }

    room.match.sharedMissions = sharedMissions;
    return sharedMissions;
  }

  /**
   * Evaluates all active shared missions against the moving runner's coordinates.
   * If any runner completes a shared mission, it is marked complete for the entire match.
   */
  public evaluateSharedMissions(
    room: RoomState,
    runner: PlayerMember,
    location?: PlayerLocation
  ): { completedMissions: SharedMission[]; allCompleted: boolean } {
    if (!room.match || !room.match.sharedMissions || room.match.sharedMissions.length === 0) {
      return { completedMissions: [], allCompleted: false };
    }
    if (runner.team !== 'RUNNERS' || runner.isCaught || runner.isEliminated) {
      return { completedMissions: [], allCompleted: false };
    }

    const now = location?.timestamp || Date.now();
    const completedList: SharedMission[] = [];

    for (const mission of room.match.sharedMissions) {
      if (mission.status !== 'ACTIVE') continue;

      const rawType = (mission.type || mission.templateType || '').toUpperCase();

      // 1. SECURE_POINT
      if (rawType === 'SECURE_POINT' && location && mission.targetLocation) {
        const targetLat = mission.targetLocation.latitude ?? mission.targetLocation.lat;
        const targetLng = mission.targetLocation.longitude ?? mission.targetLocation.lng;
        const dist = calculateHaversineDistance(
          location.latitude,
          location.longitude,
          targetLat,
          targetLng
        );
        mission.distanceToTargetMeters = Math.round(dist);

        const effectiveDist = Math.max(0, dist - (location.accuracy || 5) / 2);
        const radius = mission.targetRadiusMeters || 25;
        const reqStay = mission.requiredStaySeconds || 90;

        if (effectiveDist <= radius) {
          mission.isInRadius = true;
          const key = `${mission.id}_${runner.id}`;
          const lastVerif = this.lastStayVerificationTime.get(key);
          const deltaSec = lastVerif ? Math.max(0, Math.round((now - lastVerif) / 1000)) : 0;
          this.lastStayVerificationTime.set(key, now);

          mission.currentStaySeconds = (mission.currentStaySeconds || 0) + deltaSec;
          mission.stayDurationSeconds = mission.currentStaySeconds;
          mission.progress = Math.min(100, Math.round((mission.currentStaySeconds / reqStay) * 100));

          if (mission.currentStaySeconds >= reqStay) {
            this.completeSharedMission(room, mission, runner);
            completedList.push(mission);
          }
        } else {
          mission.isInRadius = false;
          if (mission.stayResetOnDeparture) {
            mission.currentStaySeconds = 0;
            mission.stayDurationSeconds = 0;
            mission.progress = 0;
          }
          this.lastStayVerificationTime.delete(`${mission.id}_${runner.id}`);
        }
      }

      // 2. CHECKPOINT_RUN
      else if (rawType === 'CHECKPOINT_RUN' && location && mission.checkpoints && mission.currentCheckpointIndex !== undefined) {
        const currentCp = mission.checkpoints[mission.currentCheckpointIndex];
        if (currentCp) {
          const dist = calculateHaversineDistance(
            location.latitude,
            location.longitude,
            currentCp.latitude,
            currentCp.longitude
          );
          mission.distanceToTargetMeters = Math.round(dist);
          const effectiveDist = Math.max(0, dist - (location.accuracy || 5) / 2);
          const radius = currentCp.radiusMeters || 25;

          if (effectiveDist <= radius) {
            currentCp.completed = true;
            currentCp.isCompleted = true;
            currentCp.completedAt = now;
            mission.currentCheckpointIndex += 1;
            mission.progress = Math.min(
              100,
              Math.round((mission.currentCheckpointIndex / mission.checkpoints.length) * 100)
            );

            if (mission.currentCheckpointIndex >= mission.checkpoints.length) {
              this.completeSharedMission(room, mission, runner);
              completedList.push(mission);
            } else {
              const nextCp = mission.checkpoints[mission.currentCheckpointIndex];
              mission.targetLocation = {
                lat: nextCp.latitude,
                lng: nextCp.longitude,
                latitude: nextCp.latitude,
                longitude: nextCp.longitude,
              };
              mission.title = `Checkpoint Sweep (${mission.currentCheckpointIndex + 1}/${mission.checkpoints.length})`;
            }
          }
        }
      }

      // 3. SURVIVAL_MILESTONE
      else if (rawType === 'SURVIVAL_MILESTONE') {
        const reqStay = mission.requiredStaySeconds || (mission.milestoneMinutes ? mission.milestoneMinutes * 60 : 300);
        const gameStarted = room.match.gameStartedAt || room.match.startedAt;
        const elapsed = Math.max(0, Math.floor((now - gameStarted) / 1000));
        mission.currentStaySeconds = Math.min(reqStay, elapsed);
        mission.stayDurationSeconds = mission.currentStaySeconds;
        mission.progress = Math.min(100, Math.round((mission.currentStaySeconds / reqStay) * 100));

        if (mission.currentStaySeconds >= reqStay) {
          this.completeSharedMission(room, mission, runner);
          completedList.push(mission);
        }
      }

      // 4. CLOSE_ENCOUNTER
      else if (rawType === 'CLOSE_ENCOUNTER' && location) {
        const activeChasers = Object.values(room.members).filter(
          (m) => m.team === 'CHASERS' && m.lastLocation && Math.abs(now - m.lastLocation.timestamp) <= 30000
        );

        let nearestChaserDist = Infinity;
        for (const chaser of activeChasers) {
          const d = calculateHaversineDistance(
            location.latitude,
            location.longitude,
            chaser.lastLocation!.latitude,
            chaser.lastLocation!.longitude
          );
          if (d < nearestChaserDist) nearestChaserDist = d;
        }

        mission.distanceToTargetMeters = nearestChaserDist === Infinity ? undefined : Math.round(nearestChaserDist);
        const proxDist = mission.proximityDistanceMeters || mission.targetRadiusMeters || 50;
        const reqStay = mission.requiredStaySeconds || 60;

        if (nearestChaserDist <= proxDist) {
          mission.isInRadius = true;
          const key = `${mission.id}_${runner.id}`;
          const lastVerif = this.lastStayVerificationTime.get(key);
          const deltaSec = lastVerif ? Math.max(0, Math.round((now - lastVerif) / 1000)) : 0;
          this.lastStayVerificationTime.set(key, now);

          mission.currentStaySeconds = (mission.currentStaySeconds || 0) + deltaSec;
          mission.stayDurationSeconds = mission.currentStaySeconds;
          mission.progress = Math.min(100, Math.round((mission.currentStaySeconds / reqStay) * 100));

          if (mission.currentStaySeconds >= reqStay) {
            this.completeSharedMission(room, mission, runner);
            completedList.push(mission);
          }
        } else {
          mission.isInRadius = false;
          this.lastStayVerificationTime.delete(`${mission.id}_${runner.id}`);
          mission.currentStaySeconds = 0;
          mission.stayDurationSeconds = 0;
          mission.progress = 0;
        }
      }

      // 5. LANDMARK_RECON
      else if (rawType === 'LANDMARK_RECON' && location && mission.targetLocation) {
        const targetLat = mission.targetLocation.latitude ?? mission.targetLocation.lat;
        const targetLng = mission.targetLocation.longitude ?? mission.targetLocation.lng;
        const dist = calculateHaversineDistance(
          location.latitude,
          location.longitude,
          targetLat,
          targetLng
        );
        mission.distanceToTargetMeters = Math.round(dist);

        const effectiveDist = Math.max(0, dist - (location.accuracy || 5) / 2);
        const radius = mission.targetRadiusMeters || 25;

        if (effectiveDist <= radius) {
          if (!mission.landmarkClue?.answer || mission.landmarkClue.isAnswered) {
            this.completeSharedMission(room, mission, runner);
            completedList.push(mission);
          }
        }
      }
    }

    const allCompleted =
      room.match.sharedMissions.length > 0 &&
      room.match.sharedMissions.every((m) => m.status === 'COMPLETED');

    return { completedMissions: completedList, allCompleted };
  }

  /**
   * Authoritatively completes a shared match mission.
   */
  public completeSharedMission(room: RoomState, mission: SharedMission, runner: PlayerMember): void {
    if (mission.status === 'COMPLETED') return;

    mission.status = 'COMPLETED';
    mission.completedAt = Date.now();
    mission.completedByPlayerId = runner.id;
    mission.completedByNickname = runner.nickname;
    mission.progress = 100;

    // Award points idempotently to completing runner and the Runners team
    if (room.match?.scoreLedger) {
      const idempotencyKey = `shared_mission_${mission.id}`;
      this.scoringService.awardPoints({
        ledger: room.match.scoreLedger,
        playerId: runner.id,
        playerNickname: runner.nickname,
        team: 'RUNNERS',
        pointsIndividual: mission.rewardIndividual,
        pointsTeam: mission.rewardTeam,
        type: 'MISSION_COMPLETED',
        reason: `Completed: ${mission.title}`,
        idempotencyKey,
      });
    }

    // Also populate legacy completedMissions list
    if (room.match) {
      room.match.completedMissions = room.match.completedMissions || [];
      if (!room.match.completedMissions.some((m) => m.id === mission.id)) {
        room.match.completedMissions.push(mission);
      }
    }
  }

  /**
   * Submits intelligence answer for Landmark Recon missions.
   */
  public answerLandmarkClue(
    room: RoomState,
    runnerId: string,
    answer: string
  ): { success: boolean; completed?: boolean; error?: string } {
    if (!room.match || !room.match.sharedMissions) {
      return { success: false, error: 'Match not active' };
    }

    const runner = room.members[runnerId];
    if (!runner || runner.team !== 'RUNNERS' || runner.isCaught) {
      return { success: false, error: 'Only uncaught runners can submit intelligence codes' };
    }

    const landmarkMission = room.match.sharedMissions.find(
      (m) => (m.type === 'LANDMARK_RECON' || m.templateType === 'LANDMARK_RECON') && m.status === 'ACTIVE'
    );

    if (!landmarkMission || !landmarkMission.landmarkClue) {
      return { success: false, error: 'No active landmark mission requires verification' };
    }

    if (landmarkMission.landmarkClue.answer?.trim() !== answer.trim()) {
      return { success: false, error: 'Incorrect intelligence code' };
    }

    landmarkMission.landmarkClue.isAnswered = true;

    // If runner is in radius, complete immediately
    if (
      landmarkMission.distanceToTargetMeters !== undefined &&
      landmarkMission.targetRadiusMeters !== undefined &&
      landmarkMission.distanceToTargetMeters <= landmarkMission.targetRadiusMeters
    ) {
      this.completeSharedMission(room, landmarkMission, runner);
      return { success: true, completed: true };
    }

    return { success: true, completed: false };
  }

  /**
   * Check survival milestone progression across all active uncaught runners.
   */
  public checkSurvivalMilestones(room: RoomState): { completedMissions: SharedMission[]; allCompleted: boolean } {
    if (!room.match || !room.match.sharedMissions || room.state !== 'ACTIVE') {
      return { completedMissions: [], allCompleted: false };
    }

    const uncaughtRunner = Object.values(room.members).find(
      (m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated
    );
    if (!uncaughtRunner) return { completedMissions: [], allCompleted: false };

    return this.evaluateSharedMissions(room, uncaughtRunner, uncaughtRunner.lastLocation);
  }
}
