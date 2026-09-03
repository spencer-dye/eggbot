import type {
  ActionId,
  LeagueId,
  PlayerId,
  Roster,
  TeamId,
  Transaction,
  WaiverClaimAction,
} from '@eggbot/core';
import type { FantasyPlatformReader } from '@eggbot/platform';

import type { WaiverManagementRun } from './waivers.js';

export type WaiverTransactionOutcome =
  'pending' | 'succeeded' | 'failed' | 'unknown';

export interface WaiverClaimReconciliation {
  readonly actionId: ActionId;
  readonly externalReference?: string;
  readonly status:
    | 'missing-reference'
    | 'transaction-not-found'
    | 'pending'
    | 'verified'
    | 'mismatch'
    | 'failed'
    | 'verification-failed'
    | 'unknown';
  readonly transaction?: Transaction;
  readonly issues?: readonly (
    | { readonly code: 'ADDED_PLAYER_MISSING'; readonly playerId: PlayerId }
    | { readonly code: 'DROPPED_PLAYER_PRESENT'; readonly playerId: PlayerId }
    | { readonly code: 'TRANSACTION_ADD_MISMATCH'; readonly playerId: PlayerId }
    | {
        readonly code: 'TRANSACTION_DROP_MISMATCH';
        readonly playerId: PlayerId;
      }
  )[];
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export interface WaiverReconciliationRun {
  readonly sourceRunId: string;
  readonly leagueId: LeagueId;
  readonly teamId: TeamId;
  readonly reconciledAt: string;
  readonly status: 'resolved' | 'pending' | 'incomplete' | 'failed';
  readonly claims: readonly WaiverClaimReconciliation[];
}

export interface WaiverReconcilerOptions {
  readonly reader: Pick<FantasyPlatformReader, 'getTransactions' | 'getRoster'>;
  readonly classifyTransaction?: (
    transaction: Transaction,
  ) => WaiverTransactionOutcome;
  readonly transactionLimit: number;
  readonly clock?: () => Date;
}

/** Reconciles submitted claims from provider history and one final roster read. */
export class WaiverReconciler {
  readonly #reader: Pick<
    FantasyPlatformReader,
    'getTransactions' | 'getRoster'
  >;
  readonly #classify: (transaction: Transaction) => WaiverTransactionOutcome;
  readonly #transactionLimit: number;
  readonly #clock: () => Date;

  constructor(options: WaiverReconcilerOptions) {
    if (
      !Number.isSafeInteger(options.transactionLimit) ||
      options.transactionLimit <= 0
    ) {
      throw new RangeError('Reconciliation transactionLimit must be positive');
    }
    this.#reader = options.reader;
    this.#classify = options.classifyTransaction ?? classifyWaiverTransaction;
    this.#transactionLimit = options.transactionLimit;
    this.#clock = options.clock ?? (() => new Date());
  }

  async reconcile(run: WaiverManagementRun): Promise<WaiverReconciliationRun> {
    const reconciledAt = timestamp(this.#clock);
    if (Date.parse(reconciledAt) < Date.parse(run.completedAt)) {
      throw new TypeError('Reconciliation cannot precede its source run');
    }
    const submissions = run.resolutions.flatMap((resolution) => {
      if (resolution.kind !== 'pending-waiver') return [];
      const result = run.executionResults.find(
        ({ action }) => action.id === resolution.actionId,
      );
      if (result?.action.type !== 'waiver-claim') {
        throw new TypeError(
          `Pending waiver ${resolution.actionId} has no matching executed claim`,
        );
      }
      return [
        {
          action: result.action,
          ...(resolution.externalReference === undefined
            ? {}
            : { externalReference: resolution.externalReference }),
        },
      ];
    });

    if (submissions.length === 0) {
      return {
        sourceRunId: run.id,
        leagueId: run.snapshot.league.id,
        teamId: run.decisionRun.managedTeamId,
        reconciledAt,
        status: 'resolved',
        claims: [],
      };
    }

    let transactions: readonly Transaction[];
    try {
      transactions = await this.#reader.getTransactions(
        run.snapshot.league.id,
        {
          limit: this.#transactionLimit,
        },
      );
    } catch (error) {
      return {
        sourceRunId: run.id,
        leagueId: run.snapshot.league.id,
        teamId: run.decisionRun.managedTeamId,
        reconciledAt,
        status: 'failed',
        claims: submissions.map(({ action, externalReference }) => ({
          actionId: action.id,
          ...(externalReference === undefined ? {} : { externalReference }),
          status: 'verification-failed',
          error: operationalError('TRANSACTION_READ_FAILED', error),
        })),
      };
    }

    const transactionById = new Map(
      transactions.map((transaction) => [String(transaction.id), transaction]),
    );
    const provisional = submissions.map(({ action, externalReference }) =>
      classifySubmission(
        action,
        externalReference,
        transactionById,
        this.#classify,
      ),
    );
    const successfulIds = new Set(
      provisional.flatMap((claim) =>
        claim.status === 'verified' ? [claim.actionId] : [],
      ),
    );
    let roster: Roster | undefined;
    let rosterError: unknown;
    if (successfulIds.size > 0) {
      try {
        roster = await this.#reader.getRoster(run.decisionRun.managedTeamId);
      } catch (error) {
        rosterError = error;
      }
    }
    const actionById = new Map(
      submissions.map(({ action }) => [action.id, action] as const),
    );
    const claims = provisional.map((claim): WaiverClaimReconciliation => {
      if (claim.status !== 'verified') return claim;
      if (roster === undefined) {
        return {
          ...claim,
          status: 'verification-failed',
          error: operationalError('ROSTER_READ_FAILED', rosterError),
        };
      }
      const action = actionById.get(claim.actionId);
      if (action === undefined)
        throw new TypeError('Reconciliation action missing');
      const issues = rosterIssues(action, roster);
      return issues.length === 0
        ? claim
        : { ...claim, status: 'mismatch', issues };
    });
    return {
      sourceRunId: run.id,
      leagueId: run.snapshot.league.id,
      teamId: run.decisionRun.managedTeamId,
      reconciledAt,
      status: aggregateStatus(claims),
      claims,
    };
  }
}

export function classifyWaiverTransaction(
  transaction: Transaction,
): WaiverTransactionOutcome {
  const status = transaction.status.trim().toLowerCase();
  if (['pending', 'proposed', 'processing'].includes(status)) return 'pending';
  if (['successful', 'succeeded', 'completed', 'complete'].includes(status)) {
    return 'succeeded';
  }
  if (
    ['failed', 'rejected', 'vetoed', 'cancelled', 'canceled'].includes(status)
  ) {
    return 'failed';
  }
  return 'unknown';
}

function classifySubmission(
  action: WaiverClaimAction,
  externalReference: string | undefined,
  transactions: ReadonlyMap<string, Transaction>,
  classify: (transaction: Transaction) => WaiverTransactionOutcome,
): WaiverClaimReconciliation {
  if (externalReference === undefined) {
    return { actionId: action.id, status: 'missing-reference' };
  }
  const transaction = transactions.get(externalReference);
  if (transaction === undefined) {
    return {
      actionId: action.id,
      externalReference,
      status: 'transaction-not-found',
    };
  }
  const outcome = classify(transaction);
  const transactionIssues =
    outcome === 'succeeded' ? transactionMoveIssues(action, transaction) : [];
  return {
    actionId: action.id,
    externalReference,
    transaction,
    status:
      transactionIssues.length > 0
        ? 'mismatch'
        : outcome === 'succeeded'
          ? 'verified'
          : outcome === 'failed'
            ? 'failed'
            : outcome,
    ...(transactionIssues.length === 0 ? {} : { issues: transactionIssues }),
  };
}

function transactionMoveIssues(
  action: WaiverClaimAction,
  transaction: Transaction,
): NonNullable<WaiverClaimReconciliation['issues']> {
  const hasAdd = transaction.moves.some(
    (move) =>
      move.type === 'add' &&
      move.playerId === action.addPlayerId &&
      move.destinationTeamId === action.teamId,
  );
  const hasDrop =
    action.dropPlayerId === undefined ||
    transaction.moves.some(
      (move) =>
        move.type === 'drop' &&
        move.playerId === action.dropPlayerId &&
        move.sourceTeamId === action.teamId,
    );
  return [
    ...(hasAdd
      ? []
      : [
          {
            code: 'TRANSACTION_ADD_MISMATCH' as const,
            playerId: action.addPlayerId,
          },
        ]),
    ...(hasDrop || action.dropPlayerId === undefined
      ? []
      : [
          {
            code: 'TRANSACTION_DROP_MISMATCH' as const,
            playerId: action.dropPlayerId,
          },
        ]),
  ];
}

function rosterIssues(
  action: WaiverClaimAction,
  roster: Roster,
): NonNullable<WaiverClaimReconciliation['issues']> {
  const players = new Set(roster.entries.map(({ player }) => player.id));
  return [
    ...(players.has(action.addPlayerId)
      ? []
      : [
          {
            code: 'ADDED_PLAYER_MISSING' as const,
            playerId: action.addPlayerId,
          },
        ]),
    ...(action.dropPlayerId === undefined || !players.has(action.dropPlayerId)
      ? []
      : [
          {
            code: 'DROPPED_PLAYER_PRESENT' as const,
            playerId: action.dropPlayerId,
          },
        ]),
  ];
}

function aggregateStatus(
  claims: readonly WaiverClaimReconciliation[],
): WaiverReconciliationRun['status'] {
  if (claims.some(({ status }) => status === 'verification-failed'))
    return 'failed';
  if (claims.some(({ status }) => status === 'pending')) return 'pending';
  if (
    claims.some(({ status }) =>
      [
        'missing-reference',
        'transaction-not-found',
        'unknown',
        'mismatch',
      ].includes(status),
    )
  ) {
    return 'incomplete';
  }
  return 'resolved';
}

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError('Reconciliation clock returned an invalid date');
  }
  return value.toISOString();
}

function operationalError(
  code: string,
  error: unknown,
): { code: string; message: string; retryable?: boolean } {
  const retryable =
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    typeof error.retryable === 'boolean'
      ? error.retryable
      : undefined;
  return {
    code,
    message:
      error instanceof Error
        ? error.message
        : 'Unexpected reconciliation failure',
    ...(retryable === undefined ? {} : { retryable }),
  };
}
