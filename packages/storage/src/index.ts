export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface StorageRecord<Value extends JsonValue = JsonValue> {
  readonly key: string;
  readonly value: Value;
  readonly updatedAt: string;
}

/** Minimal persistence port; no database or in-memory implementation is selected. */
export interface StorageAdapter {
  get<Value extends JsonValue = JsonValue>(
    key: string,
  ): Promise<StorageRecord<Value> | undefined>;
  put<Value extends JsonValue>(record: StorageRecord<Value>): Promise<void>;
  delete(key: string): Promise<boolean>;
}
