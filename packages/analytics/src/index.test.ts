import { describe, expect, it } from 'vitest';

import { playerId, rosterSlotId, teamId } from '@eggbot/core';

import { sumProjectedStartingLineupPoints } from './index.js';

describe('sumProjectedStartingLineupPoints', () => {
  it('totals active assignments but excludes bench and unassigned projections', () => {
    const starter = playerId('starter');
    const bench = playerId('bench');
    const activeSlot = rosterSlotId('qb');
    const benchSlot = rosterSlotId('bench');
    const lineup = {
      teamId: teamId('team'),
      scoringPeriod: '1',
      assignments: [
        { slotId: activeSlot, playerId: starter },
        { slotId: benchSlot, playerId: bench },
      ],
    };

    expect(
      sumProjectedStartingLineupPoints(
        lineup,
        {
          rosterSlots: [
            {
              id: activeSlot,
              name: 'QB',
              kind: 'active',
              eligiblePositions: ['QB'],
            },
            {
              id: benchSlot,
              name: 'BN',
              kind: 'bench',
              eligiblePositions: ['QB'],
            },
          ],
          scoringRules: [],
        },
        [
          { playerId: starter, points: 18.5 },
          { playerId: bench, points: 12 },
          { playerId: playerId('unassigned'), points: 30 },
        ],
      ),
    ).toBe(18.5);
  });
});
