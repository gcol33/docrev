/**
 * Rate Limiter - Prevents API abuse with exponential backoff
 */

export class RateLimiter {
  constructor(options = {}) {
    this.minDelay = options.minDelay || 100;      // Min delay between requests (ms)
    this.maxDelay = options.maxDelay || 30000;    // Max delay after backoff (ms)
    this.maxRetries = options.maxRetries || 3;    // Max retry attempts
    this.backoffFactor = options.backoffFactor || 2;
    this.lastRequestTime = 0;
    this.currentDelay = this.minDelay;
    this.consecutiveErrors = 0;
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.currentDelay) {
      await new Promise(r => setTimeout(r, this.currentDelay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  onSuccess() {
    // Gradually reduce delay on success
    this.consecutiveErrors = 0;
    this.currentDelay = Math.max(this.minDelay, this.currentDelay / this.backoffFactor);
  }

  onError(statusCode) {
    this.consecutiveErrors++;
    // Exponential backoff
    if (statusCode === 429 || statusCode >= 500) {
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay * this.backoffFactor);
    }
    return this.consecutiveErrors <= this.maxRetries;
  }

  async fetchWithRetry(url, options = {}) {
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.wait();

      try {
        const response = await fetch(url, options);

        if (response.status === 429) {
          // Rate limited - back off
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.currentDelay * 2;
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
        lastError = err;
        if (!this.onError(0)) break;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }
}

// Shared rate limiters for different APIs
export const crossrefLimiter = new RateLimiter({ minDelay: 100, maxDelay: 10000 });
export const dataciteLimiter = new RateLimiter({ minDelay: 100, maxDelay: 10000 });
export const doiOrgLimiter = new RateLimiter({ minDelay: 200, maxDelay: 15000 });
