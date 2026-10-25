import { GameState, PlayerRole } from '../types/game';

export interface TransitionRule {
  from: GameState[];
  to: GameState;
  authorizedRoles: PlayerRole[];
}

export const STATE_TRANSITIONS: TransitionRule[] = [
  {
    from: ['LOBBY'],
    to: 'READY_CHECK',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['READY_CHECK'],
    to: 'COUNTDOWN',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['READY_CHECK'],
    to: 'LOBBY',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['COUNTDOWN'],
    to: 'RUNNER_HEADSTART',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['COUNTDOWN', 'RUNNER_HEADSTART', 'ACTIVE'],
    to: 'SAFETY_PAUSED',
    authorizedRoles: ['HOST', 'REFEREE'],
  },
  {
    from: ['RUNNER_HEADSTART'],
    to: 'ACTIVE',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['ACTIVE'],
    to: 'COMPLETED',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['SAFETY_PAUSED'],
    to: 'ACTIVE',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['SAFETY_PAUSED'],
    to: 'COMPLETED',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['LOBBY', 'READY_CHECK', 'ACTIVE', 'SAFETY_PAUSED'],
    to: 'CANCELLED',
    authorizedRoles: ['HOST'],
  },
  {
    from: ['COMPLETED'],
    to: 'LOBBY',
    authorizedRoles: ['HOST'],
  },
];

export function canTransitionState(
  currentState: GameState,
  targetState: GameState,
  initiatorRole: PlayerRole
): { allowed: boolean; reason?: string } {
  const rule = STATE_TRANSITIONS.find(
    (r) => r.from.includes(currentState) && r.to === targetState
  );

  if (!rule) {
    return {
      allowed: false,
      reason: `Illegal state transition from ${currentState} to ${targetState}`,
    };
  }

  if (!rule.authorizedRoles.includes(initiatorRole)) {
    return {
      allowed: false,
      reason: `Role ${initiatorRole} is not authorized to transition to ${targetState}`,
    };
  }

  return { allowed: true };
}
