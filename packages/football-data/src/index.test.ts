import { describe, expect, it, vi } from 'vitest';

import { playerId } from '@eggbot/core';

import {
  FootballDataValidationError,
  FootballIntelligenceService,
  parsePlayerNewsSet,
  parseProjectionSet,
  parseUsageSet,
  type FootballDataProvider,
  type FootballDataRequest,
  type PlayerIdentityResolver,
} from './index.js';

const first = playerId('player-1');
const second = playerId('player-2');
const observedAt = '2026-09-02T12:00:00.000Z';
const provenance = { observedAt, source: 'test-feed', version: '2026.09' };
const request: FootballDataRequest = {
  scoringPeriod: 'week-1',
  playerIds: [first, second],
  professionalTeams: ['SEA', 'SF'],
};

describe('FootballIntelligenceService', () => {
  it('captures and validates every intelligence source concurrently', async () => {
    const provider = testProvider();
    const identityResolver = testIdentityResolver();
    const timestamps = [
      new Date('2026-09-02T12:00:01.000Z'),
      new Date('2026-09-02T12:00:02.000Z'),
    ];
    const service = new FootballIntelligenceService({
      provider,
      identityResolver,
      clock: () => timestamps.shift()!,
    });

    const snapshot = await service.capture(request);

    expect(snapshot).toMatchObject({
      captureStartedAt: '2026-09-02T12:00:01.000Z',
      capturedAt: '2026-09-02T12:00:02.000Z',
      consistency: 'best-effort',
      scoringPeriod: 'week-1',
      provider: { id: 'test-football-data', version: '1.0.0' },
      injuries: { reports: [{ playerId: first, status: 'questionable' }] },
      projections: { players: [{ playerId: first, points: 17.5 }] },
      depthCharts: { entries: [{ playerId: first, rank: 1 }] },
      usage: { players: [{ playerId: first, snapShare: 0.8 }] },
      news: { items: [{ id: 'news-1', playerIds: [first] }] },
      schedule: { games: [{ id: 'game-1', homeTeam: 'SEA', awayTeam: 'SF' }] },
    });
    const providerRequest = {
      scoringPeriod: 'week-1',
      players: [
        {
          playerId: first,
          reference: { provider: provider.id, value: 'external-player-1' },
        },
        {
          playerId: second,
          reference: { provider: provider.id, value: 'external-player-2' },
        },
      ],
      professionalTeams: ['SEA', 'SF'],
    };
    expect(identityResolver.resolve).toHaveBeenCalledWith(
      request.playerIds,
      provider.id,
    );
    expect(provider.getInjuries).toHaveBeenCalledOnce();
    expect(provider.getInjuries).toHaveBeenCalledWith(providerRequest);
    expect(provider.getProjections).toHaveBeenCalledOnce();
    expect(provider.getProjections).toHaveBeenCalledWith(providerRequest);
    expect(provider.getDepthCharts).toHaveBeenCalledOnce();
    expect(provider.getDepthCharts).toHaveBeenCalledWith(providerRequest);
    expect(provider.getUsage).toHaveBeenCalledOnce();
    expect(provider.getUsage).toHaveBeenCalledWith(providerRequest);
    expect(provider.getNews).toHaveBeenCalledOnce();
    expect(provider.getNews).toHaveBeenCalledWith(providerRequest);
    expect(provider.getSchedule).toHaveBeenCalledOnce();
    expect(provider.getSchedule).toHaveBeenCalledWith(providerRequest);
  });

  it('fails closed when period-bound provider data targets another period', async () => {
    const provider = testProvider({
      getUsage: vi.fn(() =>
        Promise.resolve({
          ...provenance,
          scoringPeriod: 'week-2',
          players: [],
        }),
      ),
    });

    await expect(
      new FootballIntelligenceService({
        provider,
        identityResolver: testIdentityResolver(),
      }).capture(request),
    ).rejects.toMatchObject({
      code: 'FOOTBALL_DATA_PERIOD_MISMATCH',
      resource: 'usage:week-2:week-1',
    });
  });

  it('rejects provider records outside explicitly requested scope', async () => {
    const provider = testProvider({
      getInjuries: vi.fn(() =>
        Promise.resolve({
          ...provenance,
          reports: [
            { playerId: playerId('unexpected'), status: 'out' as const },
          ],
        }),
      ),
    });

    await expect(
      new FootballIntelligenceService({
        provider,
        identityResolver: testIdentityResolver(),
      }).capture(request),
    ).rejects.toMatchObject({
      code: 'PLAYER_OUTSIDE_REQUEST_SCOPE',
      resource: 'unexpected',
    });
  });

  it('preserves provider failures rather than misclassifying them as validation', async () => {
    const providerError = Object.assign(new Error('feed unavailable'), {
      code: 'UPSTREAM_TIMEOUT',
      retryable: true,
    });
    const provider = testProvider({
      getNews: vi.fn(() => Promise.reject(providerError)),
    });

    await expect(
      new FootballIntelligenceService({
        provider,
        identityResolver: testIdentityResolver(),
      }).capture(request),
    ).rejects.toBe(providerError);
  });

  it('fails closed when identity resolution is incomplete', async () => {
    const provider = testProvider();
    const identityResolver: PlayerIdentityResolver = {
      resolve: vi.fn(() =>
        Promise.resolve([
          {
            playerId: first,
            reference: { provider: provider.id, value: 'external-player-1' },
          },
        ]),
      ),
    };

    await expect(
      new FootballIntelligenceService({ provider, identityResolver }).capture(
        request,
      ),
    ).rejects.toMatchObject({
      code: 'IDENTITY_RESOLUTION_INCOMPLETE',
      resource: second,
    });
    expect(provider.getProjections).not.toHaveBeenCalled();
  });

  it('rejects future provenance relative to the capture time', async () => {
    const provider = testProvider({
      getProjections: vi.fn(() =>
        Promise.resolve({
          ...provenance,
          observedAt: '2026-09-02T12:00:03.000Z',
          scoringPeriod: 'week-1',
          players: [],
        }),
      ),
    });
    const timestamps = [
      new Date('2026-09-02T12:00:01.000Z'),
      new Date('2026-09-02T12:00:02.000Z'),
    ];

    await expect(
      new FootballIntelligenceService({
        provider,
        identityResolver: testIdentityResolver(),
        clock: () => timestamps.shift()!,
      }).capture(request),
    ).rejects.toMatchObject({
      code: 'FUTURE_FOOTBALL_DATA_TIMESTAMP',
      resource: 'projections.observedAt',
    });
  });

  it('rejects future timestamps on individual news records', async () => {
    const provider = testProvider({
      getNews: vi.fn(() =>
        Promise.resolve({
          ...provenance,
          items: [
            {
              id: 'news-1',
              playerIds: [first],
              headline: 'Future update',
              publishedAt: '2026-09-02T12:00:03.000Z',
            },
          ],
        }),
      ),
    });
    const timestamps = [
      new Date('2026-09-02T12:00:01.000Z'),
      new Date('2026-09-02T12:00:02.000Z'),
    ];

    await expect(
      new FootballIntelligenceService({
        provider,
        identityResolver: testIdentityResolver(),
        clock: () => timestamps.shift()!,
      }).capture(request),
    ).rejects.toMatchObject({
      code: 'FUTURE_FOOTBALL_DATA_TIMESTAMP',
      resource: 'news:news-1.publishedAt',
    });
  });
});

describe('football data boundary parsers', () => {
  it('normalizes projection IDs and rejects duplicates and impossible ranges', () => {
    expect(
      parseProjectionSet({
        ...provenance,
        scoringPeriod: 'week-1',
        players: [
          { playerId: 'player-1', points: 17.5, floor: 10, ceiling: 25 },
        ],
      }).players[0]?.playerId,
    ).toBe(first);

    expect(() =>
      parseProjectionSet({
        ...provenance,
        scoringPeriod: 'week-1',
        players: [
          { playerId: 'player-1', points: 10 },
          { playerId: 'player-1', points: 11 },
        ],
      }),
    ).toThrowError(FootballDataValidationError);
    expect(() =>
      parseProjectionSet({
        ...provenance,
        scoringPeriod: 'week-1',
        players: [{ playerId: 'player-1', points: Number.POSITIVE_INFINITY }],
      }),
    ).toThrowError(FootballDataValidationError);
    expect(() =>
      parseProjectionSet({
        ...provenance,
        scoringPeriod: 'week-1',
        players: [{ playerId: 'player-1', points: 10, floor: 12 }],
      }),
    ).toThrowError(FootballDataValidationError);
  });

  it('strictly rejects unknown fields, invalid URLs, and invalid usage shares', () => {
    expect(() =>
      parsePlayerNewsSet({
        ...provenance,
        items: [
          {
            id: 'news-1',
            playerIds: ['player-1'],
            headline: 'Practice update',
            publishedAt: observedAt,
            arbitrary: true,
          },
        ],
      }),
    ).toThrowError(FootballDataValidationError);
    expect(() =>
      parsePlayerNewsSet({
        ...provenance,
        items: [
          {
            id: 'news-1',
            playerIds: [],
            headline: 'Practice update',
            publishedAt: observedAt,
            url: 'not a URL',
          },
        ],
      }),
    ).toThrowError(FootballDataValidationError);
    expect(() =>
      parseUsageSet({
        ...provenance,
        scoringPeriod: 'week-1',
        players: [
          {
            playerId: 'player-1',
            scoringPeriod: 'week-1',
            window: 'scoring-period',
            snapShare: 1.1,
          },
        ],
      }),
    ).toThrowError(FootballDataValidationError);
  });

  it('normalizes duplicate player references within one news item', () => {
    expect(
      parsePlayerNewsSet({
        ...provenance,
        items: [
          {
            id: 'news-1',
            playerIds: ['player-1', 'player-1', 'player-2'],
            headline: 'Shared update',
            publishedAt: observedAt,
          },
        ],
      }).items[0]?.playerIds,
    ).toEqual([first, second]);
  });
});

function testIdentityResolver(): PlayerIdentityResolver & {
  readonly resolve: ReturnType<typeof vi.fn>;
} {
  return {
    resolve: vi.fn((playerIds: readonly string[], provider: string) =>
      Promise.resolve(
        playerIds.map((id, index) => ({
          playerId: playerId(id),
          reference: {
            provider,
            value: `external-player-${index + 1}`,
          },
        })),
      ),
    ),
  };
}

function testProvider(
  overrides: Partial<FootballDataProvider> = {},
): FootballDataProvider & Record<string, unknown> {
  return {
    id: 'test-football-data',
    version: '1.0.0',
    getInjuries: vi.fn(() =>
      Promise.resolve({
        ...provenance,
        reports: [
          {
            playerId: first,
            status: 'questionable' as const,
            detail: 'Limited in practice',
            reportedAt: observedAt,
          },
        ],
      }),
    ),
    getProjections: vi.fn(() =>
      Promise.resolve({
        ...provenance,
        scoringPeriod: 'week-1',
        players: [{ playerId: first, points: 17.5, floor: 10, ceiling: 25 }],
      }),
    ),
    getDepthCharts: vi.fn(() =>
      Promise.resolve({
        ...provenance,
        entries: [
          {
            playerId: first,
            professionalTeam: 'SEA',
            position: 'WR',
            rank: 1,
          },
        ],
      }),
    ),
    getUsage: vi.fn(() =>
      Promise.resolve({
        ...provenance,
        scoringPeriod: 'week-1',
        players: [
          {
            playerId: first,
            scoringPeriod: 'week-1',
            window: 'scoring-period' as const,
            games: 1,
            snaps: 48,
            snapShare: 0.8,
            routesRun: 31,
            routeParticipation: 0.82,
            targets: 9,
            targetShare: 0.25,
          },
        ],
      }),
    ),
    getNews: vi.fn(() =>
      Promise.resolve({
        ...provenance,
        items: [
          {
            id: 'news-1',
            playerIds: [first],
            headline: 'Player limited at practice',
            publishedAt: observedAt,
            url: 'https://example.test/news-1',
          },
        ],
      }),
    ),
    getSchedule: vi.fn(() =>
      Promise.resolve({
        ...provenance,
        scoringPeriod: 'week-1',
        games: [
          {
            id: 'game-1',
            scoringPeriod: 'week-1',
            startsAt: '2026-09-06T20:20:00.000Z',
            homeTeam: 'SEA',
            awayTeam: 'SF',
            status: 'scheduled' as const,
          },
        ],
      }),
    ),
    ...overrides,
  };
}
