import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CIRCUIT_BREAKER_RE = /Circuit breaker is open/;

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../correlation", () => ({
  getCorrelationHeaders: () => ({}),
}));

vi.mock("../trace-headers", () => ({
  getTraceHeaders: () => ({}),
}));

const mockFetch = vi.fn();

import { HttpClient, HttpClientError } from "../http-client";

describe("HttpClient", () => {
  let client: HttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    client = new HttpClient({
      baseUrl: "http://localhost:4000",
      maxRetries: 0,
      retryBaseDelay: 10,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 100,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("basic requests", () => {
    it("makes GET request with correct URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ data: "test" }),
      });

      const result = await client.get<{ data: string }>("/api/test");

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ data: "test" });
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/api/test",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("makes POST request with JSON body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ id: "123" }),
      });

      const result = await client.post("/api/items", { name: "test" });

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/api/items",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "test" }),
        })
      );
    });

    it("makes PUT request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ updated: true }),
      });

      await client.put("/api/items/1", { name: "updated" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/api/items/1",
        expect.objectContaining({ method: "PUT" })
      );
    });

    it("makes PATCH request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ patched: true }),
      });

      await client.patch("/api/items/1", { name: "patched" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/api/items/1",
        expect.objectContaining({ method: "PATCH" })
      );
    });

    it("makes DELETE request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve(""),
      });

      await client.delete("/api/items/1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4000/api/items/1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("strips trailing slash from baseUrl", () => {
      const c = new HttpClient({ baseUrl: "http://localhost:4000/" });
      expect(c.getCircuitState()).toBe("closed");
    });
  });

  describe("error handling", () => {
    it("throws HttpClientError on 4xx responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ error: "Not found" }),
      });

      await expect(client.get("/api/missing")).rejects.toThrow(HttpClientError);
    });

    it("has correct error properties for client errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ error: "Bad request" }),
      });

      try {
        await client.get("/api/bad");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpClientError);
        const httpErr = err as HttpClientError;
        expect(httpErr.status).toBe(400);
        expect(httpErr.code).toBe("CLIENT_ERROR");
      }
    });

    it("throws on 5xx after retries exhausted", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve("Internal error"),
      });

      await expect(client.get("/api/error")).rejects.toThrow();
    });
  });

  describe("retry logic", () => {
    it("retries on 5xx errors", async () => {
      const retryClient = new HttpClient({
        baseUrl: "http://localhost:4000",
        maxRetries: 2,
        retryBaseDelay: 1,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          text: () => Promise.resolve("error"),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: () => Promise.resolve("unavailable"),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({ data: "success" }),
        });

      const result = await retryClient.get("/api/retry");

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("does not retry on 4xx errors", async () => {
      const retryClient = new HttpClient({
        baseUrl: "http://localhost:4000",
        maxRetries: 2,
        retryBaseDelay: 1,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ error: "Not found" }),
      });

      await expect(retryClient.get("/api/not-found")).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("skips retry when skipRetry is set", async () => {
      const retryClient = new HttpClient({
        baseUrl: "http://localhost:4000",
        maxRetries: 3,
        retryBaseDelay: 1,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve("error"),
      });

      await expect(
        retryClient.get("/api/no-retry", { skipRetry: true })
      ).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("circuit breaker", () => {
    it("starts in closed state", () => {
      expect(client.getCircuitState()).toBe("closed");
    });

    it("opens after threshold consecutive failures", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve("error"),
      });

      // Make enough failing requests to trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await client.get("/api/fail");
        } catch {
          // expected
        }
      }

      expect(client.getCircuitState()).toBe("open");
    });

    it("rejects requests when circuit is open", async () => {
      // Trip the circuit breaker
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve("error"),
      });

      for (let i = 0; i < 3; i++) {
        try {
          await client.get("/api/fail");
        } catch {
          // expected
        }
      }

      await expect(client.get("/api/blocked")).rejects.toThrow(
        CIRCUIT_BREAKER_RE
      );
    });

    it("resets circuit breaker manually", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve("error"),
      });

      for (let i = 0; i < 3; i++) {
        try {
          await client.get("/api/fail");
        } catch {
          // expected
        }
      }

      expect(client.getCircuitState()).toBe("open");

      client.resetCircuit();
      expect(client.getCircuitState()).toBe("closed");
    });
  });

  describe("response parsing", () => {
    it("parses JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ key: "value" }),
      });

      const result = await client.get<{ key: string }>("/api/json");
      expect(result.data.key).toBe("value");
    });

    it("parses text response for non-JSON content type", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        text: () => Promise.resolve("hello"),
      });

      const result = await client.get<string>("/api/text");
      expect(result.data).toBe("hello");
    });
  });

  describe("custom headers", () => {
    it("sends default headers", async () => {
      const customClient = new HttpClient({
        baseUrl: "http://localhost:4000",
        defaultHeaders: { "X-Custom": "value" },
        maxRetries: 0,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
      });

      await customClient.get("/api/headers");

      const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers;
      expect(callHeaders).toHaveProperty("X-Custom", "value");
    });

    it("allows per-request header overrides", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({}),
      });

      await client.get("/api/override", {
        headers: { "X-Request": "specific" },
      });

      const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers;
      expect(callHeaders).toHaveProperty("X-Request", "specific");
    });
  });
});

describe("HttpClientError", () => {
  it("has correct name and properties", () => {
    const error = new HttpClientError("test error", 500, "SERVER_ERROR");

    expect(error.name).toBe("HttpClientError");
    expect(error.message).toBe("test error");
    expect(error.status).toBe(500);
    expect(error.code).toBe("SERVER_ERROR");
    expect(error).toBeInstanceOf(Error);
  });

  it("supports different error codes", () => {
    const codes = [
      "SERVER_ERROR",
      "CLIENT_ERROR",
      "CIRCUIT_OPEN",
      "TIMEOUT",
    ] as const;

    for (const code of codes) {
      const error = new HttpClientError("test", 0, code);
      expect(error.code).toBe(code);
    }
  });
});
