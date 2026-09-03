import { describe, expect, it, vi } from 'vitest';

import {
  actionId,
  leagueId,
  playerId,
  teamId,
  transactionId,
  type Roster,
  type Transaction,
  type WaiverClaimAction,
} from '@eggbot/core';

import {
  WaiverReconciler,
  classifyWaiverTransaction,
} from './reconciliation.js';
import type { WaiverManagementRun } from './waivers.js';

const league = leagueId('league');
const team = teamId('team');
const added = playerId('added');
const dropped = playerId('dropped');
const action: WaiverClaimAction = {
  id: actionId('claim'),
  type: 'waiver-claim',
  leagueId: league,
  teamId: team,
  addPlayerId: added,
  dropPlayerId: dropped,
};
const transaction: Transaction = {
  id: transactionId('provider:transaction:1'),
  leagueId: league,
  type: 'add-drop',
  status: 'successful',
  moves: [
    { type: 'add', playerId: added, destinationTeamId: team },
    { type: 'drop', playerId: dropped, sourceTeamId: team },
  ],
};
const roster: Roster = {
  teamId: team,
  entries: [
    { player: { id: added, fullName: 'Added', eligiblePositions: ['RB'] } },
  ],
};

describe('WaiverReconciler', () => {
  it('verifies a successful transaction against final roster state', async () => {
    const getTransactions = vi.fn(() => Promise.resolve([transaction]));
    const getRoster = vi.fn(() => Promise.resolve(roster));
    const reconciler = new WaiverReconciler({
      reader: { getTransactions, getRoster },
      transactionLimit: 50,
      clock: () => new Date('2026-09-03T12:00:00.000Z'),
    });

    const result = await reconciler.reconcile(sourceRun());

    expect(result).toMatchObject({
      sourceRunId: 'run',
      leagueId: league,
      teamId: team,
      reconciledAt: '2026-09-03T12:00:00.000Z',
      status: 'resolved',
      claims: [
        {
          actionId: action.id,
          externalReference: transaction.id,
          status: 'verified',
        },
      ],
    });
    expect(getTransactions).toHaveBeenCalledWith(league, { limit: 50 });
    expect(getRoster).toHaveBeenCalledWith(team);
  });

  it('keeps missing or pending provider outcomes explicitly unresolved', async () => {
    const pending = { ...transaction, status: 'pending' };
    const reconciler = new WaiverReconciler({
      reader: {
        getTransactions: () => Promise.resolve([pending]),
        getRoster: () => Promise.resolve(roster),
      },
      transactionLimit: 10,
    });
    expect((await reconciler.reconcile(sourceRun())).status).toBe('pending');
    expect(
      classifyWaiverTransaction({ ...transaction, status: 'new-state' }),
    ).toBe('unknown');
  });

  it('rejects mismatched transaction evidence even when status says success', async () => {
    const reconciler = new WaiverReconciler({
      reader: {
        getTransactions: () => Promise.resolve([{ ...transaction, moves: [] }]),
        getRoster: () => Promise.resolve(roster),
      },
      transactionLimit: 10,
    });

    expect(await reconciler.reconcile(sourceRun())).toMatchObject({
      status: 'incomplete',
      claims: [
        {
          status: 'mismatch',
          issues: [
            { code: 'TRANSACTION_ADD_MISMATCH', playerId: added },
            { code: 'TRANSACTION_DROP_MISMATCH', playerId: dropped },
          ],
        },
      ],
    });
  });

  it('retains retry classification when transaction history cannot be read', async () => {
    const error = Object.assign(new Error('temporarily unavailable'), {
      retryable: true,
    });
    const reconciler = new WaiverReconciler({
      reader: {
        getTransactions: () => Promise.reject(error),
        getRoster: () => Promise.resolve(roster),
      },
      transactionLimit: 10,
    });

    expect(await reconciler.reconcile(sourceRun())).toMatchObject({
      status: 'failed',
      claims: [
        {
          status: 'verification-failed',
          error: { code: 'TRANSACTION_READ_FAILED', retryable: true },
        },
      ],
    });
  });
});

function sourceRun(): WaiverManagementRun {
  return {
    id: 'run',
    completedAt: '2026-09-02T12:00:00.000Z',
    snapshot: { league: { id: league } },
    decisionRun: { managedTeamId: team },
    executionResults: [
      { status: 'executed', action, externalReference: transaction.id },
    ],
    resolutions: [
      {
        actionId: action.id,
        kind: 'pending-waiver',
        externalReference: transaction.id,
      },
    ],
  } as unknown as WaiverManagementRun;
}
