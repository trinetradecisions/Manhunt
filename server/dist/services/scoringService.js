import { v4 as uuidv4 } from 'uuid';
export class ScoringService {
    /**
     * Initializes a fresh score ledger for a new match.
     */
    createEmptyLedger(members) {
        const playerScores = {};
        for (const id of Object.keys(members)) {
            playerScores[id] = 0;
        }
        const ledger = {
            teamScores: {
                RUNNERS: 0,
                CHASERS: 0,
            },
            playerScores,
            individualScores: playerScores,
            events: [],
        };
        return ledger;
    }
    /**
     * Authoritatively awards points idempotently to both individual player and team ledgers.
     * Supports both object params and positional params for flexibility.
     */
    awardPoints(paramsOrLedger, idempotencyKeyArg, playerIdArg, teamArg, pointsIndividualArg, pointsTeamArg, reasonArg, typeArg) {
        let ledger;
        let playerId;
        let playerNickname;
        let team;
        let pointsIndividual;
        let pointsTeam;
        let type;
        let reason;
        let idempotencyKey;
        if ('events' in paramsOrLedger) {
            ledger = paramsOrLedger;
            idempotencyKey = idempotencyKeyArg;
            playerId = playerIdArg;
            team = teamArg || 'NONE';
            pointsIndividual = pointsIndividualArg || 0;
            pointsTeam = pointsTeamArg || 0;
            reason = reasonArg || 'Points awarded';
            type = typeArg || 'MISSION_COMPLETED';
        }
        else {
            ledger = paramsOrLedger.ledger;
            playerId = paramsOrLedger.playerId;
            playerNickname = paramsOrLedger.playerNickname;
            team = paramsOrLedger.team;
            pointsIndividual = paramsOrLedger.pointsIndividual;
            pointsTeam = paramsOrLedger.pointsTeam;
            type = paramsOrLedger.type || 'MISSION_COMPLETED';
            reason = paramsOrLedger.reason;
            idempotencyKey = paramsOrLedger.idempotencyKey;
        }
        if (!ledger.events) {
            ledger.events = [];
        }
        if (!ledger.playerScores) {
            ledger.playerScores = {};
        }
        if (!ledger.individualScores) {
            ledger.individualScores = ledger.playerScores;
        }
        // Idempotency check: prevent duplicate point awards
        const existing = ledger.events.find((e) => e.idempotencyKey === idempotencyKey);
        if (existing) {
            return { success: true, event: existing, alreadyAwarded: true };
        }
        // Award team points if team is assigned
        if (team === 'RUNNERS' || team === 'CHASERS') {
            ledger.teamScores[team] = (ledger.teamScores[team] || 0) + pointsTeam;
        }
        // Award individual points to player
        if (playerId) {
            ledger.playerScores[playerId] = (ledger.playerScores[playerId] || 0) + pointsIndividual;
            ledger.individualScores[playerId] = ledger.playerScores[playerId];
        }
        const event = {
            id: uuidv4(),
            timestamp: Date.now(),
            type,
            playerId,
            playerNickname,
            team,
            pointsIndividual,
            pointsTeam,
            reason,
            idempotencyKey,
        };
        ledger.events.push(event);
        return { success: true, event, alreadyAwarded: false };
    }
    /**
     * Evaluates the winning team based on scores, early-end conditions, and tie-breakers.
     * Supports both object params and positional params.
     */
    determineWinner(paramsOrLedger, remainingRunnersCountOrConfig, configArg) {
        let ledger;
        let config;
        let allRunnersCaught = false;
        if ('teamScores' in paramsOrLedger) {
            ledger = paramsOrLedger;
            if (typeof remainingRunnersCountOrConfig === 'number') {
                allRunnersCaught = remainingRunnersCountOrConfig === 0;
                config = configArg;
            }
            else {
                config = remainingRunnersCountOrConfig;
            }
        }
        else {
            ledger = paramsOrLedger.ledger;
            config = paramsOrLedger.config;
            allRunnersCaught = !!paramsOrLedger.allRunnersCaught;
        }
        // Early-end rule check
        if (allRunnersCaught && (config?.allRunnersCaughtEndsMatch ?? config?.earlyEndAllRunnersCaught ?? true)) {
            return 'CHASERS';
        }
        const runnerScore = ledger.teamScores?.RUNNERS || 0;
        const chaserScore = ledger.teamScores?.CHASERS || 0;
        if (runnerScore > chaserScore) {
            return 'RUNNERS';
        }
        if (chaserScore > runnerScore) {
            return 'CHASERS';
        }
        // Tie-breaker evaluation
        const rule = config?.tieBreaker || config?.tieBreakerRule || 'DRAW';
        if (rule === 'CHASERS_WIN') {
            return 'CHASERS';
        }
        if (rule === 'RUNNERS_WIN') {
            return 'RUNNERS';
        }
        return 'DRAW';
    }
    /**
     * Awards the match-end victory bonus once to the winning team and its members.
     * Supports both object params and positional params.
     */
    awardVictoryBonus(paramsOrLedger, winnerArg, membersArg, configArg) {
        let ledger;
        let matchId = 'match';
        let winner;
        let members;
        let config;
        if ('teamScores' in paramsOrLedger) {
            ledger = paramsOrLedger;
            winner = winnerArg || 'DRAW';
            members = membersArg || {};
            config = configArg;
        }
        else {
            ledger = paramsOrLedger.ledger;
            matchId = paramsOrLedger.matchId || 'match';
            winner = paramsOrLedger.winner;
            members = paramsOrLedger.members;
            config = paramsOrLedger.config;
        }
        if (winner === 'DRAW')
            return [];
        const eventsAwarded = [];
        const teamBonus = typeof config?.winningTeamBonus === 'number' ? config.winningTeamBonus : 500;
        const individualBonus = typeof config?.winningIndividualBonus === 'number' ? config.winningIndividualBonus : 100;
        const teamKey = `winning-team-bonus:${matchId}:${winner}`;
        const alreadyTeamBonus = (ledger.events || []).some((e) => e.idempotencyKey === teamKey);
        if (!alreadyTeamBonus) {
            // Award team bonus once
            const teamRes = this.awardPoints({
                ledger,
                team: winner,
                pointsIndividual: 0,
                pointsTeam: teamBonus,
                type: 'WINNING_BONUS',
                reason: `Victory Match-End Team Bonus for ${winner}`,
                idempotencyKey: teamKey,
            });
            if (teamRes.event)
                eventsAwarded.push(teamRes.event);
            // Award individual points to participating members of winning team
            for (const m of Object.values(members)) {
                if (m.team === winner) {
                    const playerKey = `winning-individual-bonus:${matchId}:${m.id}`;
                    const playerRes = this.awardPoints({
                        ledger,
                        playerId: m.id,
                        playerNickname: m.nickname,
                        team: winner,
                        pointsIndividual: individualBonus,
                        pointsTeam: 0,
                        type: 'WINNING_BONUS',
                        reason: `Victory Individual Bonus: ${m.nickname}`,
                        idempotencyKey: playerKey,
                    });
                    if (playerRes.event)
                        eventsAwarded.push(playerRes.event);
                }
            }
        }
        return eventsAwarded;
    }
}
