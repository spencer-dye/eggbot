import type { PlatformAdapterMetadata } from '@eggbot/platform';

/** Discovery metadata only. Yahoo transport and authentication begin in Phase 1. */
export const yahooAdapterMetadata: PlatformAdapterMetadata = Object.freeze({
  id: 'yahoo',
  displayName: 'Yahoo Fantasy Sports',
  capabilities: Object.freeze({
    read: false,
    execute: false,
  }),
});
