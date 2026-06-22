/**
 * Rate Limiter - Prevents API abuse with exponential backoff
 */

export interface RateLimiterOptions {
  minDelay?: number;
  maxDelay?: number;
  maxRetries?: number;
  backoffFactor?: number;
  /** Per-request timeout in ms; a stalled connection aborts instead of hanging. */
  requestTimeout?: number;
}

/**
 * Parse an HTTP `Retry-After` header, which may be a delay in seconds or an
 * HTTP-date. Returns the delay in milliseconds, or null when unparseable.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

export class RateLimiter {
  private minDelay: number;
  private maxDelay: number;
  private maxRetries: number;
  private backoffFactor: number;
  private requestTimeout: number;
  private lastRequestTime: number;
  private currentDelay: number;
  private consecutiveErrors: number;

  constructor(options: RateLimiterOptions = {}) {
    this.minDelay = options.minDelay || 100;      // Min delay between requests (ms)
    this.maxDelay = options.maxDelay || 30000;    // Max delay after backoff (ms)
    this.maxRetries = options.maxRetries || 3;    // Max retry attempts
    this.backoffFactor = options.backoffFactor || 2;
    this.requestTimeout = options.requestTimeout || 15000; // Abort a stalled request
    this.lastRequestTime = 0;
    this.currentDelay = this.minDelay;
    this.consecutiveErrors = 0;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.currentDelay) {
      await new Promise(r => setTimeout(r, this.currentDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  onSuccess(): void {
    // Gradually reduce delay on success
    this.consecutiveErrors = 0;
    this.currentDelay = Math.max(this.minDelay, this.currentDelay / this.backoffFactor);
  }

  onError(statusCode: number): boolean {
    this.consecutiveErrors++;
    // Exponential backoff
    if (statusCode === 429 || statusCode >= 500) {
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay * this.backoffFactor);
    }
    return this.consecutiveErrors <= this.maxRetries;
  }

  async fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
    let lastError: Error | undefined;
    const callerSignal = options.signal ?? undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.wait();

      // Bound each attempt so a half-open connection cannot hang the run
      // forever; merge the caller's signal so an external cancel still works.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('Request timed out')), this.requestTimeout);
      const onCallerAbort = () => controller.abort((callerSignal as AbortSignal).reason);
      if (callerSignal) {
        if (callerSignal.aborted) controller.abort(callerSignal.reason);
        else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      }

      try {
        const response = await fetch(url, { ...options, signal: controller.signal });

        if (response.status === 429) {
          // Rate limited - back off. Retry-After may be seconds or an HTTP-date.
          const delay = parseRetryAfter(response.headers.get('Retry-After')) ?? this.currentDelay * 2;
          this.currentDelay = Math.min(this.maxDelay, delay);
          if (!this.onError(429)) break;
          continue;
        }

        if (response.status >= 500 && attempt < this.maxRetries) {
          // Server error - retry with backoff
          if (!this.onError(response.status)) break;
          continue;
        }

        this.onSuccess();
        return response;
      } catch (err) {
        // A caller-initiated abort is intentional cancellation, not a failure
        // to retry around.
        if (callerSignal?.aborted) throw err;
        lastError = err as Error;
        if (!this.onError(0)) break;
      } finally {
        clearTimeout(timer);
        if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }
}

// Shared rate limiters for different APIs
export const crossrefLimiter = new RateLimiter({ minDelay: 100, maxDelay: 10000 });
export const dataciteLimiter = new RateLimiter({ minDelay: 100, maxDelay: 10000 });
export const doiOrgLimiter = new RateLimiter({ minDelay: 200, maxDelay: 15000 });
