import { describe, expect, it } from 'vitest';

import { playerId, rosterSlotId, teamId } from '@eggbot/core';

import { sumProjectedLineupPoints } from './index.js';

describe('sumProjectedLineupPoints', () => {
  it('totals assigned players and ignores unassigned projections', () => {
    const starter = playerId('starter');
    const lineup = {
      teamId: teamId('team'),
      scoringPeriod: '1',
      assignments: [{ slotId: rosterSlotId('qb'), playerId: starter }],
    };

    expect(
      sumProjectedLineupPoints(lineup, [
        { playerId: starter, points: 18.5 },
        { playerId: playerId('bench'), points: 12 },
      ]),
    ).toBe(18.5);
  });
});
