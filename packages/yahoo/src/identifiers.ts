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
export const yahooPlayerKey = (id: PlayerId): string => decode('player', id);

export interface YahooRosterSlotReference {
  readonly leagueKey: string;
  readonly position: string;
  readonly ordinal: number;
}

export function yahooRosterSlotReference(
  id: RosterSlotId,
): YahooRosterSlotReference {
  const prefix = 'yahoo:slot:';
  if (!id.startsWith(prefix)) {
    throw new YahooResponseValidationError(
      'Expected a Yahoo roster slot identifier',
      {
        resource: 'roster_slot_id',
        details: id,
      },
    );
  }
  const value = id.slice(prefix.length);
  const lastSeparator = value.lastIndexOf(':');
  const positionSeparator = value.lastIndexOf(':', lastSeparator - 1);
  const leagueKey = value.slice(0, positionSeparator);
  const position = value.slice(positionSeparator + 1, lastSeparator);
  const ordinal = Number(value.slice(lastSeparator + 1));
  if (
    positionSeparator <= 0 ||
    position.length === 0 ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1
  ) {
    throw new YahooResponseValidationError(
      'Yahoo roster slot identifier was malformed',
      {
        resource: 'roster_slot_id',
        details: id,
      },
    );
  }
  return { leagueKey, position, ordinal };
}

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
