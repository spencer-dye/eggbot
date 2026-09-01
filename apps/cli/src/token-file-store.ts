import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { YahooTokenSet, YahooTokenStore } from '@eggbot/yahoo';

export interface FileTokenStoreOptions {
  readonly path: string;
  readonly initialTokens?: YahooTokenSet;
  readonly onSaved?: (path: string, tokens: YahooTokenSet) => void;
}

export function createFileTokenStore(
  options: FileTokenStoreOptions,
): YahooTokenStore {
  const path = resolve(options.path);
  let tokens = options.initialTokens;

  return {
    async load() {
      if (tokens !== undefined) return tokens;
      try {
        tokens = JSON.parse(await readFile(path, 'utf8')) as YahooTokenSet;
        return tokens;
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    },
    async save(updated) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await chmod(path, 0o600);
      tokens = updated;
      options.onSaved?.(path, updated);
    },
  };
}

export function redactTokens(
  tokens: YahooTokenSet,
): Record<string, string | number> {
  return {
    accessToken: '***',
    ...(tokens.refreshToken === undefined ? {} : { refreshToken: '***' }),
    tokenType: tokens.tokenType,
    expiresAt: tokens.expiresAt,
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
