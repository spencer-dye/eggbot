import { describe, expect, it } from 'vitest';

import { extractYahooTransactionReference } from './write-response.js';

describe('extractYahooTransactionReference', () => {
  it('extracts a completed transaction key from JSON', () => {
    expect(
      extractYahooTransactionReference({
        fantasy_content: {
          transaction: [{ transaction_key: '461.l.1000.tr.26' }],
        },
      }),
    ).toBe('yahoo:transaction:461.l.1000.tr.26');
  });

  it('extracts a pending waiver key from XML', () => {
    expect(
      extractYahooTransactionReference(
        '<transaction><transaction_key>461.l.1000.w.c.2_6461</transaction_key></transaction>',
      ),
    ).toBe('yahoo:transaction:461.l.1000.w.c.2_6461');
  });

  it('falls back to the Location header', () => {
    expect(
      extractYahooTransactionReference(
        undefined,
        'https://fantasysports.yahooapis.com/fantasy/v2/transaction/461.l.1000.tr.9',
      ),
    ).toBe('yahoo:transaction:461.l.1000.tr.9');
  });
});
