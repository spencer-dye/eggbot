import { describe, expect, it } from 'vitest';

import {
  actionId,
  type AddDropAction,
  type SetLineupAction,
} from '@eggbot/core';

import {
  yahooLeagueId,
  yahooPlayerId,
  yahooRosterSlotId,
  yahooTeamId,
} from './identifiers.js';
import { buildYahooWriteRequest } from './write-requests.js';

const leagueKey = '449.l.123';
const teamKey = '449.l.123.t.4';

describe('buildYahooWriteRequest', () => {
  it('maps weekly lineup assignments to Yahoo roster XML', () => {
    const action: SetLineupAction = {
      id: actionId('lineup-1'),
      type: 'set-lineup',
      leagueId: yahooLeagueId(leagueKey),
      teamId: yahooTeamId(teamKey),
      scoringPeriod: '7',
      assignments: [
        {
          playerId: yahooPlayerId('449.p.42'),
          slotId: yahooRosterSlotId(leagueKey, 'W/R/T', 1),
        },
      ],
    };

    const request = buildYahooWriteRequest(action);
    expect(request.method).toBe('PUT');
    expect(request.path).toBe(`/team/${teamKey}/roster`);
    expect(request.body).toContain(
      '<player_key>449.p.42</player_key><position>W/R/T</position>',
    );
  });

  it('maps add/drop actions to Yahoo transaction XML', () => {
    const action: AddDropAction = {
      id: actionId('add-drop-1'),
      type: 'add-drop',
      leagueId: yahooLeagueId(leagueKey),
      teamId: yahooTeamId(teamKey),
      addPlayerId: yahooPlayerId('449.p.10'),
      dropPlayerId: yahooPlayerId('449.p.20'),
    };

    const request = buildYahooWriteRequest(action);
    expect(request.method).toBe('POST');
    expect(request.path).toBe(`/league/${leagueKey}/transactions`);
    expect(request.body).toContain('<type>add/drop</type>');
    expect(request.body).toContain(
      `<destination_team_key>${teamKey}</destination_team_key>`,
    );
    expect(request.body).toContain(
      `<source_team_key>${teamKey}</source_team_key>`,
    );
  });

  it('maps waiver bids and escapes XML values', () => {
    const action = {
      id: actionId('waiver-1'),
      type: 'waiver-claim' as const,
      leagueId: yahooLeagueId(leagueKey),
      teamId: yahooTeamId(teamKey),
      addPlayerId: yahooPlayerId('449.p.&10'),
      bid: 12,
    };

    const request = buildYahooWriteRequest(action);
    expect(request.body).toContain('<faab_bid>12</faab_bid>');
    expect(request.body).toContain('<player_key>449.p.&amp;10</player_key>');
    expect(request.body).not.toContain('<players>');
  });
});
