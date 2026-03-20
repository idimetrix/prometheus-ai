import { createLogger } from "@prometheus/logger";
import { getCorrelationHeaders } from "./correlation";

const logger = createLogger("utils:http-client");

const TRAILING_SLASH_RE = /\/$/;

interface HttpClientConfig {
  /** Base URL for all requests */
  baseUrl: string;
  /** Circuit breaker: time to stay open in ms (default: 30000) */
  circuitBreakerResetMs?: number;
  /** Circuit breaker: consecutive failures to trip (default: 5) */
  circuitBreakerThreshold?: number;
  /** Default headers for all requests */
  defaultHeaders?: Record<string, string>;
  /** Max retries for 5xx errors (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelay?: number;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

interface RequestOptions {
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** Request headers */
  headers?: Record<string, string>;
  /** HTTP method */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Skip retry for this request */
  skipRetry?: boolean;
  /** Override timeout for this request */
  timeout?: number;
}

interface HttpResponse<T = unknown> {
  data: T;
  headers: Headers;
  ok: boolean;
  status: number;
}

type CircuitState = "closed" | "open" | "half-open";

/**
 * HttpClient provides a consistent HTTP client for service-to-service
 * communication with retry, circuit breaker, and structured logging.
 */
export class HttpClient {
  private readonly config: Required<HttpClientConfig>;
  private circuitState: CircuitState = "closed";
  private consecutiveFailures = 0;
  private circuitOpenedAt = 0;

  constructor(config: HttpClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(TRAILING_SLASH_RE, ""),
      timeout: config.timeout ?? 30_000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelay: config.retryBaseDelay ?? 1000,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: config.circuitBreakerResetMs ?? 30_000,
      defaultHeaders: {
        "Content-Type": "application/json",
        ...config.defaultHeaders,
      },
    };
  }

  get<T = unknown>(
    path: string,
    options?: Omit<RequestOptions, "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  post<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  put<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "PUT", body });
  }

  patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "PATCH", body });
  }

  delete<T = unknown>(
    path: string,
    options?: Omit<RequestOptions, "method" | "body">
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    // Circuit breaker check
    if (this.circuitState === "open") {
      const elapsed = Date.now() - this.circuitOpenedAt;
      if (elapsed < this.config.circuitBreakerResetMs) {
        throw new HttpClientError(
          `Circuit breaker is open for ${this.config.baseUrl}. Retry after ${Math.ceil((this.config.circuitBreakerResetMs - elapsed) / 1000)}s.`,
          0,
          "CIRCUIT_OPEN"
        );
      }
      // Transition to half-open
      this.circuitState = "half-open";
      logger.info(
        { baseUrl: this.config.baseUrl },
        "Circuit breaker half-open, attempting request"
      );
    }

    const method = options.method ?? "GET";
    const url = `${this.config.baseUrl}${path}`;
    const timeout = options.timeout ?? this.config.timeout;
    const maxRetries = options.skipRetry ? 0 : this.config.maxRetries;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            ...this.config.defaultHeaders,
            ...getCorrelationHeaders(),
            ...options.headers,
          },
          body: options.body == null ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(timeout),
        });

        if (response.ok || (response.status >= 400 && response.status < 500)) {
          // Success or client error (don't retry 4xx)
          this.onSuccess();

          const data = await this.parseResponse<T>(response);

          if (!response.ok) {
            throw new HttpClientError(
              `HTTP ${response.status}: ${JSON.stringify(data)}`,
              response.status,
              "CLIENT_ERROR"
            );
          }

          return {
            data,
            status: response.status,
            headers: response.headers,
            ok: true,
          };
        }

        // 5xx: retry
        lastError = new HttpClientError(
          `HTTP ${response.status} from ${method} ${path}`,
          response.status,
          "SERVER_ERROR"
        );

        if (attempt < maxRetries) {
          const delay = this.config.retryBaseDelay * 2 ** attempt;
          logger.warn(
            {
              url,
              status: response.status,
              attempt: attempt + 1,
              nextRetryMs: delay,
            },
            "Request failed, retrying"
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      } catch (error) {
        if (error instanceof HttpClientError) {
          if (error.code === "CLIENT_ERROR") {
            throw error;
          }
          lastError = error;
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        if (attempt < maxRetries) {
          const delay = this.config.retryBaseDelay * 2 ** attempt;
          logger.warn(
            {
              url,
              error: lastError.message,
              attempt: attempt + 1,
              nextRetryMs: delay,
            },
            "Request error, retrying"
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    // All retries exhausted
    this.onFailure();
    throw lastError ?? new Error(`Request failed: ${method} ${path}`);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  private onSuccess(): void {
    if (this.circuitState === "half-open") {
      logger.info(
        { baseUrl: this.config.baseUrl },
        "Circuit breaker closed after successful request"
      );
    }
    this.consecutiveFailures = 0;
    this.circuitState = "closed";
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.circuitState = "open";
      this.circuitOpenedAt = Date.now();
      logger.error(
        {
          baseUrl: this.config.baseUrl,
          failures: this.consecutiveFailures,
        },
        "Circuit breaker opened"
      );
    }
  }

  /** Get current circuit breaker state */
  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  /** Reset circuit breaker state */
  resetCircuit(): void {
    this.circuitState = "closed";
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = 0;
  }
}

export class HttpClientError extends Error {
  readonly status: number;
  readonly code: "SERVER_ERROR" | "CLIENT_ERROR" | "CIRCUIT_OPEN" | "TIMEOUT";

  constructor(
    message: string,
    status: number,
    code: "SERVER_ERROR" | "CLIENT_ERROR" | "CIRCUIT_OPEN" | "TIMEOUT"
  ) {
    super(message);
    this.name = "HttpClientError";
    this.status = status;
    this.code = code;
  }
}
