import { describe, expect, it } from 'vitest';

import {
  actionId,
  decisionId,
  leagueId,
  playerId,
  teamId,
  type FantasyDecision,
  type League,
  type Roster,
} from '@eggbot/core';

import { createPolicyEngine, type PolicyRule } from './index.js';

describe('createPolicyEngine', () => {
  it('rejects a denied action while preserving approved actions for inspection', async () => {
    const deniedId = actionId('denied');
    const league: League = {
      id: leagueId('league'),
      name: 'Test league',
      season: 2026,
      settings: { rosterSlots: [], scoringRules: [] },
    };
    const roster: Roster = { teamId: teamId('team'), entries: [] };
    const decision: FantasyDecision = {
      id: decisionId('decision'),
      createdAt: '2026-09-01T00:00:00.000Z',
      rationale: 'Test proposal',
      proposedActions: [
        {
          id: deniedId,
          type: 'waiver-claim',
          leagueId: league.id,
          teamId: roster.teamId,
          addPlayerId: playerId('add'),
        },
        {
          id: actionId('approved'),
          type: 'add-drop',
          leagueId: league.id,
          teamId: roster.teamId,
          addPlayerId: playerId('add-2'),
          dropPlayerId: playerId('drop'),
        },
      ],
    };
    const rule: PolicyRule = {
      id: 'deny-one',
      evaluate: (action) =>
        action.id === deniedId
          ? { actionId: action.id, code: 'DENIED', message: 'Denied for test' }
          : undefined,
    };

    const result = await createPolicyEngine([rule]).evaluate(decision, {
      league,
      roster,
      evaluatedAt: '2026-09-01T00:00:01.000Z',
    });

    expect(result.status).toBe('rejected');
    expect(result.approvedActions.map((action) => action.id)).toEqual([
      'approved',
    ]);
    expect(result.issues).toHaveLength(1);
  });
});
