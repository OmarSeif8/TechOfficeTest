/**
 * Rate limiting middleware — BR-WEB-10: 60 req/min per user.
 *
 * In-memory token bucket per user. Returns 429 when exceeded.
 *
 * Phase 1 MVP: in-memory (single server instance). For multi-instance
 * production deployment, replace with Redis-backed rate limiter.
 *
 * Usage in route handlers:
 *   import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
 *
 *   export const POST = withErrorHandler(async (req) => {
 *     const userId = await requireUserId();
 *     if (!checkRateLimit(userId)) return rateLimitResponse();
 *     // ... handler logic
 *   });
 */

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

const MAX_TOKENS = 60;
const REFILL_INTERVAL_MS = 60_000; // 1 minute

// Map of userId → RateBucket
const buckets = new Map<string, RateBucket>();

/**
 * Check if the user has remaining rate limit budget.
 * Returns true if allowed, false if rate-limited.
 */
export function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(userId);

  if (!bucket) {
    bucket = { tokens: MAX_TOKENS - 1, lastRefill: now };
    buckets.set(userId, bucket);
    return true;
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refillAmount = Math.floor(elapsed / REFILL_INTERVAL_MS) * MAX_TOKENS;

  if (refillAmount > 0) {
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + refillAmount);
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) {
    return false; // rate limited
  }

  bucket.tokens -= 1;
  return true;
}

/**
 * Create a 429 Too Many Requests response.
 */
export function rateLimitResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded",
      message: "Too many requests. Please slow down and try again in a minute.",
      retryAfter: 60,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}

/**
 * Reset rate limit for a user — used in tests.
 */
export function _resetRateLimitForTesting(userId?: string): void {
  if (userId) {
    buckets.delete(userId);
  } else {
    buckets.clear();
  }
}
