import type { JsonValue, StorageRecord } from './index.js';

export function validateRecord<Value extends JsonValue>(
  record: StorageRecord<Value>,
): void {
  if (record.key.trim().length === 0)
    throw new TypeError('Storage key is empty');
  if (Number.isNaN(Date.parse(record.updatedAt))) {
    throw new TypeError('Storage record has an invalid updatedAt timestamp');
  }
  validateJson(record.value, 'value');
}

export function validateJson(
  value: unknown,
  path: string,
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJson(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(`${path} must be a plain JSON object`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined)
        throw new TypeError(`${path}.${key} is undefined`);
      validateJson(item, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`${path} is not JSON-serializable`);
}

export function cloneRecord<Value extends JsonValue>(
  record: StorageRecord<Value>,
): StorageRecord<Value> {
  return structuredClone(record);
}
