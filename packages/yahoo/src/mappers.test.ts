import { describe, expect, it } from 'vitest';

import {
  mapGames,
  mapLeague,
  mapLeagueSummaries,
  mapLineup,
  mapMatchups,
  mapPlayers,
  mapRoster,
  mapStandings,
  mapTeams,
  mapTransactions,
} from './mappers.js';

const leagueKey = '449.l.1234';
const teamOneKey = `${leagueKey}.t.1`;
const teamTwoKey = `${leagueKey}.t.2`;

describe('Yahoo response mappers', () => {
  it('maps user games and league discovery collections', () => {
    const content = {
      users: {
        0: {
          user: [
            {
              games: {
                0: {
                  game: [
                    { game_key: '449' },
                    { code: 'nfl' },
                    { name: 'Football' },
                    { season: '2026' },
                    {
                      leagues: {
                        0: {
                          league: [
                            { league_key: leagueKey },
                            { name: 'Friends League' },
                            { season: '2026' },
                          ],
                        },
                        count: 1,
                      },
                    },
                  ],
                },
                count: 1,
              },
            },
          ],
        },
      },
    };

    expect(mapGames(content)).toEqual([
      { platformReference: '449', code: 'nfl', name: 'Football', season: 2026 },
    ]);
    expect(mapLeagueSummaries(content)).toEqual([
      { id: `yahoo:league:${leagueKey}`, name: 'Friends League', season: 2026 },
    ]);
  });

  it('maps league metadata, roster slots, and scoring modifiers', () => {
    const content = {
      league: [
        { league_key: leagueKey },
        { name: 'Friends League' },
        { season: '2026' },
        { num_teams: '10' },
        {
          settings: [
            { waiver_type: 'FAB' },
            { uses_faab: '1' },
            { waiver_time: '2' },
            { waiver_budget: '100' },
            { max_weekly_adds: '4' },
            { max_season_adds: '40' },
            {
              roster_positions: {
                0: { roster_position: [{ position: 'QB' }, { count: '1' }] },
                1: { roster_position: [{ position: 'W/R/T' }, { count: '2' }] },
                2: { roster_position: [{ position: 'BN' }, { count: '1' }] },
                3: { roster_position: [{ position: 'W/T' }, { count: '1' }] },
              },
            },
            {
              stat_categories: {
                stats: {
                  0: {
                    stat: [{ stat_id: '4' }, { name: 'Passing Touchdowns' }],
                  },
                },
              },
            },
            {
              stat_modifiers: {
                stats: { 0: { stat: [{ stat_id: '4' }, { value: '4' }] } },
              },
            },
          ],
        },
      ],
    };

    const league = mapLeague(content);
    expect(league.id).toBe(`yahoo:league:${leagueKey}`);
    expect(league.settings.teamCount).toBe(10);
    expect(league.settings.rosterSlots).toHaveLength(5);
    expect(league.settings.rosterSlots[1]).toMatchObject({
      name: 'W/R/T',
      kind: 'active',
      eligiblePositions: ['WR', 'RB', 'TE'],
    });
    expect(league.settings.rosterSlots[3]?.kind).toBe('bench');
    expect(league.settings.rosterSlots[4]?.eligiblePositions).toEqual([
      'WR',
      'TE',
    ]);
    expect(league.settings.scoringRules).toEqual([
      { key: 'yahoo.stat.4', points: 4, description: 'Passing Touchdowns' },
    ]);
    expect(league.settings.acquisitionRules).toEqual({
      waiverSystem: 'budget',
      waiverPeriodDays: 2,
      waiverBudget: 100,
      maxWeeklyAcquisitions: 4,
      maxSeasonAcquisitions: 40,
    });
  });

  it('maps teams, rosters, lineups, and available players', () => {
    const player = [
      { player_key: '449.p.30123' },
      { name: { full: 'Example Quarterback' } },
      { editorial_team_abbr: 'DEN' },
      { eligible_positions: [{ position: 'QB' }] },
      { selected_position: [{ week: '1' }, { position: 'QB' }] },
    ];
    const content = {
      team: [
        { team_key: teamOneKey },
        { name: 'Egg Heads' },
        { roster: [{ players: { 0: { player }, count: 1 } }] },
      ],
    };

    expect(mapTeams(content)).toEqual([
      {
        id: `yahoo:team:${teamOneKey}`,
        leagueId: `yahoo:league:${leagueKey}`,
        name: 'Egg Heads',
      },
    ]);
    expect(mapRoster(content, teamOneKey).entries[0]?.player).toEqual({
      id: 'yahoo:player:449.p.30123',
      fullName: 'Example Quarterback',
      eligiblePositions: ['QB'],
      professionalTeam: 'DEN',
    });
    expect(mapLineup(content, teamOneKey, '1').assignments).toEqual([
      {
        slotId: `yahoo:slot:${leagueKey}:QB:1`,
        playerId: 'yahoo:player:449.p.30123',
      },
    ]);
    expect(mapPlayers(content)).toHaveLength(1);
  });

  it('maps current team waiver priority, budget, and move count', () => {
    expect(
      mapTeams({
        team: [
          { team_key: teamOneKey },
          { name: 'Egg Heads' },
          { waiver_priority: '3' },
          { faab_balance: '72' },
          { number_of_moves: '5' },
        ],
      }),
    ).toEqual([
      {
        id: `yahoo:team:${teamOneKey}`,
        leagueId: `yahoo:league:${leagueKey}`,
        name: 'Egg Heads',
        acquisitionState: {
          waiverPriority: 3,
          waiverBudgetRemaining: 72,
          seasonAcquisitions: 5,
        },
      },
    ]);
  });

  it('maps standings and matchup scores without assuming two participants globally', () => {
    const standingTeam = (key: string, rank: number) => [
      { team_key: key },
      { name: `Team ${rank}` },
      {
        team_standings: [
          { rank: String(rank) },
          { outcome_totals: [{ wins: '2' }, { losses: '1' }, { ties: '0' }] },
          { percentage: '.667' },
          { points_for: '321.5' },
        ],
      },
      { team_points: [{ total: String(100 + rank) }] },
    ];
    const content = {
      league: [
        {
          standings: [
            {
              teams: {
                0: { team: standingTeam(teamOneKey, 1) },
                1: { team: standingTeam(teamTwoKey, 2) },
                count: 2,
              },
            },
          ],
        },
        {
          scoreboard: [
            {
              matchups: {
                0: {
                  matchup: [
                    { week: '3' },
                    {
                      teams: {
                        0: { team: standingTeam(teamOneKey, 1) },
                        1: { team: standingTeam(teamTwoKey, 2) },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    };

    expect(mapStandings(content)[0]).toEqual({
      teamId: `yahoo:team:${teamOneKey}`,
      rank: 1,
      wins: 2,
      losses: 1,
      ties: 0,
      percentage: 0.667,
      pointsFor: 321.5,
    });
    expect(mapMatchups(content, '3')).toEqual([
      {
        scoringPeriod: '3',
        participants: [
          { teamId: `yahoo:team:${teamOneKey}`, score: 101 },
          { teamId: `yahoo:team:${teamTwoKey}`, score: 102 },
        ],
      },
    ]);
  });

  it('maps transaction history separately from executable actions', () => {
    const content = {
      transactions: {
        0: {
          transaction: [
            { transaction_key: `${leagueKey}.tr.9` },
            { type: 'add/drop' },
            { status: 'successful' },
            { timestamp: '1788220800' },
            {
              players: {
                0: {
                  player: [
                    { player_key: '449.p.1' },
                    { name: { full: 'Added Player' } },
                    {
                      transaction_data: [
                        { type: 'add' },
                        { destination_team_key: teamOneKey },
                      ],
                    },
                  ],
                },
                1: {
                  player: [
                    { player_key: '449.p.2' },
                    { name: { full: 'Dropped Player' } },
                    {
                      transaction_data: [
                        { type: 'drop' },
                        { source_team_key: teamOneKey },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };

    expect(mapTransactions(content, leagueKey)).toEqual([
      {
        id: `yahoo:transaction:${leagueKey}.tr.9`,
        leagueId: `yahoo:league:${leagueKey}`,
        type: 'add-drop',
        status: 'successful',
        occurredAt: '2026-09-01T00:00:00.000Z',
        moves: [
          {
            type: 'add',
            playerId: 'yahoo:player:449.p.1',
            destinationTeamId: `yahoo:team:${teamOneKey}`,
          },
          {
            type: 'drop',
            playerId: 'yahoo:player:449.p.2',
            sourceTeamId: `yahoo:team:${teamOneKey}`,
          },
        ],
      },
    ]);
  });
});
