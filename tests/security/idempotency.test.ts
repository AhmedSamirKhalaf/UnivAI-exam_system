import { describe, expect, test, vi } from "vitest";
import {
  IdempotencyError,
  InMemoryIdempotencyStore,
  idempotencyKeyFromRequest,
  withIdempotency,
} from "../../src/lib/idempotency";

function requestWithKey(key: string): Request {
  return new Request("http://localhost/api/exam", {
    method: "POST",
    headers: { "Idempotency-Key": key },
  });
}

describe("idempotency", () => {
  test("runs once and replays the stored result for the same key", async () => {
    const store = new InMemoryIdempotencyStore();
    const run = vi.fn(async () => ({ ok: true }));

    const first = await withIdempotency(store, "start-quiz-001", "fp-1", run);
    expect(first).toEqual({ result: { ok: true }, idempotent: false });
    expect(run).toHaveBeenCalledTimes(1);

    const replay = await withIdempotency(store, "start-quiz-001", "fp-1", run);
    expect(replay.idempotent).toBe(true);
    expect(replay.result).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("rejects the same key used with a different fingerprint", async () => {
    const store = new InMemoryIdempotencyStore();
    const run = vi.fn(async () => ({ ok: true }));

    await withIdempotency(store, "submit-001", "exam-1", run);

    await expect(
      withIdempotency(store, "submit-001", "exam-2", run),
    ).rejects.toThrow(/different request/);
    await expect(
      withIdempotency(store, "submit-001", "exam-2", run),
    ).rejects.toBeInstanceOf(IdempotencyError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("does not store the result when the operation fails", async () => {
    const store = new InMemoryIdempotencyStore();
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(
      withIdempotency(store, "start-001", "fp", failing),
    ).rejects.toThrow("boom");

    const retry = vi.fn(async () => ({ ok: true }));
    const result = await withIdempotency(store, "start-001", "fp", retry);
    expect(result.idempotent).toBe(false);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("coalesces concurrent replays before a result is stored", async () => {
    const store = new InMemoryIdempotencyStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => {
      await gate;
      return { ok: true };
    });

    const first = withIdempotency(store, "concurrent-001", "fp", run);
    await Promise.resolve();
    const replay = withIdempotency(store, "concurrent-001", "fp", run);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    release();
    const [firstResult, replayResult] = await Promise.all([first, replay]);
    expect(firstResult.idempotent).toBe(false);
    expect(replayResult.idempotent).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("extracts a valid Idempotency-Key header", () => {
    expect(idempotencyKeyFromRequest(requestWithKey("start-quiz-001"))).toBe(
      "start-quiz-001",
    );
  });

  test("namespaces a key to its operation and resource", () => {
    expect(
      idempotencyKeyFromRequest(
        requestWithKey("shared-key-001"),
        "submit:exam-1",
      ),
    ).toBe("submit:exam-1:shared-key-001");
  });

  test("returns null when no header is present", () => {
    const request = new Request("http://localhost/api/exam", { method: "POST" });
    expect(idempotencyKeyFromRequest(request)).toBeNull();
  });

  test("rejects malformed Idempotency-Key headers", () => {
    expect(() => idempotencyKeyFromRequest(requestWithKey("short"))).toThrow(
      IdempotencyError,
    );
    expect(() =>
      idempotencyKeyFromRequest(requestWithKey("has spaces here 123")),
    ).toThrow(IdempotencyError);
  });
});
