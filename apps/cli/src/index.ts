import { sumProjectedLineupPoints } from '@eggbot/analytics';
import { leagueId, teamId, type Lineup } from '@eggbot/core';
import {
  YahooFantasyReader,
  YahooHttpClient,
  YahooOAuthClient,
  yahooAdapterMetadata,
  yahooLeagueId,
  yahooTeamId,
  type YahooOAuthConfig,
  type YahooTokenSet,
  type YahooTokenStore,
} from '@eggbot/yahoo';

const emptyLineup: Lineup = {
  teamId: teamId('phase-zero-team'),
  scoringPeriod: 'demo',
  assignments: [],
};

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 0 || args[0] === 'smoke') {
    printJson({
      analyticsResult: sumProjectedLineupPoints(emptyLineup, []),
      platformBoundary: yahooAdapterMetadata,
      phase: 1,
      writeOperations: false,
    });
    return;
  }

  if (args[0] !== 'yahoo' || args[1] === undefined || args[1] === 'help') {
    printHelp();
    return;
  }

  const command = args[1];
  const commandArgs = args.slice(2);
  const config = yahooConfigFromEnvironment();
  const tokenStore = createCliTokenStore(tokensFromEnvironment());
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
    printJson(
      await oauth.exchangeAuthorizationCode(
        requireArgument(commandArgs, 0, 'code'),
      ),
    );
    return;
  }

  const reader = new YahooFantasyReader({
    httpClient: new YahooHttpClient({ tokenProvider: oauth }),
  });

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
      printJson(
        await reader.getAvailablePlayers(
          asLeagueId(requireArgument(commandArgs, 0, 'league key')),
          {
            ...(search === undefined ? {} : { text: search }),
            ...(limit === undefined ? {} : { limit }),
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
    default:
      throw new Error(`Unknown Yahoo command: ${command}`);
  }
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

function createCliTokenStore(
  initialTokens: YahooTokenSet | undefined,
): YahooTokenStore {
  let tokens = initialTokens;
  return {
    load: () => Promise.resolve(tokens),
    save: (updated) => {
      tokens = updated;
      console.error(
        `Yahoo tokens updated for caller-managed persistence:\n${JSON.stringify(updated)}`,
      );
      return Promise.resolve();
    },
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

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`EggBot CLI

  pnpm cli [smoke]
  pnpm cli yahoo auth-url [state]
  pnpm cli yahoo exchange <authorization-code>
  pnpm cli yahoo games
  pnpm cli yahoo leagues [game-key]
  pnpm cli yahoo league <league-key>
  pnpm cli yahoo teams <league-key>
  pnpm cli yahoo roster <team-key>
  pnpm cli yahoo lineup <team-key> <week>
  pnpm cli yahoo standings <league-key>
  pnpm cli yahoo matchups <league-key> <week>
  pnpm cli yahoo players <league-key> [--search text] [--limit count]
  pnpm cli yahoo transactions <league-key> [--limit count]

Environment:
  YAHOO_CLIENT_ID              required for Yahoo commands
  YAHOO_CLIENT_SECRET          required for Yahoo commands
  YAHOO_REDIRECT_URI           defaults to oob
  YAHOO_ACCESS_TOKEN           required for read commands
  YAHOO_REFRESH_TOKEN          enables automatic refresh
  YAHOO_TOKEN_EXPIRES_AT       epoch milliseconds or ISO time`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
  process.exitCode = 1;
});
