import {
  leagueId,
  playerId,
  rosterSlotId,
  teamId,
  transactionId,
  type LeagueId,
  type PlayerId,
  type RosterSlotId,
  type TeamId,
  type TransactionId,
} from '@eggbot/core';

import { YahooResponseValidationError } from './errors.js';

type YahooEntityKind = 'league' | 'team' | 'player' | 'transaction';

export const yahooLeagueId = (key: string): LeagueId =>
  leagueId(encode('league', key));
export const yahooTeamId = (key: string): TeamId => teamId(encode('team', key));
export const yahooPlayerId = (key: string): PlayerId =>
  playerId(encode('player', key));
export const yahooTransactionId = (key: string): TransactionId =>
  transactionId(encode('transaction', key));

export function yahooRosterSlotId(
  leagueKey: string,
  position: string,
  ordinal: number,
): RosterSlotId {
  return rosterSlotId(`yahoo:slot:${leagueKey}:${position}:${ordinal}`);
}

export const yahooLeagueKey = (id: LeagueId): string => decode('league', id);
export const yahooTeamKey = (id: TeamId): string => decode('team', id);

export function yahooLeagueKeyFromTeamKey(teamKey: string): string {
  const marker = teamKey.lastIndexOf('.t.');
  if (marker <= 0) {
    throw new YahooResponseValidationError(
      'Yahoo team key did not contain a league key',
      {
        resource: 'team_key',
        details: teamKey,
      },
    );
  }
  return teamKey.slice(0, marker);
}

function encode(kind: YahooEntityKind, key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new YahooResponseValidationError(
      'Yahoo resource key cannot be empty',
      {
        resource: `${kind}_key`,
      },
    );
  }
  return `yahoo:${kind}:${trimmed}`;
}

function decode(kind: YahooEntityKind, id: string): string {
  const prefix = `yahoo:${kind}:`;
  if (!id.startsWith(prefix) || id.length === prefix.length) {
    throw new YahooResponseValidationError(
      `Expected a Yahoo ${kind} identifier`,
      {
        resource: `${kind}_id`,
        details: id,
      },
    );
  }
  return id.slice(prefix.length);
}
