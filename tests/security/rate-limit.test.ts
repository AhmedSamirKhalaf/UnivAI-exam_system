import { describe, expect, test, vi } from "vitest";
import { RateLimitError, RateLimiter } from "../../src/lib/rate-limit";

const limits = {
  user: { windowMs: 1000, max: 2 },
  session: { windowMs: 1000, max: 3 },
};

describe("rate limiter", () => {
  test("allows requests within the configured limit", () => {
    const now = 0;
    const limiter = new RateLimiter(limits, () => now);

    const first = limiter.enforce({ kind: "user", id: "student-1" });
    const second = limiter.enforce({ kind: "user", id: "student-1" });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.remaining).toBe(0);
  });

  test("throws RateLimitError once the limit is exceeded", () => {
    const now = 0;
    const limiter = new RateLimiter(limits, () => now);

    limiter.enforce({ kind: "user", id: "student-1" });
    limiter.enforce({ kind: "user", id: "student-1" });

    expect(() => limiter.enforce({ kind: "user", id: "student-1" })).toThrow(
      RateLimitError,
    );
  });

  test("RateLimitError reports a retry-after window", () => {
    const now = 0;
    const limiter = new RateLimiter(limits, () => now);

    limiter.enforce({ kind: "user", id: "student-1" });
    limiter.enforce({ kind: "user", id: "student-1" });
    try {
      limiter.enforce({ kind: "user", id: "student-1" });
      throw new Error("expected RateLimitError");
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      const rateError = error as RateLimitError;
      expect(rateError.retryAfterMs).toBeGreaterThan(0);
      expect(rateError.retryAfterMs).toBeLessThanOrEqual(1000);
    }
  });

  test("counts reset after the window elapses", () => {
    let now = 0;
    const limiter = new RateLimiter(limits, () => now);

    limiter.enforce({ kind: "user", id: "student-1" });
    limiter.enforce({ kind: "user", id: "student-1" });
    expect(() => limiter.enforce({ kind: "user", id: "student-1" })).toThrow(
      RateLimitError,
    );

    now = 1001;
    expect(limiter.enforce({ kind: "user", id: "student-1" }).allowed).toBe(true);
  });

  test("tracks users and sessions independently", () => {
    const now = 0;
    const limiter = new RateLimiter(limits, () => now);

    limiter.enforce({ kind: "user", id: "student-1" });
    limiter.enforce({ kind: "user", id: "student-1" });
    // A session bucket is untouched by user traffic.
    expect(limiter.enforce({ kind: "session", id: "exam-1" }).allowed).toBe(true);
    expect(() => limiter.enforce({ kind: "user", id: "student-1" })).toThrow(
      RateLimitError,
    );
  });

  test("reset clears all buckets", () => {
    const now = 0;
    const limiter = new RateLimiter(limits, () => now);

    limiter.enforce({ kind: "user", id: "student-1" });
    limiter.enforce({ kind: "user", id: "student-1" });
    expect(() => limiter.enforce({ kind: "user", id: "student-1" })).toThrow(
      RateLimitError,
    );

    limiter.reset();
    expect(limiter.enforce({ kind: "user", id: "student-1" }).allowed).toBe(true);
  });

  test("check does not throw and reports remaining", () => {
    const now = vi.fn(() => 0);
    const limiter = new RateLimiter(limits, now);

    const first = limiter.check({ kind: "session", id: "exam-1" });
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
  });
});
