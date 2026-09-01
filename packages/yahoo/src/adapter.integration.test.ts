import { describe, expect, it } from 'vitest';

import { YahooFantasyReader } from './adapter.js';
import { YahooHttpClient } from './http.js';
import { yahooLeagueId, yahooTeamId } from './identifiers.js';
import { YahooOAuthClient, type YahooTokenSet } from './oauth.js';

const integrationEnabled = process.env.YAHOO_INTEGRATION === '1';

describe.runIf(integrationEnabled)('Yahoo live read integration', () => {
  it('exercises every Phase 1 read against an explicitly configured league', async () => {
    const week = requireEnvironment('YAHOO_INTEGRATION_WEEK');
    const oauth = new YahooOAuthClient({
      config: {
        clientId: requireEnvironment('YAHOO_CLIENT_ID'),
        clientSecret: requireEnvironment('YAHOO_CLIENT_SECRET'),
        redirectUri: process.env.YAHOO_REDIRECT_URI ?? 'oob',
      },
      tokens: tokensFromEnvironment(),
    });
    const reader = new YahooFantasyReader({
      httpClient: new YahooHttpClient({ tokenProvider: oauth }),
    });

    const games = await reader.getUserGames();
    expect(games.length).toBeGreaterThan(0);

    const leagues = await reader.getUserLeagues(games[0]?.platformReference);
    expect(leagues.length).toBeGreaterThan(0);
    const leagueId =
      process.env.YAHOO_INTEGRATION_LEAGUE_KEY === undefined
        ? leagues[0]?.id
        : yahooLeagueId(process.env.YAHOO_INTEGRATION_LEAGUE_KEY);
    expect(leagueId).toBeDefined();
    if (leagueId === undefined) return;

    const [
      league,
      teams,
      standings,
      matchups,
      available,
      waivers,
      transactions,
    ] = await Promise.all([
      reader.getLeague(leagueId),
      reader.getTeams(leagueId),
      reader.getStandings(leagueId),
      reader.getMatchups(leagueId, week),
      reader.getAvailablePlayers(leagueId, {
        availability: 'available',
        limit: 1,
      }),
      reader.getAvailablePlayers(leagueId, {
        availability: 'waivers',
        limit: 1,
      }),
      reader.getTransactions(leagueId, { limit: 1 }),
    ]);
    expect(league.id).toBe(leagueId);
    expect(teams.length).toBeGreaterThan(0);
    expect(standings).toBeInstanceOf(Array);
    expect(matchups).toBeInstanceOf(Array);
    expect(available).toBeInstanceOf(Array);
    expect(waivers).toBeInstanceOf(Array);
    expect(transactions).toBeInstanceOf(Array);

    const teamId =
      process.env.YAHOO_INTEGRATION_TEAM_KEY === undefined
        ? teams[0]?.id
        : yahooTeamId(process.env.YAHOO_INTEGRATION_TEAM_KEY);
    expect(teamId).toBeDefined();
    if (teamId === undefined) return;

    const [roster, lineup] = await Promise.all([
      reader.getRoster(teamId),
      reader.getLineup(teamId, week),
    ]);
    expect(roster.teamId).toBe(teamId);
    expect(lineup.teamId).toBe(teamId);
  }, 60_000);
});

function tokensFromEnvironment(): YahooTokenSet {
  return {
    accessToken: requireEnvironment('YAHOO_ACCESS_TOKEN'),
    refreshToken: requireEnvironment('YAHOO_REFRESH_TOKEN'),
    tokenType: 'bearer',
    expiresAt: parseExpiration(requireEnvironment('YAHOO_TOKEN_EXPIRES_AT')),
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Live Yahoo integration requires ${name}`);
  }
  return value;
}

function parseExpiration(value: string): number {
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
