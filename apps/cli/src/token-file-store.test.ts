import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFileTokenStore, redactTokens } from './token-file-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('CLI Yahoo token storage', () => {
  it('persists tokens with owner-only permissions and reloads them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'eggbot-token-test-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'nested', 'tokens.json');
    const tokens = {
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      tokenType: 'bearer',
      expiresAt: 1234,
    };
    const store = createFileTokenStore({ path });

    await store.save(tokens);

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(tokens);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(createFileTokenStore({ path }).load()).resolves.toEqual(
      tokens,
    );
  });

  it('redacts both OAuth secrets', () => {
    expect(
      redactTokens({
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        tokenType: 'bearer',
        expiresAt: 1234,
      }),
    ).toEqual({
      accessToken: '***',
      refreshToken: '***',
      tokenType: 'bearer',
      expiresAt: 1234,
    });
  });
});
