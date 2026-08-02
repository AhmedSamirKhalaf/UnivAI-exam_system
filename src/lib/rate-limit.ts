/**
 * Per-session and per-user rate limiting for the exam API.
 *
 * This is an in-memory sliding window limiter. It is deliberately single-process
 * and process-local: the Exam service is deployed as one instance per tenant, so
 * the window is shared by every request that instance sees. Configuration is
 * read once from environment variables so operators can tune limits without code
 * changes (see docs/deployment.md).
 */

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export type RateLimitScopeKind = "user" | "session";

export interface RateLimitScope {
  kind: RateLimitScopeKind;
  id: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export class RateLimitError extends Error {
  constructor(
    readonly retryAfterMs: number,
    message = "Too many requests",
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadRateLimitConfig(): {
  user: RateLimitConfig;
  session: RateLimitConfig;
} {
  return {
    user: {
      windowMs: readNumberEnv("UNIVAI_RATE_LIMIT_USER_WINDOW_MS", 60_000),
      max: readNumberEnv("UNIVAI_RATE_LIMIT_USER_MAX", 30),
    },
    session: {
      windowMs: readNumberEnv("UNIVAI_RATE_LIMIT_SESSION_WINDOW_MS", 60_000),
      max: readNumberEnv("UNIVAI_RATE_LIMIT_SESSION_MAX", 120),
    },
  };
}

interface Bucket {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limits: {
      user: RateLimitConfig;
      session: RateLimitConfig;
    } = loadRateLimitConfig(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  scopeKey(scope: RateLimitScope): string {
    return `${scope.kind}:${scope.id}`;
  }

  check(scope: RateLimitScope): RateLimitResult {
    const key = this.scopeKey(scope);
    const limit = this.limits[scope.kind];
    const current = this.now();

    let bucket = this.buckets.get(key);
    if (!bucket || current - bucket.windowStart >= limit.windowMs) {
      bucket = { count: 0, windowStart: current };
    }
    bucket.count += 1;
    this.buckets.set(key, bucket);

    const resetAt = bucket.windowStart + limit.windowMs;
    return {
      allowed: bucket.count <= limit.max,
      remaining: Math.max(0, limit.max - bucket.count),
      resetAt,
    };
  }

  /** Checks the scope and throws `RateLimitError` (429) when over the limit. */
  enforce(scope: RateLimitScope): RateLimitResult {
    const result = this.check(scope);
    if (!result.allowed) {
      throw new RateLimitError(
        Math.max(0, result.resetAt - this.now()),
        `Rate limit exceeded for ${scope.kind} scope`,
      );
    }
    return result;
  }

  reset(): void {
    this.buckets.clear();
  }
}

/** Shared limiter used by the exam API routes. */
export const examRateLimiter = new RateLimiter();
