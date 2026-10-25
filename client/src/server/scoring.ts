import {
  ScoreEvent,
  ScoreLedger,
  PlayerTeam,
  PlayerMember,
  MissionsConfig,
  TieBreakerRule,
} from '../types/game';

function randomId(): string {
  return 'ev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
}

export class ScoringService {
  public createEmptyLedger(members: Record<string, PlayerMember>): ScoreLedger {
    const playerScores: Record<string, number> = {};
    for (const id of Object.keys(members)) {
      playerScores[id] = 0;
    }

    return {
      teamScores: {
        RUNNERS: 0,
        CHASERS: 0,
      },
      playerScores,
      individualScores: playerScores,
      events: [],
    };
  }

  public awardPoints(
    paramsOrLedger:
      | ScoreLedger
      | {
          ledger: ScoreLedger;
          playerId?: string;
          playerNickname?: string;
          team: PlayerTeam;
          pointsIndividual: number;
          pointsTeam: number;
          type?: ScoreEvent['type'];
          reason: string;
          idempotencyKey: string;
        },
    idempotencyKeyArg?: string,
    playerIdArg?: string,
    teamArg?: PlayerTeam,
    pointsIndividualArg?: number,
    pointsTeamArg?: number,
    reasonArg?: string,
    typeArg?: ScoreEvent['type']
  ): { success: boolean; event?: ScoreEvent; alreadyAwarded?: boolean } {
    let ledger: ScoreLedger;
    let playerId: string | undefined;
    let playerNickname: string | undefined;
    let team: PlayerTeam;
    let pointsIndividual: number;
    let pointsTeam: number;
    let type: ScoreEvent['type'];
    let reason: string;
    let idempotencyKey: string;

    if ('events' in paramsOrLedger) {
      ledger = paramsOrLedger;
      idempotencyKey = idempotencyKeyArg!;
      playerId = playerIdArg;
      team = teamArg || 'NONE';
      pointsIndividual = pointsIndividualArg || 0;
      pointsTeam = pointsTeamArg || 0;
      reason = reasonArg || 'Points awarded';
      type = typeArg || 'MISSION_COMPLETED';
    } else {
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

    if (!ledger.events) ledger.events = [];
    if (!ledger.playerScores) ledger.playerScores = {};
    if (!(ledger as any).individualScores) (ledger as any).individualScores = ledger.playerScores;

    const existing = ledger.events.find((e) => e.idempotencyKey === idempotencyKey);
    if (existing) {
      return { success: false, alreadyAwarded: true, event: existing };
    }

    if (team === 'RUNNERS' || team === 'CHASERS') {
      ledger.teamScores[team] = (ledger.teamScores[team] || 0) + pointsTeam;
    }

    if (playerId) {
      ledger.playerScores[playerId] = (ledger.playerScores[playerId] || 0) + pointsIndividual;
      (ledger as any).individualScores[playerId] = ledger.playerScores[playerId];
    }

    const event: ScoreEvent = {
      id: randomId(),
      playerId,
      playerNickname,
      team,
      pointsIndividual,
      pointsTeam,
      type,
      reason,
      timestamp: Date.now(),
      idempotencyKey,
    };

    ledger.events.push(event);

    return { success: true, event };
  }

  public resolveCatchReward(
    ledger: ScoreLedger,
    chaser: PlayerMember,
    runner: PlayerMember,
    config: MissionsConfig
  ): { chaserEvent?: ScoreEvent; teamEvent?: ScoreEvent } {
    const catchReward = config.catchReward || { individual: 100, team: 100 };
    const idempotencyKey = `catch_${runner.id}_by_${chaser.id}_${Date.now()}`;

    const res = this.awardPoints({
      ledger,
      playerId: chaser.id,
      playerNickname: chaser.nickname,
      team: 'CHASERS',
      pointsIndividual: catchReward.individual,
      pointsTeam: catchReward.team,
      type: 'CATCH_AWARD',
      reason: `Caught operative ${runner.nickname}`,
      idempotencyKey,
    });

    return { chaserEvent: res.event };
  }

  public determineWinningTeam(
    ledger: ScoreLedger,
    members: Record<string, PlayerMember>,
    tieBreaker: TieBreakerRule = 'DRAW'
  ): {
    winner: 'RUNNERS' | 'CHASERS' | 'DRAW';
    runnerScore: number;
    chaserScore: number;
    reason: string;
  } {
    const runnerScore = ledger.teamScores.RUNNERS || 0;
    const chaserScore = ledger.teamScores.CHASERS || 0;

    if (runnerScore > chaserScore) {
      return {
        winner: 'RUNNERS',
        runnerScore,
        chaserScore,
        reason: `Runners secured victory with ${runnerScore} pts vs ${chaserScore} pts.`,
      };
    } else if (chaserScore > runnerScore) {
      return {
        winner: 'CHASERS',
        runnerScore,
        chaserScore,
        reason: `Chasers secured victory with ${chaserScore} pts vs ${runnerScore} pts.`,
      };
    }

    if (tieBreaker === 'DRAW') {
      return {
        winner: 'DRAW',
        runnerScore,
        chaserScore,
        reason: `Match ended in a tactical draw at ${runnerScore} pts each.`,
      };
    }

    if (tieBreaker === 'MOST_CATCHES') {
      const catchCount = ledger.events.filter((e) => e.type === 'CATCH_AWARD').length;
      if (catchCount > 0) {
        return {
          winner: 'CHASERS',
          runnerScore,
          chaserScore,
          reason: `Tie broken: Chasers win by securing ${catchCount} verified catches.`,
        };
      }
    }

    return {
      winner: 'DRAW',
      runnerScore,
      chaserScore,
      reason: `Match ended in an unbreakable draw at ${runnerScore} pts.`,
    };
  }

  public resolveWinnerBonuses(
    ledger: ScoreLedger,
    winningTeam: 'RUNNERS' | 'CHASERS',
    members: Record<string, PlayerMember>,
    config: MissionsConfig
  ): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    const teamBonus = config.winningTeamBonus ?? 500;
    const individualBonus = config.winningIndividualBonus ?? 100;

    const teamRes = this.awardPoints({
      ledger,
      team: winningTeam,
      pointsIndividual: 0,
      pointsTeam: teamBonus,
      type: 'WINNING_BONUS',
      reason: `Winning team bonus for ${winningTeam}`,
      idempotencyKey: `win_bonus_team_${winningTeam}_${ledger.events.length}`,
    });
    if (teamRes.event) events.push(teamRes.event);

    for (const member of Object.values(members)) {
      if (member.team === winningTeam && !member.isEliminated) {
        const indRes = this.awardPoints({
          ledger,
          playerId: member.id,
          playerNickname: member.nickname,
          team: winningTeam,
          pointsIndividual: individualBonus,
          pointsTeam: 0,
          type: 'WINNING_BONUS',
          reason: `Victory individual operative bonus`,
          idempotencyKey: `win_bonus_player_${member.id}_${winningTeam}`,
        });
        if (indRes.event) events.push(indRes.event);
      }
    }

    return events;
  }
}
