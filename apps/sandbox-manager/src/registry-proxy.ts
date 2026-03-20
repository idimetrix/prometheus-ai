import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:registry-proxy");

/** Registry base URLs */
const REGISTRY_URLS: Record<string, string> = {
  npm: "https://registry.npmjs.org",
  pip: "https://pypi.org",
  cargo: "https://crates.io/api/v1",
};

/** Cache TTL: 24 hours */
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum cache size in bytes (1GB) */
const DEFAULT_MAX_CACHE_BYTES = 1024 * 1024 * 1024;

/** Known vulnerable packages (basic CVE list for scanning) */
const KNOWN_VULNERABILITIES: Map<string, string[]> = new Map([
  // Example known CVEs -- in production, this would be sourced from
  // an external vulnerability database (e.g., GitHub Advisory Database)
  ["event-stream@3.3.6", ["CVE-2018-16487"]],
  ["ua-parser-js@0.7.29", ["CVE-2021-27292"]],
  ["colors@1.4.1", ["CVE-2022-23601"]],
  ["node-ipc@10.1.1", ["CVE-2022-23812"]],
]);

interface CachedPackage {
  cachedAt: number;
  contentType: string;
  data: string;
  packageName: string;
  registry: string;
  sizeBytes: number;
  version: string;
}

export interface ProxyResult {
  cached: boolean;
  contentType: string;
  data: string;
  statusCode: number;
  vulnerabilities: string[];
}

interface RegistryProxyConfig {
  /** Cache TTL in milliseconds (default: 24 hours) */
  cacheTtlMs?: number;
  /** Maximum cache size in bytes (default: 1GB) */
  maxCacheBytes?: number;
}

/**
 * Caching proxy for package registries (npm, pip, cargo).
 *
 * Features:
 * - Transparent caching of downloaded packages
 * - Basic vulnerability scanning against known CVE list
 * - Support for npm, pip, and cargo registries
 * - Automatic cache eviction when size exceeds limit
 */
export class RegistryProxy {
  private readonly cache = new Map<string, CachedPackage>();
  private readonly cacheTtlMs: number;
  private readonly maxCacheBytes: number;
  private totalCacheBytes = 0;

  constructor(config?: RegistryProxyConfig) {
    this.cacheTtlMs = config?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxCacheBytes = config?.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
  }

  /**
   * Proxy a package request through the cache.
   * Checks cache first, then fetches from the registry if needed.
   * Performs basic vulnerability scanning before returning.
   */
  async proxyRequest(
    registry: "npm" | "pip" | "cargo",
    packageName: string,
    version?: string
  ): Promise<ProxyResult> {
    const cacheKey = `${registry}:${packageName}:${version ?? "latest"}`;

    // Check vulnerability list before proceeding
    const vulns = this.scanForVulnerabilities(packageName, version ?? "latest");

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      logger.debug(
        { registry, packageName, version, cached: true },
        "Registry proxy cache hit"
      );
      return {
        data: cached.data,
        contentType: cached.contentType,
        statusCode: 200,
        cached: true,
        vulnerabilities: vulns,
      };
    }

    // Fetch from registry
    const registryUrl = REGISTRY_URLS[registry];
    if (!registryUrl) {
      return {
        data: `Unknown registry: ${registry}`,
        contentType: "text/plain",
        statusCode: 400,
        cached: false,
        vulnerabilities: vulns,
      };
    }

    const url = this.buildRegistryUrl(registry, packageName, version);

    logger.info(
      { registry, packageName, version, url },
      "Fetching package from registry"
    );

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          data: errorText,
          contentType: "text/plain",
          statusCode: response.status,
          cached: false,
          vulnerabilities: vulns,
        };
      }

      const data = await response.text();
      const contentType =
        response.headers.get("content-type") ?? "application/json";
      const sizeBytes = new TextEncoder().encode(data).length;

      // Cache the response
      this.addToCache(cacheKey, {
        registry,
        packageName,
        version: version ?? "latest",
        data,
        contentType,
        sizeBytes,
        cachedAt: Date.now(),
      });

      logger.info(
        {
          registry,
          packageName,
          version,
          sizeBytes,
          vulnerabilities: vulns.length,
        },
        "Package fetched and cached"
      );

      return {
        data,
        contentType,
        statusCode: 200,
        cached: false,
        vulnerabilities: vulns,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { registry, packageName, version, error: msg },
        "Registry fetch failed"
      );

      return {
        data: `Failed to fetch package: ${msg}`,
        contentType: "text/plain",
        statusCode: 502,
        cached: false,
        vulnerabilities: vulns,
      };
    }
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): {
    entryCount: number;
    maxBytes: number;
    totalBytes: number;
    utilizationPercent: number;
  } {
    return {
      entryCount: this.cache.size,
      totalBytes: this.totalCacheBytes,
      maxBytes: this.maxCacheBytes,
      utilizationPercent: Math.round(
        (this.totalCacheBytes / this.maxCacheBytes) * 100
      ),
    };
  }

  /**
   * Clear the entire cache.
   */
  clearCache(): void {
    this.cache.clear();
    this.totalCacheBytes = 0;
    logger.info("Registry proxy cache cleared");
  }

  /**
   * Remove expired cache entries.
   * Returns the number of entries removed.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > this.cacheTtlMs) {
        this.totalCacheBytes -= entry.sizeBytes;
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info(
        { removed, remaining: this.cache.size },
        "Expired cache entries cleaned up"
      );
    }

    return removed;
  }

  // ─── Private helpers ────────────────────────────────────────────────

  /**
   * Build the appropriate URL for each registry type.
   */
  private buildRegistryUrl(
    registry: "npm" | "pip" | "cargo",
    packageName: string,
    version?: string
  ): string {
    const baseUrl = REGISTRY_URLS[registry] as string;

    switch (registry) {
      case "npm": {
        if (version) {
          return `${baseUrl}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
        }
        return `${baseUrl}/${encodeURIComponent(packageName)}`;
      }
      case "pip": {
        return `${baseUrl}/pypi/${encodeURIComponent(packageName)}/json`;
      }
      case "cargo": {
        return `${baseUrl}/crates/${encodeURIComponent(packageName)}`;
      }
      default:
        return `${baseUrl}/${encodeURIComponent(packageName)}`;
    }
  }

  /**
   * Scan a package for known vulnerabilities.
   * Returns a list of CVE identifiers if any are found.
   */
  private scanForVulnerabilities(
    packageName: string,
    version: string
  ): string[] {
    const key = `${packageName}@${version}`;
    const vulns = KNOWN_VULNERABILITIES.get(key);

    if (vulns && vulns.length > 0) {
      logger.warn(
        { packageName, version, cves: vulns },
        "Known vulnerabilities detected in package"
      );
    }

    return vulns ?? [];
  }

  /**
   * Add an entry to the cache, evicting old entries if needed.
   */
  private addToCache(key: string, entry: CachedPackage): void {
    // Remove existing entry if present
    const existing = this.cache.get(key);
    if (existing) {
      this.totalCacheBytes -= existing.sizeBytes;
    }

    // Evict old entries if cache is too large
    while (
      this.totalCacheBytes + entry.sizeBytes > this.maxCacheBytes &&
      this.cache.size > 0
    ) {
      // Remove the oldest entry (first in map iteration order)
      const firstKey = this.cache.keys().next().value as string;
      const firstEntry = this.cache.get(firstKey);
      if (firstEntry) {
        this.totalCacheBytes -= firstEntry.sizeBytes;
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
    this.totalCacheBytes += entry.sizeBytes;
  }
}
