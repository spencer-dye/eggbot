import { describe, expect, it, vi } from 'vitest';

import type { DecisionContext } from '@eggbot/agent';

import {
  createLocalDecisionEngine,
  createNoActionDecisionEngine,
} from './index.js';

const context = { fixture: 'opaque-context' } as unknown as DecisionContext;

describe('@eggbot/agent-local', () => {
  it('provides a safe concrete no-action engine', async () => {
    const engine = createNoActionDecisionEngine({
      id: 'safe-default',
      version: '1.0.0',
      rationale: 'No decision strategy is configured.',
    });

    await expect(engine.decide(context)).resolves.toEqual({
      rationale: 'No decision strategy is configured.',
      proposedActions: [],
    });
    expect(engine.kind).toBe('deterministic');
  });

  it('adapts an injected local decision function', async () => {
    const decide = vi.fn(() => ({
      rationale: 'Reviewed by a human operator.',
      proposedActions: [],
    }));
    const engine = createLocalDecisionEngine({
      id: 'human-review',
      version: '1.0.0',
      kind: 'human',
      decide,
    });

    await expect(engine.decide(context)).resolves.toMatchObject({
      rationale: 'Reviewed by a human operator.',
    });
    expect(decide).toHaveBeenCalledWith(context);
    expect(engine.kind).toBe('human');
  });
});
