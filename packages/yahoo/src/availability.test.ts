import { describe, expect, it } from 'vitest';

import { parseYahooPlayerAvailability } from './availability.js';

describe('parseYahooPlayerAvailability', () => {
  it.each([
    ['freeagents', 'free-agent'],
    ['waivers', 'waivers'],
    ['team', 'rostered'],
  ] as const)('maps Yahoo ownership %s to %s', (ownership, expected) => {
    expect(
      parseYahooPlayerAvailability({
        ownership: { ownership_type: ownership },
      }),
    ).toBe(expected);
  });

  it('rejects unknown ownership values at the adapter boundary', () => {
    expect(() =>
      parseYahooPlayerAvailability({ ownership_type: 'mystery' }),
    ).toThrowError(/Unsupported Yahoo player ownership type/);
  });
});
