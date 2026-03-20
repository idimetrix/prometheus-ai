/**
 * HTTP client for Zoekt code search server.
 *
 * Zoekt is a fast, trigram-based code search engine. This client
 * communicates with a running Zoekt web server over HTTP.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("code-intelligence:zoekt");
const TRAILING_SLASH_RE = /\/+$/;

/**
 * A range within a line indicating where a match occurs.
 */
export interface MatchRange {
  /** End byte offset within the line */
  end: number;
  /** Start byte offset within the line */
  start: number;
}

/**
 * A single search result from Zoekt.
 */
export interface ZoektResult {
  /** The full content of the matching line */
  content: string;
  /** File path relative to the repository root */
  file: string;
  /** 1-indexed line number of the match */
  lineNum: number;
  /** Ranges within the line that matched */
  matchRanges: MatchRange[];
  /** Repository or file collection name */
  repo: string;
}

/**
 * Options for a Zoekt search query.
 */
export interface ZoektSearchOptions {
  /** Case-sensitive search (default: false) */
  caseSensitive?: boolean;
  /** Maximum number of matches to return (default: 100) */
  maxMatches?: number;
  /** Whether to use regex matching (default: false for literal) */
  regex?: boolean;
  /** Limit search to specific repositories */
  repos?: string[];
}

/**
 * Aggregate statistics from a Zoekt search.
 */
export interface ZoektSearchStats {
  /** Duration of the search in milliseconds */
  durationMs: number;
  /** Total number of files searched */
  filesSearched: number;
  /** Total number of matches found */
  totalMatches: number;
}

/**
 * Full search response from Zoekt.
 */
export interface ZoektSearchResponse {
  /** The matching results */
  results: ZoektResult[];
  /** Search statistics */
  stats: ZoektSearchStats;
}

/**
 * Raw Zoekt API response shape.
 */
interface ZoektApiResponse {
  Result?: {
    Files?: ZoektApiFile[];
    Stats?: {
      FilesLoaded?: number;
      MatchCount?: number;
      Duration?: number;
    };
  };
}

interface ZoektApiFile {
  FileName?: string;
  LineMatches?: ZoektApiLineMatch[];
  Repository?: string;
}

interface ZoektApiLineMatch {
  Line?: string;
  LineFragments?: ZoektApiFragment[];
  LineNumber?: number;
}

interface ZoektApiFragment {
  MatchLength?: number;
  Offset?: number;
}

/**
 * HTTP client for communicating with a Zoekt code search server.
 *
 * Requires a running Zoekt web server (zoekt-webserver).
 *
 * @example
 * ```ts
 * const client = new ZoektClient("http://localhost:6070");
 * const response = await client.search("handleRequest", {
 *   repos: ["prometheus"],
 *   maxMatches: 50,
 * });
 *
 * for (const result of response.results) {
 *   console.log(`${result.file}:${result.lineNum} ${result.content}`);
 * }
 * ```
 */
export class ZoektClient {
  private readonly baseUrl: string;
  private readonly defaultTimeout: number;

  /**
   * @param baseUrl - The base URL of the Zoekt web server (e.g., "http://localhost:6070")
   * @param defaultTimeout - Default request timeout in milliseconds (default: 10000)
   */
  constructor(baseUrl: string, defaultTimeout = 10_000) {
    this.baseUrl = baseUrl.replace(TRAILING_SLASH_RE, "");
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Search for code across indexed repositories.
   *
   * @param query - The search query string
   * @param opts - Search options (repos filter, max matches, etc.)
   * @returns Search response with results and statistics
   */
  async search(
    query: string,
    opts?: ZoektSearchOptions
  ): Promise<ZoektSearchResponse> {
    const maxMatches = opts?.maxMatches ?? 100;
    const searchQuery = this.buildQuery(query, opts);

    const url = new URL("/api/search", this.baseUrl);
    url.searchParams.set("q", searchQuery);
    url.searchParams.set("num", String(maxMatches));

    logger.debug({ query: searchQuery, maxMatches }, "Executing Zoekt search");

    const start = performance.now();

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(this.defaultTimeout),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(
        { status: response.status, body },
        `Zoekt search failed with status ${response.status}`
      );
      throw new Error(`Zoekt search failed: HTTP ${response.status} - ${body}`);
    }

    const data = (await response.json()) as ZoektApiResponse;
    const elapsed = Math.round(performance.now() - start);

    const results = this.parseResults(data);

    logger.debug(
      { query: searchQuery, resultCount: results.length, durationMs: elapsed },
      `Zoekt search returned ${results.length} results in ${elapsed}ms`
    );

    return {
      results,
      stats: {
        filesSearched: data.Result?.Stats?.FilesLoaded ?? 0,
        totalMatches: data.Result?.Stats?.MatchCount ?? results.length,
        durationMs: data.Result?.Stats?.Duration
          ? Math.round(data.Result.Stats.Duration / 1_000_000) // nanoseconds to ms
          : elapsed,
      },
    };
  }

  /**
   * Check if the Zoekt server is reachable and healthy.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/healthz`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Build a Zoekt query string with optional repo filters.
   */
  private buildQuery(query: string, opts?: ZoektSearchOptions): string {
    const parts: string[] = [];

    // Add repo filters
    if (opts?.repos && opts.repos.length > 0) {
      const repoFilter = opts.repos.map((r) => `repo:${r}`).join(" ");
      parts.push(repoFilter);
    }

    // Add case sensitivity modifier
    if (opts?.caseSensitive) {
      parts.push("case:yes");
    }

    // Add the main query (wrap in regex if requested)
    if (opts?.regex) {
      parts.push(query);
    } else {
      // Literal search: escape regex special characters
      parts.push(escapeRegex(query));
    }

    return parts.join(" ");
  }

  /**
   * Parse raw Zoekt API response into typed results.
   */
  private parseResults(data: ZoektApiResponse): ZoektResult[] {
    const files = data.Result?.Files ?? [];
    const results: ZoektResult[] = [];

    for (const file of files) {
      const repo = file.Repository ?? "";
      const fileName = file.FileName ?? "";

      for (const lineMatch of file.LineMatches ?? []) {
        const matchRanges: MatchRange[] = [];

        for (const fragment of lineMatch.LineFragments ?? []) {
          if (
            fragment.Offset !== undefined &&
            fragment.MatchLength !== undefined
          ) {
            matchRanges.push({
              start: fragment.Offset,
              end: fragment.Offset + fragment.MatchLength,
            });
          }
        }

        results.push({
          repo,
          file: fileName,
          lineNum: (lineMatch.LineNumber ?? 0) + 1, // Zoekt uses 0-indexed
          content: decodeBase64Line(lineMatch.Line),
          matchRanges,
        });
      }
    }

    return results;
  }

  /**
   * Search and return results formatted for the fusion search pipeline.
   *
   * Wraps the standard search method and transforms results into a
   * format compatible with RRF fusion ranking.
   *
   * @param query - The search query string
   * @param opts - Search options
   * @returns Results formatted for fusion with method attribution
   */
  async searchForFusion(
    query: string,
    opts?: ZoektSearchOptions
  ): Promise<
    Array<{
      id: string;
      filePath: string;
      content: string;
      score: number;
      startLine?: number;
    }>
  > {
    const response = await this.search(query, opts);
    return response.results.map((result, index) => ({
      id: `zoekt:${result.file}:${result.lineNum}`,
      filePath: result.file,
      content: result.content,
      score: 1.0 - index * 0.02,
      startLine: result.lineNum,
    }));
  }
}

/**
 * Escape regex special characters for literal Zoekt search.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Decode a Zoekt line match, which may be base64-encoded or plain text.
 */
function decodeBase64Line(line: unknown): string {
  if (typeof line === "string") {
    return line;
  }
  // Zoekt sometimes returns base64-encoded line content
  if (typeof line === "object" && line !== null && "Text" in line) {
    const text = (line as { Text: string }).Text;
    try {
      return Buffer.from(text, "base64").toString("utf-8");
    } catch {
      return text;
    }
  }
  return String(line ?? "");
}
