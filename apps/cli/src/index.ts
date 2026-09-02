import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  sumProjectedStartingLineupPoints,
  type ProjectionSet,
} from '@eggbot/analytics';
import {
  createNoActionDecisionEngine,
  createProjectedLineupDecisionEngine,
  createProjectedWaiverDecisionEngine,
} from '@eggbot/agent-local';
import {
  AutonomousLineupManager,
  AutonomousWaiverManager,
} from '@eggbot/manager';
import { createPolicyEngine } from '@eggbot/policy';
import {
  actionId,
  leagueId,
  playerId,
  teamId,
  type FantasyAction,
  type Lineup,
  type Position,
} from '@eggbot/core';
import {
  buildYahooWriteRequest,
  YahooFantasyReader,
  YahooFantasyExecutor,
  YahooHttpClient,
  YahooOAuthClient,
  yahooAdapterMetadata,
  yahooLeagueId,
  yahooPlayerId,
  yahooRosterSlotId,
  yahooTeamId,
  type YahooOAuthConfig,
  type YahooTokenSet,
} from '@eggbot/yahoo';
import { LeagueSnapshotService } from '@eggbot/snapshot';

import { createFileTokenStore, redactTokens } from './token-file-store.js';

const emptyLineup: Lineup = {
  teamId: teamId('phase-zero-team'),
  scoringPeriod: 'demo',
  assignments: [],
};
const defaultTokenFile = resolve(
  import.meta.dirname,
  '../../..',
  '.eggbot/yahoo-tokens.json',
);

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 0 || args[0] === 'smoke') {
    const decisionEngine = createNoActionDecisionEngine({
      id: 'eggbot-safe-default',
      version: '1.0.0',
      rationale: 'No autonomous decision strategy is configured.',
    });
    const policyEngine = createPolicyEngine();
    printJson({
      analyticsResult: sumProjectedStartingLineupPoints(
        emptyLineup,
        { rosterSlots: [], scoringRules: [] },
        [],
      ),
      analyticsCapabilities: [
        'lineup-projections',
        'matchup-margins',
        'best-available-value',
        'available-pool-scarcity',
        'roster-risk',
      ],
      decisionEngine: {
        id: decisionEngine.id,
        version: decisionEngine.version,
        kind: decisionEngine.kind,
        behavior: 'no-action',
      },
      policyCapabilities: [
        'snapshot-bound-validation',
        'structured-rejections',
        'configurable-guardrails',
        'conflict-detection',
        'batch-roster-capacity',
        'waiver-system-validation',
        'acquisition-limit-validation',
        'batch-waiver-budget',
        'execution-approval',
      ],
      policyEngine: {
        id: policyEngine.id,
        version: policyEngine.version,
        guardrails: policyEngine.guardrails,
        ruleIds: policyEngine.ruleIds,
      },
      platformBoundary: yahooAdapterMetadata,
      managerCapabilities: [
        'autonomous-lineup-dry-run',
        'autonomous-lineup-execution',
        'freshness-enforcement',
        'mandatory-platform-preflight',
        'post-execution-verification',
        'autonomous-waiver-dry-run',
        'autonomous-waiver-execution',
        'ordered-claims',
        'budget-aware-bidding',
        'complete-audit-record',
      ],
      phase: 8,
      writeOperations: 'guarded',
    });
    return;
  }

  if (args[0] !== 'yahoo' || args[1] === undefined || args[1] === 'help') {
    printHelp();
    return;
  }

  const command = args[1];
  const commandArgs = args.slice(2);
  const writeAction = parseWriteAction(command, commandArgs);
  const shouldExecute = commandArgs.includes('--execute');
  if (writeAction !== undefined && !shouldExecute) {
    printJson(buildYahooWriteRequest(writeAction));
    return;
  }
  if (writeAction !== undefined) {
    if (readOption(commandArgs, '--action-id') === undefined) {
      throw new Error('--action-id is required with --execute');
    }
    if (process.env.YAHOO_ENABLE_WRITES !== '1') {
      throw new Error('--execute also requires YAHOO_ENABLE_WRITES=1');
    }
  }
  if (
    (command === 'manage-lineup' || command === 'manage-waivers') &&
    shouldExecute &&
    process.env.YAHOO_ENABLE_WRITES !== '1'
  ) {
    throw new Error('--execute also requires YAHOO_ENABLE_WRITES=1');
  }
  const config = yahooConfigFromEnvironment();
  const initialTokens = tokensFromEnvironment();
  const tokenStore = createFileTokenStore({
    path: process.env.YAHOO_TOKEN_FILE ?? defaultTokenFile,
    ...(initialTokens === undefined ? {} : { initialTokens }),
    onSaved: (path, tokens) => {
      console.error(
        `Yahoo tokens saved to ${path}: ${JSON.stringify(redactTokens(tokens))}`,
      );
    },
  });
  const oauth = new YahooOAuthClient({ config, tokenStore });

  if (command === 'auth-url') {
    console.log(
      oauth
        .createAuthorizationUrl(
          commandArgs[0] === undefined ? {} : { state: commandArgs[0] },
        )
        .toString(),
    );
    return;
  }
  if (command === 'exchange') {
    const tokens = await oauth.exchangeAuthorizationCode(
      requireArgument(commandArgs, 0, 'code'),
    );
    printJson(
      commandArgs.includes('--show-secrets') ? tokens : redactTokens(tokens),
    );
    return;
  }

  const httpClient = new YahooHttpClient({ tokenProvider: oauth });
  const reader = new YahooFantasyReader({ httpClient });

  if (writeAction !== undefined) {
    const executor = new YahooFantasyExecutor({
      httpClient,
      reader,
      allowWrites: true,
    });
    printJson(await executor.execute([writeAction], { mode: 'execute' }));
    return;
  }

  switch (command) {
    case 'games':
      printJson(await reader.getUserGames());
      break;
    case 'leagues':
      printJson(await reader.getUserLeagues(commandArgs[0]));
      break;
    case 'league':
      printJson(
        await reader.getLeague(
          asLeagueId(requireArgument(commandArgs, 0, 'league key')),
        ),
      );
      break;
    case 'teams':
      printJson(
        await reader.getTeams(
          asLeagueId(requireArgument(commandArgs, 0, 'league key')),
        ),
      );
      break;
    case 'roster':
      printJson(
        await reader.getRoster(
          asTeamId(requireArgument(commandArgs, 0, 'team key')),
        ),
      );
      break;
    case 'lineup':
      printJson(
        await reader.getLineup(
          asTeamId(requireArgument(commandArgs, 0, 'team key')),
          requireArgument(commandArgs, 1, 'week'),
        ),
      );
      break;
    case 'standings':
      printJson(
        await reader.getStandings(
          asLeagueId(requireArgument(commandArgs, 0, 'league key')),
        ),
      );
      break;
    case 'matchups':
      printJson(
        await reader.getMatchups(
          asLeagueId(requireArgument(commandArgs, 0, 'league key')),
          requireArgument(commandArgs, 1, 'week'),
        ),
      );
      break;
    case 'players': {
      const search = readOption(commandArgs, '--search');
      const limit = readNumberOption(commandArgs, '--limit');
      const availability = readAvailability(commandArgs);
      const positions = readPositions(commandArgs);
      printJson(
        await reader.getAvailablePlayers(
          asLeagueId(requireArgument(commandArgs, 0, 'league key')),
          {
            ...(search === undefined ? {} : { text: search }),
            ...(limit === undefined ? {} : { limit }),
            ...(availability === undefined ? {} : { availability }),
            ...(positions === undefined ? {} : { positions }),
          },
        ),
      );
      break;
    }
    case 'transactions': {
      const limit = readNumberOption(commandArgs, '--limit');
      printJson(
        await reader.getTransactions(
          asLeagueId(requireArgument(commandArgs, 0, 'league key')),
          limit === undefined ? {} : { limit },
        ),
      );
      break;
    }
    case 'snapshot': {
      const snapshotService = new LeagueSnapshotService({ reader });
      printJson(
        await snapshotService.capture({
          leagueId: asLeagueId(requireArgument(commandArgs, 0, 'league key')),
          scoringPeriod: requireArgument(commandArgs, 1, 'scoring period'),
          freeAgentLimit:
            readNumberOption(commandArgs, '--free-agent-limit') ?? 50,
          waiverLimit: readNumberOption(commandArgs, '--waiver-limit') ?? 50,
          transactionLimit:
            readNumberOption(commandArgs, '--transaction-limit') ?? 25,
          teamReadConcurrency:
            readNumberOption(commandArgs, '--team-concurrency') ?? 4,
        }),
      );
      break;
    }
    case 'manage-lineup': {
      const leagueId = asLeagueId(
        requireArgument(commandArgs, 0, 'league key'),
      );
      const managedTeamId = asTeamId(
        requireArgument(commandArgs, 1, 'team key'),
      );
      const scoringPeriod = requireArgument(commandArgs, 2, 'week');
      const projectionSet = await readProjectionFile(
        requireOption(commandArgs, '--projections'),
      );
      const maxSnapshotAgeMs =
        readNumberOption(commandArgs, '--max-snapshot-age-ms') ??
        5 * 60 * 1_000;
      const manager = new AutonomousLineupManager({
        snapshotService: new LeagueSnapshotService({ reader }),
        projectionProvider: {
          getProjections: () => Promise.resolve(projectionSet),
        },
        decisionEngine: createProjectedLineupDecisionEngine({
          minimumProjectedPointGain:
            readNonNegativeFiniteOption(commandArgs, '--minimum-gain') ?? 0.1,
        }),
        policyEngine: createPolicyEngine({
          guardrails: {
            maxSnapshotAgeMs,
            maxActionsPerDecision: 1,
            maxRosterMutationActions: 0,
          },
        }),
        executor: new YahooFantasyExecutor({
          httpClient,
          reader,
          allowWrites: shouldExecute,
        }),
        lineupReader: reader,
        maxProjectionAgeMs:
          readNumberOption(commandArgs, '--max-projection-age-ms') ??
          30 * 60 * 1_000,
      });
      printJson(
        await manager.run({
          leagueId,
          managedTeamId,
          scoringPeriod,
          executionMode: shouldExecute ? 'execute' : 'dry-run',
          freeAgentLimit:
            readNumberOption(commandArgs, '--free-agent-limit') ?? 50,
          waiverLimit: readNumberOption(commandArgs, '--waiver-limit') ?? 50,
          transactionLimit:
            readNumberOption(commandArgs, '--transaction-limit') ?? 25,
          teamReadConcurrency:
            readNumberOption(commandArgs, '--team-concurrency') ?? 4,
        }),
      );
      break;
    }
    case 'manage-waivers': {
      const leagueId = asLeagueId(
        requireArgument(commandArgs, 0, 'league key'),
      );
      const managedTeamId = asTeamId(
        requireArgument(commandArgs, 1, 'team key'),
      );
      const scoringPeriod = requireArgument(commandArgs, 2, 'week');
      const projectionSet = await readProjectionFile(
        requireOption(commandArgs, '--projections'),
      );
      const fixedBid = readNonNegativeFiniteOption(commandArgs, '--bid');
      const bidPercentage = readNonNegativeFiniteOption(
        commandArgs,
        '--bid-percent',
      );
      if (fixedBid !== undefined && bidPercentage !== undefined) {
        throw new Error('Use either --bid or --bid-percent, not both');
      }
      const maximumActions =
        readNumberOption(commandArgs, '--max-actions') ?? 1;
      const maxWaiverBid = readNonNegativeFiniteOption(
        commandArgs,
        '--max-waiver-bid',
      );
      const maximumWaiverPriorityRank = readNumberOption(
        commandArgs,
        '--max-waiver-priority',
      );
      const maxSnapshotAgeMs =
        readNumberOption(commandArgs, '--max-snapshot-age-ms') ??
        5 * 60 * 1_000;
      const manager = new AutonomousWaiverManager({
        snapshotService: new LeagueSnapshotService({ reader }),
        projectionProvider: {
          getProjections: () => Promise.resolve(projectionSet),
        },
        decisionEngine: createProjectedWaiverDecisionEngine({
          maximumActions,
          minimumProjectedPointGain:
            readNonNegativeFiniteOption(commandArgs, '--minimum-gain') ?? 1,
          includeFreeAgents: !commandArgs.includes('--waivers-only'),
          ...(maximumWaiverPriorityRank === undefined
            ? {}
            : { maximumWaiverPriorityRank }),
          ...(fixedBid !== undefined
            ? { bidStrategy: { kind: 'fixed' as const, amount: fixedBid } }
            : bidPercentage !== undefined
              ? {
                  bidStrategy: {
                    kind: 'percentage-of-remaining' as const,
                    percentage: bidPercentage,
                  },
                }
              : {}),
        }),
        policyEngine: createPolicyEngine({
          guardrails: {
            maxSnapshotAgeMs,
            maxActionsPerDecision: maximumActions,
            maxRosterMutationActions: maximumActions,
            ...(maxWaiverBid === undefined ? {} : { maxWaiverBid }),
          },
        }),
        executor: new YahooFantasyExecutor({
          httpClient,
          reader,
          allowWrites: shouldExecute,
        }),
        maxProjectionAgeMs:
          readNumberOption(commandArgs, '--max-projection-age-ms') ??
          30 * 60 * 1_000,
      });
      printJson(
        await manager.run({
          leagueId,
          managedTeamId,
          scoringPeriod,
          executionMode: shouldExecute ? 'execute' : 'dry-run',
          freeAgentLimit:
            readNumberOption(commandArgs, '--free-agent-limit') ?? 50,
          waiverLimit: readNumberOption(commandArgs, '--waiver-limit') ?? 50,
          transactionLimit:
            readNumberOption(commandArgs, '--transaction-limit') ?? 25,
          teamReadConcurrency:
            readNumberOption(commandArgs, '--team-concurrency') ?? 4,
        }),
      );
      break;
    }
    default:
      throw new Error(`Unknown Yahoo command: ${command}`);
  }
}

function parseWriteAction(
  command: string,
  args: readonly string[],
): FantasyAction | undefined {
  if (
    command !== 'lineup-change' &&
    command !== 'add' &&
    command !== 'drop' &&
    command !== 'add-drop' &&
    command !== 'waiver'
  ) {
    return undefined;
  }
  const id = actionId(readOption(args, '--action-id') ?? `preview-${command}`);
  const league = asLeagueId(requireArgument(args, 0, 'league key'));
  const team = asTeamId(requireArgument(args, 1, 'team key'));

  if (command === 'lineup-change') {
    const scoringPeriod = requireArgument(args, 2, 'week');
    if (
      !Number.isSafeInteger(Number(scoringPeriod)) ||
      Number(scoringPeriod) < 1
    ) {
      throw new Error('week must be a positive integer');
    }
    const assignmentsText = requireArgument(args, 3, 'assignments');
    const ordinals = new Map<string, number>();
    const assignments = assignmentsText.split(',').map((item) => {
      const separator = item.lastIndexOf('=');
      if (separator < 1 || separator === item.length - 1) {
        throw new Error('assignments must use player-key=Yahoo-position');
      }
      const playerKey = item.slice(0, separator);
      const position = item.slice(separator + 1);
      const ordinal = (ordinals.get(position) ?? 0) + 1;
      ordinals.set(position, ordinal);
      return {
        playerId: asPlayerId(playerKey),
        slotId: yahooRosterSlotId(
          writeLeagueKey(requireArgument(args, 0, 'league key')),
          position,
          ordinal,
        ),
      };
    });
    return {
      id,
      type: 'set-lineup',
      leagueId: league,
      teamId: team,
      scoringPeriod,
      assignments,
    };
  }

  const player = asPlayerId(requireArgument(args, 2, 'player key'));
  if (command === 'add' || command === 'drop') {
    return {
      id,
      type: command === 'add' ? 'add-player' : 'drop-player',
      leagueId: league,
      teamId: team,
      playerId: player,
    };
  }
  const addPlayerId = player;
  if (command === 'add-drop') {
    return {
      id,
      type: 'add-drop',
      leagueId: league,
      teamId: team,
      addPlayerId,
      dropPlayerId: asPlayerId(requireArgument(args, 3, 'drop player key')),
    };
  }

  const dropPlayer = positionalArgument(args, 3);
  const bid = readNonNegativeNumberOption(args, '--bid');
  return {
    id,
    type: 'waiver-claim',
    leagueId: league,
    teamId: team,
    addPlayerId,
    ...(dropPlayer === undefined
      ? {}
      : { dropPlayerId: asPlayerId(dropPlayer) }),
    ...(bid === undefined ? {} : { bid }),
  };
}

function yahooConfigFromEnvironment(): YahooOAuthConfig {
  return {
    clientId: requireEnvironment('YAHOO_CLIENT_ID'),
    clientSecret: requireEnvironment('YAHOO_CLIENT_SECRET'),
    redirectUri: process.env.YAHOO_REDIRECT_URI ?? 'oob',
  };
}

function tokensFromEnvironment(): YahooTokenSet | undefined {
  const accessToken = process.env.YAHOO_ACCESS_TOKEN;
  if (accessToken === undefined) return undefined;

  return {
    accessToken,
    tokenType: 'bearer',
    expiresAt: parseExpiration(process.env.YAHOO_TOKEN_EXPIRES_AT),
    ...(process.env.YAHOO_REFRESH_TOKEN === undefined
      ? {}
      : { refreshToken: process.env.YAHOO_REFRESH_TOKEN }),
  };
}

function parseExpiration(value: string | undefined): number {
  if (value === undefined) return Date.now() + 3_600_000;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(
      'YAHOO_TOKEN_EXPIRES_AT must be epoch milliseconds or an ISO timestamp',
    );
  }
  return parsed;
}

function asLeagueId(value: string) {
  return value.startsWith('yahoo:league:')
    ? leagueId(value)
    : yahooLeagueId(value);
}

function asTeamId(value: string) {
  return value.startsWith('yahoo:team:') ? teamId(value) : yahooTeamId(value);
}

function asPlayerId(value: string) {
  return value.startsWith('yahoo:player:')
    ? playerId(value)
    : yahooPlayerId(value);
}

function writeLeagueKey(value: string): string {
  return value.startsWith('yahoo:league:')
    ? value.slice('yahoo:league:'.length)
    : value;
}

function positionalArgument(
  args: readonly string[],
  index: number,
): string | undefined {
  const value = args[index];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

function requireArgument(
  args: readonly string[],
  index: number,
  name: string,
): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing required ${name}`);
  }
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return value;
}

function readNumberOption(
  args: readonly string[],
  name: string,
): number | undefined {
  const value = readOption(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function readNonNegativeNumberOption(
  args: readonly string[],
  name: string,
): number | undefined {
  const value = readOption(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return number;
}

function readNonNegativeFiniteOption(
  args: readonly string[],
  name: string,
): number | undefined {
  const value = readOption(args, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return number;
}

function requireOption(args: readonly string[], name: string): string {
  const value = readOption(args, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

async function readProjectionFile(path: string): Promise<ProjectionSet> {
  const value: unknown = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (!isRecord(value) || !Array.isArray(value.players)) {
    throw new Error('Projection file must contain a projection-set object');
  }
  if (
    typeof value.scoringPeriod !== 'string' ||
    typeof value.observedAt !== 'string' ||
    typeof value.source !== 'string' ||
    (value.version !== undefined && typeof value.version !== 'string')
  ) {
    throw new Error('Projection file provenance is malformed');
  }
  return {
    scoringPeriod: value.scoringPeriod,
    observedAt: value.observedAt,
    source: value.source,
    ...(value.version === undefined ? {} : { version: value.version }),
    players: value.players.map((item, index) => {
      if (
        !isRecord(item) ||
        typeof item.playerId !== 'string' ||
        typeof item.points !== 'number' ||
        (item.floor !== undefined && typeof item.floor !== 'number') ||
        (item.ceiling !== undefined && typeof item.ceiling !== 'number')
      ) {
        throw new Error(`Projection file player ${index} is malformed`);
      }
      return {
        playerId: asPlayerId(item.playerId),
        points: item.points,
        ...(item.floor === undefined ? {} : { floor: item.floor }),
        ...(item.ceiling === undefined ? {} : { ceiling: item.ceiling }),
      };
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAvailability(
  args: readonly string[],
): 'available' | 'free-agent' | 'waivers' | undefined {
  const value = readOption(args, '--availability');
  if (value === undefined) return undefined;
  if (value === 'available' || value === 'free-agent' || value === 'waivers')
    return value;
  throw new Error('--availability must be available, free-agent, or waivers');
}

function readPositions(
  args: readonly string[],
): readonly Position[] | undefined {
  const value = readOption(args, '--positions');
  if (value === undefined) return undefined;
  const supported: readonly Position[] = [
    'QB',
    'RB',
    'WR',
    'TE',
    'K',
    'DEF',
    'DL',
    'LB',
    'DB',
    'FLEX',
    'SUPER_FLEX',
  ];
  const positions = value.split(',');
  if (
    !positions.every((position): position is Position =>
      supported.includes(position as Position),
    )
  ) {
    throw new Error(
      '--positions must be a comma-separated list of EggBot positions',
    );
  }
  return positions;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`EggBot CLI

  pnpm cli [smoke]
  pnpm cli yahoo auth-url [state]
  pnpm cli yahoo exchange <authorization-code> [--show-secrets]
  pnpm cli yahoo games
  pnpm cli yahoo leagues [game-key]
  pnpm cli yahoo league <league-key>
  pnpm cli yahoo teams <league-key>
  pnpm cli yahoo roster <team-key>
  pnpm cli yahoo lineup <team-key> <week>
  pnpm cli yahoo standings <league-key>
  pnpm cli yahoo matchups <league-key> <week>
  pnpm cli yahoo players <league-key> [--availability available|free-agent|waivers]
      [--positions RB,WR] [--search text] [--limit count]
  pnpm cli yahoo transactions <league-key> [--limit count]
  pnpm cli yahoo snapshot <league-key> <scoring-period>
      [--free-agent-limit count] [--waiver-limit count]
      [--transaction-limit count] [--team-concurrency count]
  pnpm cli yahoo manage-lineup <league-key> <team-key> <week>
      --projections path [--minimum-gain points]
      [--max-snapshot-age-ms milliseconds]
      [--max-projection-age-ms milliseconds] [--execute]
  pnpm cli yahoo manage-waivers <league-key> <team-key> <week>
      --projections path [--minimum-gain points] [--max-actions count]
      [--bid amount | --bid-percent fraction] [--max-waiver-bid amount]
      [--max-waiver-priority rank]
      [--waivers-only] [--max-snapshot-age-ms milliseconds]
      [--max-projection-age-ms milliseconds] [--execute]
  pnpm cli yahoo lineup-change <league-key> <team-key> <week>
      <player-key=Yahoo-position,...> [--action-id id] [--execute]
  pnpm cli yahoo add <league-key> <team-key> <player-key>
      [--action-id id] [--execute]
  pnpm cli yahoo drop <league-key> <team-key> <player-key>
      [--action-id id] [--execute]
  pnpm cli yahoo add-drop <league-key> <team-key> <add-player-key>
      <drop-player-key> [--action-id id] [--execute]
  pnpm cli yahoo waiver <league-key> <team-key> <add-player-key>
      [drop-player-key] [--bid amount] [--action-id id] [--execute]

Direct write commands print an XML preview by default. Direct live writes require
--execute, --action-id, and YAHOO_ENABLE_WRITES=1. Autonomous lineup and waiver
execution use host-owned action IDs and require --execute plus YAHOO_ENABLE_WRITES=1.

Environment:
  YAHOO_CLIENT_ID              required for Yahoo commands
  YAHOO_CLIENT_SECRET          required for Yahoo commands
  YAHOO_REDIRECT_URI           defaults to oob
  YAHOO_ACCESS_TOKEN           optional if the token file exists
  YAHOO_REFRESH_TOKEN          enables automatic refresh
  YAHOO_TOKEN_EXPIRES_AT       epoch milliseconds or ISO time
  YAHOO_ENABLE_WRITES          must be 1 in addition to --execute
  YAHOO_TOKEN_FILE             defaults to ${defaultTokenFile}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
  process.exitCode = 1;
});
