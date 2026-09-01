import type { LeagueId, PlayerId } from '@eggbot/core';

import { YahooResponseValidationError } from './errors.js';
import type { YahooHttpClient } from './http.js';
import { yahooLeagueKey, yahooPlayerKey } from './identifiers.js';
import { findFirstValue } from './yahoo-json.js';

export type YahooPlayerAvailability = 'free-agent' | 'waivers' | 'rostered';

export interface YahooPlayerAvailabilityReader {
  getPlayerAvailability(
    leagueId: LeagueId,
    playerId: PlayerId,
  ): Promise<YahooPlayerAvailability>;
}

export class YahooPlayerAvailabilityClient implements YahooPlayerAvailabilityReader {
  readonly #http: YahooHttpClient;

  constructor(httpClient: YahooHttpClient) {
    this.#http = httpClient;
  }

  async getPlayerAvailability(
    leagueId: LeagueId,
    playerId: PlayerId,
  ): Promise<YahooPlayerAvailability> {
    const leagueKey = yahooLeagueKey(leagueId);
    const playerKey = yahooPlayerKey(playerId);
    const content = await this.#http.get(
      `/league/${encodePathKey(leagueKey)}/players;player_keys=${encodePathKey(playerKey)}/ownership`,
    );
    return parseYahooPlayerAvailability(content);
  }
}

export function parseYahooPlayerAvailability(
  content: unknown,
): YahooPlayerAvailability {
  const ownership = findFirstValue(content, 'ownership_type');
  if (typeof ownership !== 'string') {
    throw new YahooResponseValidationError(
      'Yahoo player ownership response was missing ownership_type',
      { resource: 'player_ownership', details: content },
    );
  }
  const normalized = ownership.toLowerCase().replaceAll(/[_ -]/g, '');
  if (normalized === 'freeagent' || normalized === 'freeagents') {
    return 'free-agent';
  }
  if (normalized === 'waiver' || normalized === 'waivers') return 'waivers';
  if (normalized === 'team') return 'rostered';
  throw new YahooResponseValidationError(
    `Unsupported Yahoo player ownership type: ${ownership}`,
    { resource: 'player_ownership', details: ownership },
  );
}

function encodePathKey(value: string): string {
  return value
    .split('.')
    .map((part) => encodeURIComponent(part))
    .join('.');
}
