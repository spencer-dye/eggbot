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
    const timestamps = [
      new Date('2026-09-02T12:00:01.000Z'),
      new Date('2026-09-02T12:00:02.000Z'),
    ];
    const service = new FootballIntelligenceService({
      provider,
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
    expect(provider.getInjuries).toHaveBeenCalledOnce();
    expect(provider.getInjuries).toHaveBeenCalledWith(request);
    expect(provider.getProjections).toHaveBeenCalledOnce();
    expect(provider.getProjections).toHaveBeenCalledWith(request);
    expect(provider.getDepthCharts).toHaveBeenCalledOnce();
    expect(provider.getDepthCharts).toHaveBeenCalledWith(request);
    expect(provider.getUsage).toHaveBeenCalledOnce();
    expect(provider.getUsage).toHaveBeenCalledWith(request);
    expect(provider.getNews).toHaveBeenCalledOnce();
    expect(provider.getNews).toHaveBeenCalledWith(request);
    expect(provider.getSchedule).toHaveBeenCalledOnce();
    expect(provider.getSchedule).toHaveBeenCalledWith(request);
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
      new FootballIntelligenceService({ provider }).capture(request),
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
      new FootballIntelligenceService({ provider }).capture(request),
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
      new FootballIntelligenceService({ provider }).capture(request),
    ).rejects.toBe(providerError);
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
});

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
