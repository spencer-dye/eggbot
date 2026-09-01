import type { FantasyAction } from '@eggbot/core';

import { YahooActionValidationError } from './errors.js';
import {
  yahooLeagueKey,
  yahooLeagueKeyFromTeamKey,
  yahooPlayerKey,
  yahooRosterSlotReference,
  yahooTeamKey,
} from './identifiers.js';

export interface YahooWriteRequest {
  readonly action: FantasyAction;
  readonly method: 'POST' | 'PUT';
  readonly path: string;
  readonly body: string;
  readonly summary: string;
}

export function buildYahooWriteRequest(
  action: FantasyAction,
): YahooWriteRequest {
  const leagueKey = yahooLeagueKey(action.leagueId);
  const teamKey = yahooTeamKey(action.teamId);
  if (yahooLeagueKeyFromTeamKey(teamKey) !== leagueKey) {
    invalid(
      action,
      'ACTION_RESOURCE_MISMATCH',
      'Team does not belong to league',
    );
  }

  if (action.type === 'set-lineup') {
    const players = action.assignments
      .map((assignment) => {
        const slot = yahooRosterSlotReference(assignment.slotId);
        if (slot.leagueKey !== leagueKey) {
          invalid(
            action,
            'ACTION_RESOURCE_MISMATCH',
            'Roster slot does not belong to league',
          );
        }
        return `<player><player_key>${escapeXml(yahooPlayerKey(assignment.playerId))}</player_key><position>${escapeXml(slot.position)}</position></player>`;
      })
      .join('');
    return {
      action,
      method: 'PUT',
      path: `/team/${encodePathKey(teamKey)}/roster`,
      body: xml(
        `<fantasy_content><roster><coverage_type>week</coverage_type><week>${escapeXml(action.scoringPeriod)}</week><players>${players}</players></roster></fantasy_content>`,
      ),
      summary: `Set ${action.assignments.length} lineup assignment(s) for week ${action.scoringPeriod}`,
    };
  }

  const addPlayerKey = yahooPlayerKey(action.addPlayerId);
  const dropPlayerId = action.dropPlayerId;
  const dropPlayerKey =
    dropPlayerId === undefined ? undefined : yahooPlayerKey(dropPlayerId);
  const transactionType = dropPlayerKey === undefined ? 'add' : 'add/drop';
  const add = `<player><player_key>${escapeXml(addPlayerKey)}</player_key><transaction_data><type>add</type><destination_team_key>${escapeXml(teamKey)}</destination_team_key></transaction_data></player>`;
  const drop =
    dropPlayerKey === undefined
      ? ''
      : `<player><player_key>${escapeXml(dropPlayerKey)}</player_key><transaction_data><type>drop</type><source_team_key>${escapeXml(teamKey)}</source_team_key></transaction_data></player>`;
  const playerPayload =
    dropPlayerKey === undefined
      ? `<player>${add.slice('<player>'.length, -'</player>'.length)}</player>`
      : `<players>${add}${drop}</players>`;
  const bid =
    action.type === 'waiver-claim' && action.bid !== undefined
      ? `<faab_bid>${action.bid}</faab_bid>`
      : '';
  return {
    action,
    method: 'POST',
    path: `/league/${encodePathKey(leagueKey)}/transactions`,
    body: xml(
      `<fantasy_content><transaction><type>${transactionType}</type>${bid}${playerPayload}</transaction></fantasy_content>`,
    ),
    summary:
      action.type === 'waiver-claim'
        ? `Submit waiver claim for ${addPlayerKey}${dropPlayerKey === undefined ? '' : ` and drop ${dropPlayerKey}`}`
        : `Add ${addPlayerKey} and drop ${dropPlayerKey}`,
  };
}

function invalid(action: FantasyAction, code: string, message: string): never {
  throw new YahooActionValidationError(message, { code, actionId: action.id });
}

function xml(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${content.replace(
    '<fantasy_content>',
    '<fantasy_content xmlns="http://fantasysports.yahooapis.com/fantasy/v2/base.rng">',
  )}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function encodePathKey(value: string): string {
  return value
    .split('.')
    .map((part) => encodeURIComponent(part))
    .join('.');
}
