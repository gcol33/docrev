/**
 * Rate Limiter - Prevents API abuse with exponential backoff
 */
export interface RateLimiterOptions {
    minDelay?: number;
    maxDelay?: number;
    maxRetries?: number;
    backoffFactor?: number;
}
export declare class RateLimiter {
    private minDelay;
    private maxDelay;
    private maxRetries;
    private backoffFactor;
    private lastRequestTime;
    private currentDelay;
    private consecutiveErrors;
    constructor(options?: RateLimiterOptions);
    wait(): Promise<void>;
    onSuccess(): void;
    onError(statusCode: number): boolean;
    fetchWithRetry(url: string, options?: RequestInit): Promise<Response>;
}
export declare const crossrefLimiter: RateLimiter;
export declare const dataciteLimiter: RateLimiter;
export declare const doiOrgLimiter: RateLimiter;
//# sourceMappingURL=rate-limiter.d.ts.map