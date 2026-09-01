import { z, type ZodType } from 'zod';

import { YahooResponseValidationError } from './errors.js';

const fantasyResponseSchema = z.object({
  fantasy_content: z.unknown(),
});

export type UnknownRecord = Record<string, unknown>;

export function parseFantasyContent(input: unknown): unknown {
  const parsed = fantasyResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new YahooResponseValidationError(
      'Missing Yahoo fantasy_content envelope',
      {
        resource: 'fantasy_content',
        details: parsed.error.issues,
      },
    );
  }
  return parsed.data.fantasy_content;
}

export function parseResource<Output>(
  schema: ZodType<Output>,
  input: unknown,
  resource: string,
): Output {
  const parsed = schema.safeParse(toRecord(input));
  if (!parsed.success) {
    throw new YahooResponseValidationError(
      `Invalid Yahoo ${resource} resource`,
      {
        resource,
        details: parsed.error.issues,
      },
    );
  }
  return parsed.data;
}

/** Yahoo encodes resources as arrays of one-property objects. */
export function toRecord(input: unknown): UnknownRecord {
  if (isRecord(input)) return input;
  if (!Array.isArray(input)) return {};

  return input.reduce<UnknownRecord>((record, fragment) => {
    if (isRecord(fragment)) Object.assign(record, fragment);
    return record;
  }, {});
}

/** Finds resource wrappers within Yahoo's numeric-key collection objects. */
export function findResources(
  input: unknown,
  resourceName: string,
): readonly unknown[] {
  const found: unknown[] = [];
  visit(input, (record) => {
    if (resourceName in record) found.push(record[resourceName]);
  });
  return found;
}

export function findFirstValue(input: unknown, key: string): unknown {
  let result: unknown;
  visit(input, (record) => {
    if (result === undefined && key in record) result = record[key];
  });
  return result;
}

export function findStringValues(
  input: unknown,
  key: string,
): readonly string[] {
  const values: string[] = [];
  visit(input, (record) => {
    const value = record[key];
    if (typeof value === 'string') values.push(value);
  });
  return values;
}

function visit(input: unknown, visitor: (record: UnknownRecord) => void): void {
  if (Array.isArray(input)) {
    for (const value of input) visit(value, visitor);
    return;
  }
  if (!isRecord(input)) return;

  visitor(input);
  for (const value of Object.values(input)) visit(value, visitor);
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
