import { createLogger } from "@prometheus/logger";

interface ProviderUsage {
  requests: number;
  tokens: number;
  windowStart: number;
  windowMs: number;
  maxRequests: number;
  maxTokens: number;
}

export class RateLimitManager {
  private readonly logger = createLogger("model-router:rate-limiter");
  private readonly usage = new Map<string, ProviderUsage>();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    const configs: Array<[string, { maxRequests: number; maxTokens: number; windowMs: number }]> = [
      ["ollama", { maxRequests: Infinity, maxTokens: Infinity, windowMs: 60000 }],
      ["cerebras", { maxRequests: 30, maxTokens: 1000000, windowMs: 60000 }],
      ["groq", { maxRequests: 30, maxTokens: 131072, windowMs: 60000 }],
      ["gemini", { maxRequests: 15, maxTokens: 4000000, windowMs: 60000 }],
      ["openrouter", { maxRequests: 20, maxTokens: 200000, windowMs: 60000 }],
      ["mistral", { maxRequests: 2, maxTokens: Infinity, windowMs: 60000 }],
      ["deepseek", { maxRequests: 60, maxTokens: Infinity, windowMs: 60000 }],
      ["anthropic", { maxRequests: 50, maxTokens: 80000, windowMs: 60000 }],
      ["openai", { maxRequests: 60, maxTokens: Infinity, windowMs: 60000 }],
    ];

    for (const [provider, config] of configs) {
      this.usage.set(provider, {
        requests: 0,
        tokens: 0,
        windowStart: Date.now(),
        windowMs: config.windowMs,
        maxRequests: config.maxRequests,
        maxTokens: config.maxTokens,
      });
    }
  }

  canMakeRequest(provider: string, modelKey: string): boolean {
    const usage = this.usage.get(provider);
    if (!usage) return false;

    this.resetWindowIfNeeded(usage);

    if (usage.requests >= usage.maxRequests) {
      this.logger.warn({ provider, requests: usage.requests, max: usage.maxRequests }, "Rate limit reached");
      return false;
    }

    return true;
  }

  recordRequest(provider: string, modelKey: string, tokens: number = 0): void {
    const usage = this.usage.get(provider);
    if (!usage) return;

    this.resetWindowIfNeeded(usage);
    usage.requests++;
    usage.tokens += tokens;
  }

  private resetWindowIfNeeded(usage: ProviderUsage): void {
    const now = Date.now();
    if (now - usage.windowStart >= usage.windowMs) {
      usage.requests = 0;
      usage.tokens = 0;
      usage.windowStart = now;
    }
  }

  getStatus(): Record<string, { requests: number; maxRequests: number; remaining: number; resetMs: number }> {
    const status: Record<string, { requests: number; maxRequests: number; remaining: number; resetMs: number }> = {};

    for (const [provider, usage] of this.usage) {
      this.resetWindowIfNeeded(usage);
      status[provider] = {
        requests: usage.requests,
        maxRequests: usage.maxRequests === Infinity ? -1 : usage.maxRequests,
        remaining: usage.maxRequests === Infinity ? -1 : Math.max(0, usage.maxRequests - usage.requests),
        resetMs: Math.max(0, usage.windowMs - (Date.now() - usage.windowStart)),
      };
    }

    return status;
  }
}
