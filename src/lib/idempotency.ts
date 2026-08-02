import mongoose from "mongoose";

/**
 * Idempotency for exam start / submit / grade and result callbacks.
 *
 * Callers attach an `Idempotency-Key` header. A replay with the same key and the
 * same request fingerprint returns the stored response instead of re-running the
 * operation; a replay with a different fingerprint is rejected.
 */

export class IdempotencyError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "IdempotencyError";
  }
}

export interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  response: unknown;
  createdAt: Date;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  put(record: IdempotencyRecord): Promise<void>;
}

export class MongoIdempotencyStore implements IdempotencyStore {
  private collection() {
    const db = mongoose.connection.db;
    if (!db) {
      throw new IdempotencyError("Database is not connected", 503);
    }
    return db.collection("idempotency_records");
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const doc = await this.collection().findOne({ key });
    if (!doc) return null;
    const record = doc as unknown as Record<string, unknown> & {
      key: string;
      fingerprint: string;
      response: unknown;
      createdAt: Date;
    };
    return {
      key: record.key,
      fingerprint: record.fingerprint,
      response: record.response,
      createdAt: record.createdAt,
    };
  }

  async put(record: IdempotencyRecord): Promise<void> {
    await this.collection().updateOne(
      { key: record.key },
      { $set: { ...record } },
      { upsert: true },
    );
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    return this.records.get(key) ?? null;
  }

  async put(record: IdempotencyRecord): Promise<void> {
    this.records.set(record.key, record);
  }

  reset(): void {
    this.records.clear();
  }
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function idempotencyKeyFromRequest(request: Request): string | null {
  const raw = request.headers.get("Idempotency-Key");
  if (!raw) return null;
  const key = raw.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new IdempotencyError(
      "Idempotency-Key must be 8-128 characters of [A-Za-z0-9._-]",
      400,
    );
  }
  return key;
}

/**
 * Runs `run` once and records the result under `key`. A later call with the
 * same key returns the stored result; a call with the same key but a different
 * fingerprint is rejected as a conflict.
 */
export async function withIdempotency<T>(
  store: IdempotencyStore,
  key: string,
  fingerprint: string,
  run: () => Promise<T>,
): Promise<{ result: T; idempotent: boolean }> {
  const existing = await store.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new IdempotencyError(
        "Idempotency-Key was already used with a different request",
        422,
      );
    }
    return { result: existing.response as T, idempotent: true };
  }

  const result = await run();
  await store.put({
    key,
    fingerprint,
    response: result,
    createdAt: new Date(),
  });
  return { result, idempotent: false };
}
