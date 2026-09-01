import { describe, expect, it } from 'vitest';

import { leagueId, playerId } from './index.js';

describe('opaque domain identifiers', () => {
  it('accepts and trims a non-empty external value', () => {
    expect(leagueId(' league-1 ')).toBe('league-1');
  });

  it('rejects an empty value at the boundary', () => {
    expect(() => playerId('  ')).toThrow('Identifier cannot be empty');
  });
});
