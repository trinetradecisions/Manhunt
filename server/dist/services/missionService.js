import { v4 as uuidv4 } from 'uuid';
import { calculateHaversineDistance, generateRandomPointInZone, } from '../engine/geo.js';
export class MissionService {
    scoringService;
    // History of completed mission templates per player to prevent consecutive duplicates
    lastCompletedTemplates = new Map();
    // Track consecutive GPS observation times to prevent stationary stay time accumulation during GPS drops
    lastStayVerificationTime = new Map();
    constructor(scoringService) {
        this.scoringService = scoringService;
    }
    /**
     * Returns default mission configuration values.
     */
    getDefaultConfig() {
        return {
            enabled: true,
            enabledMissionTypes: [
                'SECURE_POINT',
                'CHECKPOINT_RUN',
                'SURVIVAL_MILESTONE',
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
            checkpointDeadlineSeconds: 480, // 8 minutes
            survivalMilestoneSeconds: 300, // 5 minutes
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
     * Initializes missions for all active uncaught runners when the match starts.
     */
    initializeMatchMissions(room) {
        if (!room.match)
            return;
        room.match.activeMissions = room.match.activeMissions || {};
        room.match.completedMissions = room.match.completedMissions || [];
        const runners = Object.values(room.members).filter((m) => m.team === 'RUNNERS' && !m.isCaught && !m.isEliminated);
        for (const runner of runners) {
            if (!room.match.activeMissions[runner.id]) {
                const mission = this.generateRandomMission(room, runner);
                if (mission) {
                    room.match.activeMissions[runner.id] = mission;
                }
            }
        }
    }
    /**
     * Weighted random selection among enabled mission templates.
     */
    selectMissionType(config, lastType) {
        const rawEnabled = config.enabledTypes || config.enabledMissionTypes || [
            'SECURE_POINT',
            'CHECKPOINT_RUN',
            'SURVIVAL_MILESTONE',
            'LANDMARK_RECON',
        ];
        const enabled = rawEnabled;
        // Filter out consecutive duplicate if alternatives exist
        const pool = enabled.length > 1 && lastType ? enabled.filter((t) => t !== lastType) : enabled;
        const weights = config.difficultyWeights || { easy: 45, medium: 35, hard: 20 };
        // Categorize templates by difficulty
        const getWeight = (type) => {
            switch (type) {
                case 'SURVIVAL_MILESTONE':
                case 'SECURE_POINT':
                case 'SECURE_THE_POINT':
                    return weights.easy;
                case 'CHECKPOINT_RUN':
                case 'LANDMARK_RECON':
                    return weights.medium;
                case 'CLOSE_ENCOUNTER':
                    return weights.hard;
                default:
                    return 25;
            }
        };
        let totalWeight = 0;
        for (const type of pool) {
            totalWeight += getWeight(type);
        }
        let randomVal = Math.random() * (totalWeight || 1);
        for (const type of pool) {
            const w = getWeight(type);
            if (randomVal <= w) {
                return type;
            }
            randomVal -= w;
        }
        return pool[0] || 'SECURE_POINT';
    }
    /**
     * Generates a new random mission assignment for a runner.
     */
    generateRandomMission(room, runner) {
        if (room.state !== 'ACTIVE' && room.state !== 'RUNNER_HEADSTART') {
            return null;
        }
        const config = room.config.missions || this.getDefaultConfig();
        if (!config.enabled)
            return null;
        const lastType = this.lastCompletedTemplates.get(runner.id);
        const rawType = this.selectMissionType(config, lastType);
        const templateType = rawType === 'SECURE_THE_POINT' ? 'SECURE_POINT' : rawType;
        const activeZone = room.config.dynamicZone?.enabled && room.match?.dynamicZoneState
            ? {
                ...room.config.playZone,
                radiusMeters: room.match.dynamicZoneState.currentRadiusMeters,
            }
            : room.config.playZone;
        const now = Date.now();
        const matchId = room.match?.startedAt?.toString() || now.toString();
        const missionId = uuidv4();
        // Check existing target locations to avoid duplicate destinations
        const existingLocations = Object.values(room.match?.activeMissions || {})
            .map((m) => m.targetLocation)
            .filter((loc) => !!loc);
        const pickSafeDistinctPoint = () => {
            for (let attempt = 0; attempt < 10; attempt++) {
                const pt = generateRandomPointInZone(activeZone, 25);
                const tooClose = existingLocations.some((ex) => {
                    const exLat = ex.latitude ?? ex.lat;
                    const exLng = ex.longitude ?? ex.lng;
                    return calculateHaversineDistance(pt.lat, pt.lng, exLat, exLng) < 40;
                });
                if (!tooClose || attempt === 9) {
                    return {
                        lat: pt.lat,
                        lng: pt.lng,
                        latitude: pt.lat,
                        longitude: pt.lng,
                    };
                }
            }
            const fallback = generateRandomPointInZone(activeZone, 25);
            return {
                lat: fallback.lat,
                lng: fallback.lng,
                latitude: fallback.lat,
                longitude: fallback.lng,
            };
        };
        switch (templateType) {
            case 'SECURE_POINT': {
                const targetPt = pickSafeDistinctPoint();
                const durationSec = config.securePointDurationSeconds || 90;
                const radius = config.securePointRadiusMeters || 25;
                const rewards = config.rewards?.securePoint || { individual: 100, team: 100 };
                return {
                    id: missionId,
                    playerId: runner.id,
                    playerNickname: runner.nickname,
                    roomCode: room.roomCode,
                    matchId,
                    type: rawType,
                    templateType: 'SECURE_POINT',
                    title: 'Secure Sector Point',
                    description: `Advance to the designated point and hold the sector for ${durationSec} seconds.`,
                    difficulty: 'EASY',
                    rewardIndividual: rewards.individual,
                    rewardTeam: rewards.team,
                    assignedAt: now,
                    deadlineAt: null,
                    targetLocation: targetPt,
                    targetRadiusMeters: radius,
                    requiredStaySeconds: durationSec,
                    currentStaySeconds: 0,
                    stayDurationSeconds: 0,
                    stayResetOnDeparture: config.securePointLeaveBehavior !== 'PAUSE',
                    progress: 0,
                    status: 'ACTIVE',
                };
            }
            case 'CHECKPOINT_RUN': {
                const count = Math.max(2, Math.min(5, config.checkpointCount || 3));
                const checkpoints = [];
                for (let i = 0; i < count; i++) {
                    const pt = pickSafeDistinctPoint();
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
                return {
                    id: missionId,
                    playerId: runner.id,
                    playerNickname: runner.nickname,
                    roomCode: room.roomCode,
                    matchId,
                    type: 'CHECKPOINT_RUN',
                    templateType,
                    title: `Checkpoint Sweep (1/${count})`,
                    description: `Reach all ${count} checkpoints in strict order before the mission deadline.`,
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
                };
            }
            case 'SURVIVAL_MILESTONE': {
                const milestoneSec = config.survivalMilestoneSeconds || 300;
                const rewards = config.rewards?.survivalMilestone || { individual: 50, team: 50 };
                return {
                    id: missionId,
                    playerId: runner.id,
                    playerNickname: runner.nickname,
                    roomCode: room.roomCode,
                    matchId,
                    type: 'SURVIVAL_MILESTONE',
                    templateType,
                    title: 'Survival Protocol',
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
                    milestoneAwardedCount: 0,
                    progress: 0,
                    status: 'ACTIVE',
                };
            }
            case 'CLOSE_ENCOUNTER': {
                const dist = config.closeEncounterDistanceMeters || 50;
                const durationSec = config.closeEncounterDurationSeconds || 60;
                const rewards = config.rewards?.closeEncounter || { individual: 150, team: 150 };
                return {
                    id: missionId,
                    playerId: runner.id,
                    playerNickname: runner.nickname,
                    roomCode: room.roomCode,
                    matchId,
                    type: 'CLOSE_ENCOUNTER',
                    templateType,
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
                };
            }
            case 'LANDMARK_RECON': {
                const markers = activeZone.markers || [];
                let landmarkPt;
                let landmarkName = 'Strategic Waypoint';
                let clueQuestion;
                let clueAnswer;
                if (markers.length > 0) {
                    const selected = markers[Math.floor(Math.random() * markers.length)];
                    landmarkPt = { lat: selected.lat, lng: selected.lng, latitude: selected.lat, longitude: selected.lng };
                    landmarkName = selected.label;
                }
                else {
                    landmarkPt = pickSafeDistinctPoint();
                    landmarkName = 'Alpha Sector Outpost';
                }
                // Host approved clue verification code
                const code = Math.floor(1000 + Math.random() * 9000).toString();
                clueQuestion = `Recon Intel: Enter security confirmation PIN [${code}]`;
                clueAnswer = code;
                const rewards = config.rewards?.landmarkRecon || { individual: 100, team: 100 };
                return {
                    id: missionId,
                    playerId: runner.id,
                    playerNickname: runner.nickname,
                    roomCode: room.roomCode,
                    matchId,
                    type: 'LANDMARK_RECON',
                    templateType,
                    title: `Recon: ${landmarkName}`,
                    description: `Proceed to ${landmarkName} and verify intelligence payload.`,
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
                        question: clueQuestion,
                        answer: clueAnswer,
                        isAnswered: false,
                    },
                    status: 'ACTIVE',
                };
            }
            default:
                return null;
        }
    }
    /**
     * Evaluates active missions against new player locations and match clock updates.
     * Returns missions that were completed during this evaluation.
     */
    evaluateMissionProgress(room, playerId, location) {
        if (!room.match || !room.match.activeMissions) {
            return { completedMissions: [] };
        }
        const mission = room.match.activeMissions[playerId];
        if (!mission || mission.status !== 'ACTIVE') {
            return { completedMissions: [] };
        }
        const runner = room.members[playerId];
        if (!runner || runner.team !== 'RUNNERS' || runner.isCaught || runner.isEliminated) {
            mission.status = 'FAILED';
            delete room.match.activeMissions[playerId];
            return { completedMissions: [] };
        }
        const now = location?.timestamp || Date.now();
        const config = room.config.missions || this.getDefaultConfig();
        const completedList = [];
        const rawType = (mission.type || mission.templateType || '').toUpperCase();
        const isSecurePoint = rawType === 'SECURE_POINT' || rawType === 'SECURE_THE_POINT';
        const isCheckpointRun = rawType === 'CHECKPOINT_RUN';
        const isSurvivalMilestone = rawType === 'SURVIVAL_MILESTONE';
        const isCloseEncounter = rawType === 'CLOSE_ENCOUNTER';
        const isLandmarkRecon = rawType === 'LANDMARK_RECON';
        // Deadline check
        if (mission.deadlineAt && now > mission.deadlineAt) {
            // For survival milestone, reaching deadline means surviving the duration!
            if (isSurvivalMilestone) {
                this.completeMission(room, mission);
                completedList.push(mission);
                return { completedMissions: completedList };
            }
            else {
                // Expired without completion
                mission.status = 'FAILED';
                delete room.match.activeMissions[playerId];
                // Assign replacement mission
                const next = this.generateRandomMission(room, runner);
                if (next)
                    room.match.activeMissions[playerId] = next;
                return { completedMissions: [], updatedMission: next || undefined };
            }
        }
        // Evaluate based on mission template
        if (isSecurePoint) {
            if (location && mission.targetLocation) {
                const targetLat = mission.targetLocation.latitude ?? mission.targetLocation.lat;
                const targetLng = mission.targetLocation.longitude ?? mission.targetLocation.lng;
                const dist = calculateHaversineDistance(location.latitude, location.longitude, targetLat, targetLng);
                mission.distanceToTargetMeters = Math.round(dist);
                // Account for GPS accuracy: effective distance
                const effectiveDist = Math.max(0, dist - (location.accuracy || 5) / 2);
                const radius = mission.targetRadiusMeters || 25;
                const reqStay = mission.requiredStaySeconds || 90;
                if (effectiveDist <= radius) {
                    // Inside objective radius
                    mission.isInRadius = true;
                    const lastVerif = this.lastStayVerificationTime.get(mission.id);
                    const deltaSec = lastVerif ? Math.max(0, Math.round((now - lastVerif) / 1000)) : 0;
                    this.lastStayVerificationTime.set(mission.id, now);
                    mission.currentStaySeconds = (mission.currentStaySeconds || 0) + deltaSec;
                    mission.stayDurationSeconds = mission.currentStaySeconds;
                    mission.progress = Math.min(100, Math.round((mission.currentStaySeconds / reqStay) * 100));
                    if (mission.currentStaySeconds >= reqStay) {
                        this.completeMission(room, mission);
                        completedList.push(mission);
                    }
                }
                else {
                    // Departed from objective radius
                    mission.isInRadius = false;
                    if (mission.stayResetOnDeparture || config.securePointLeaveBehavior === 'RESET') {
                        mission.currentStaySeconds = 0;
                        mission.stayDurationSeconds = 0;
                        mission.progress = 0;
                    }
                    this.lastStayVerificationTime.delete(mission.id);
                }
            }
        }
        else if (isCheckpointRun) {
            if (location && mission.checkpoints && mission.currentCheckpointIndex !== undefined) {
                const currentCp = mission.checkpoints[mission.currentCheckpointIndex];
                if (currentCp) {
                    const dist = calculateHaversineDistance(location.latitude, location.longitude, currentCp.latitude, currentCp.longitude);
                    mission.distanceToTargetMeters = Math.round(dist);
                    const effectiveDist = Math.max(0, dist - (location.accuracy || 5) / 2);
                    const cpRadius = currentCp.radiusMeters || 25;
                    if (effectiveDist <= cpRadius) {
                        currentCp.completed = true;
                        currentCp.isCompleted = true;
                        currentCp.completedAt = now;
                        mission.currentCheckpointIndex += 1;
                        mission.progress = Math.min(100, Math.round((mission.currentCheckpointIndex / mission.checkpoints.length) * 100));
                        if (mission.currentCheckpointIndex >= mission.checkpoints.length) {
                            // Reached all checkpoints in sequence!
                            this.completeMission(room, mission);
                            completedList.push(mission);
                        }
                        else {
                            // Advance to next checkpoint target
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
        }
        else if (isSurvivalMilestone) {
            const reqStay = mission.requiredStaySeconds ||
                (mission.milestoneMinutes ? mission.milestoneMinutes * 60 : 300);
            const elapsed = Math.max(0, Math.floor((now - mission.assignedAt) / 1000));
            mission.currentStaySeconds = Math.min(reqStay, elapsed);
            mission.stayDurationSeconds = mission.currentStaySeconds;
            mission.progress = Math.min(100, Math.round((mission.currentStaySeconds / reqStay) * 100));
            if (mission.currentStaySeconds >= reqStay) {
                this.completeMission(room, mission);
                completedList.push(mission);
            }
        }
        else if (isCloseEncounter) {
            if (location) {
                // Find active chasers with recent GPS
                const activeChasers = Object.values(room.members).filter((m) => m.team === 'CHASERS' &&
                    m.lastLocation &&
                    Math.abs(now - m.lastLocation.timestamp) <= 30000);
                let nearestChaserDist = Infinity;
                for (const chaser of activeChasers) {
                    const d = calculateHaversineDistance(location.latitude, location.longitude, chaser.lastLocation.latitude, chaser.lastLocation.longitude);
                    if (d < nearestChaserDist) {
                        nearestChaserDist = d;
                    }
                }
                mission.distanceToTargetMeters =
                    nearestChaserDist === Infinity ? undefined : Math.round(nearestChaserDist);
                const proxDist = mission.proximityDistanceMeters || mission.targetRadiusMeters || 50;
                const reqStay = mission.requiredStaySeconds || 60;
                if (nearestChaserDist <= proxDist) {
                    mission.isInRadius = true;
                    const lastVerif = this.lastStayVerificationTime.get(mission.id);
                    const deltaSec = lastVerif ? Math.max(0, Math.round((now - lastVerif) / 1000)) : 0;
                    this.lastStayVerificationTime.set(mission.id, now);
                    mission.currentStaySeconds = (mission.currentStaySeconds || 0) + deltaSec;
                    mission.stayDurationSeconds = mission.currentStaySeconds;
                    mission.progress = Math.min(100, Math.round((mission.currentStaySeconds / reqStay) * 100));
                    if (mission.currentStaySeconds >= reqStay) {
                        this.completeMission(room, mission);
                        completedList.push(mission);
                    }
                }
                else {
                    mission.isInRadius = false;
                    this.lastStayVerificationTime.delete(mission.id);
                    mission.currentStaySeconds = 0;
                    mission.stayDurationSeconds = 0;
                    mission.progress = 0;
                }
            }
        }
        else if (isLandmarkRecon) {
            if (location && mission.targetLocation) {
                const targetLat = mission.targetLocation.latitude ?? mission.targetLocation.lat;
                const targetLng = mission.targetLocation.longitude ?? mission.targetLocation.lng;
                const dist = calculateHaversineDistance(location.latitude, location.longitude, targetLat, targetLng);
                mission.distanceToTargetMeters = Math.round(dist);
                const effectiveDist = Math.max(0, dist - (location.accuracy || 5) / 2);
                const radius = mission.targetRadiusMeters || 25;
                if (effectiveDist <= radius) {
                    // If a clue PIN is configured and not yet answered, require clue answer
                    if (mission.landmarkClue &&
                        mission.landmarkClue.answer &&
                        !mission.landmarkClue.isAnswered) {
                        // Waiting for runner answer submission
                    }
                    else {
                        this.completeMission(room, mission);
                        completedList.push(mission);
                    }
                }
            }
        }
        return { completedMissions: completedList, updatedMission: mission };
    }
    /**
     * Submits an answer for Landmark Recon missions.
     */
    answerLandmarkClue(room, playerId, answer) {
        if (!room.match || !room.match.activeMissions) {
            return { success: false, error: 'Match not active' };
        }
        const mission = room.match.activeMissions[playerId];
        const rawType = (mission?.type || mission?.templateType || '').toUpperCase();
        if (!mission || rawType !== 'LANDMARK_RECON' || !mission.landmarkClue) {
            return { success: false, error: 'No active landmark mission with clue' };
        }
        if (mission.landmarkClue.answer?.trim() !== answer.trim()) {
            return { success: false, error: 'Incorrect intelligence code' };
        }
        mission.landmarkClue.isAnswered = true;
        // If player is already within radius, complete mission immediately
        if (mission.distanceToTargetMeters !== undefined &&
            mission.targetRadiusMeters !== undefined &&
            mission.distanceToTargetMeters <= mission.targetRadiusMeters) {
            this.completeMission(room, mission);
            return { success: true, completed: true };
        }
        return { success: true, completed: false };
    }
    /**
     * Authoritatively completes a mission, awards points, records history, and assigns the next mission.
     */
    completeMission(room, mission) {
        mission.status = 'COMPLETED';
        mission.completedAt = Date.now();
        mission.progress = 100;
        this.lastCompletedTemplates.set(mission.playerId, mission.templateType);
        this.lastStayVerificationTime.delete(mission.id);
        // Award individual and team points exactly once
        if (room.match?.scoreLedger) {
            const idempotencyKey = `mission-complete:${mission.id}`;
            this.scoringService.awardPoints({
                ledger: room.match.scoreLedger,
                playerId: mission.playerId,
                playerNickname: mission.playerNickname,
                team: 'RUNNERS',
                pointsIndividual: mission.rewardIndividual,
                pointsTeam: mission.rewardTeam,
                type: 'MISSION_COMPLETED',
                reason: `Completed: ${mission.title}`,
                idempotencyKey,
            });
        }
        // Move to completed missions history
        if (room.match) {
            room.match.completedMissions = room.match.completedMissions || [];
            // Prevent duplicate insertion in history
            if (!room.match.completedMissions.some((m) => m.id === mission.id)) {
                room.match.completedMissions.push(mission);
            }
            delete room.match.activeMissions?.[mission.playerId];
        }
        // Automatically assign next random mission if match is still active and player is an uncaught runner
        const runner = room.members[mission.playerId];
        if (runner &&
            runner.team === 'RUNNERS' &&
            !runner.isCaught &&
            !runner.isEliminated &&
            (room.state === 'ACTIVE' || room.state === 'RUNNER_HEADSTART')) {
            const nextMission = this.generateRandomMission(room, runner);
            if (nextMission && room.match?.activeMissions) {
                room.match.activeMissions[runner.id] = nextMission;
            }
        }
    }
    /**
     * Periodic recurring check for survival milestones for all active uncaught runners.
     */
    checkSurvivalMilestones(room) {
        if (!room.match || !room.match.activeMissions || room.state !== 'ACTIVE') {
            return [];
        }
        const completed = [];
        for (const [playerId, mission] of Object.entries(room.match.activeMissions)) {
            const rawType = (mission.type || mission.templateType || '').toUpperCase();
            if (rawType === 'SURVIVAL_MILESTONE' && mission.status === 'ACTIVE') {
                const res = this.evaluateMissionProgress(room, playerId, room.members[playerId]?.lastLocation);
                if (res.completedMissions.length > 0) {
                    completed.push(...res.completedMissions);
                }
            }
        }
        return completed;
    }
}
