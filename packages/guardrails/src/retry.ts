/**
 * Exponential Backoff Retry Utility
 *
 * A generic retry wrapper for any async function. Extracted and generalised
 * from the retry logic embedded in Zyphos's agent execution layer.
 *
 * Features:
 *   • Exponential backoff with configurable base delay and cap
 *   • Optional jitter to spread thundering-herd retries
 *   • Per-attempt error inspection (e.g. skip retry on 4xx responses)
 *   • onRetry callback for logging / metrics
 *
 * Usage:
 *   const result = await withRetry(
 *     () => fetch("https://api.example.com/data"),
 *     { maxAttempts: 5, baseDelayMs: 500 }
 *   );
 *
 *   // Or wrap a function for reuse:
 *   const retryingFetch = createRetryable(
 *     () => myApiClient.call(),
 *     { maxAttempts: 3, onRetry: ({ attempt, error }) => logger.warn("Retry", attempt, error.message) }
 *   );
 */

export interface RetryConfig {
  /**
   * Maximum number of attempts (including the first try).
   * Default: 3
   */
  maxAttempts?: number;

  /**
   * Base delay in milliseconds before the first retry.
   * The actual delay is: min(baseDelayMs * 2^attempt, maxDelayMs)
   * Default: 1 000 ms
   */
  baseDelayMs?: number;

  /**
   * Maximum delay cap in milliseconds.
   * Default: 16 000 ms
   */
  maxDelayMs?: number;

  /**
   * Whether to add random jitter (±25% of computed delay) to spread retries.
   * Default: true
   */
  jitter?: boolean;

  /**
   * Called before each retry attempt (not before the first attempt).
   * Use for logging or metrics.
   */
  onRetry?: (context: RetryContext) => void | Promise<void>;

  /**
   * Optional predicate called with each error.
   * Return false to abort retries immediately (e.g. for 4xx HTTP errors).
   * Default: always retry.
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

export interface RetryContext {
  /** The 1-based attempt number that just failed (so retryContext.attempt === 1 means the first try failed) */
  attempt: number;
  /** The error that was thrown */
  error: Error;
  /** Milliseconds until the next attempt */
  nextDelayMs: number;
  /** Maximum number of attempts configured */
  maxAttempts: number;
}

// ── Core retry logic ──────────────────────────────────────────────────────────

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean
): number {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  if (!jitter) return exponential;
  // ±25% jitter
  const spread = exponential * 0.25;
  return exponential - spread + Math.random() * spread * 2;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with automatic retry on failure.
 *
 * @param fn    - Async function to execute. Will be called up to `maxAttempts` times.
 * @param config - Retry configuration.
 * @returns The resolved value of `fn` on success.
 * @throws  The last error after all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelayMs = config.baseDelayMs ?? 1_000;
  const maxDelayMs = config.maxDelayMs ?? 16_000;
  const jitter = config.jitter ?? true;

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Last attempt — don't retry
      if (attempt === maxAttempts) break;

      // Check if we should retry this error at all
      if (config.shouldRetry && !config.shouldRetry(lastError, attempt)) {
        break;
      }

      const nextDelayMs = computeDelay(attempt - 1, baseDelayMs, maxDelayMs, jitter);
      const context: RetryContext = {
        attempt,
        error: lastError,
        nextDelayMs,
        maxAttempts,
      };

      if (config.onRetry) {
        await config.onRetry(context);
      }

      await sleep(nextDelayMs);
    }
  }

  throw lastError;
}

/**
 * Create a retryable version of an async function.
 * The returned function has the same signature as `fn` but retries on failure.
 *
 * @example
 *   const safeFetch = createRetryable(
 *     (url: string) => fetch(url).then(r => r.json()),
 *     { maxAttempts: 3 }
 *   );
 *   const data = await safeFetch("https://api.example.com");
 */
export function createRetryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: RetryConfig = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), config);
}
