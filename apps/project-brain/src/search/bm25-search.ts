/**
 * BM25 Full-Text Search via PostgreSQL tsvector/tsquery.
 *
 * Uses PostgreSQL's built-in full-text search capabilities for
 * keyword-based code search with BM25-like ranking via ts_rank_cd.
 */

import { codeEmbeddings, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { sql } from "drizzle-orm";

const logger = createLogger("project-brain:bm25-search");

const WHITESPACE_RE = /\s+/;
const NON_WORD_RE = /[^a-zA-Z0-9_]/g;

/**
 * A single BM25 search result.
 */
export interface BM25Result {
  /** The matching content snippet */
  content: string;
  /** File path relative to project root */
  filePath: string;
  /** Highlighted snippets with matching terms marked */
  highlights: string[];
  /** Relevance score from ts_rank_cd */
  score: number;
}

/**
 * BM25-like full-text search using PostgreSQL tsvector/tsquery.
 *
 * Leverages PostgreSQL's built-in text search for fast keyword matching
 * with relevance ranking. Results include highlighted snippets.
 *
 * @example
 * ```ts
 * const search = new BM25Search();
 * const results = await search.search("proj_123", "authentication handler", 20);
 * for (const r of results) {
 *   console.log(`${r.filePath} (${r.score}): ${r.highlights[0]}`);
 * }
 * ```
 */
export class BM25Search {
  /**
   * Search for code using PostgreSQL full-text search.
   *
   * Converts the query into a tsquery, matches against content stored
   * in the code_embeddings table, and ranks results using ts_rank_cd.
   *
   * @param projectId - The project to search within
   * @param query - Natural language or keyword query
   * @param limit - Maximum number of results (default: 20)
   * @returns Ranked search results with highlights
   */
  async search(
    projectId: string,
    query: string,
    limit = 20
  ): Promise<BM25Result[]> {
    const start = performance.now();

    // Convert the query to a tsquery (split on spaces, join with &)
    const tsQuery = query
      .split(WHITESPACE_RE)
      .filter((word) => word.length > 0)
      .map((word) => word.replace(NON_WORD_RE, ""))
      .filter((word) => word.length > 0)
      .join(" & ");

    if (!tsQuery) {
      return [];
    }

    try {
      const results = await db.execute<{
        file_path: string;
        content: string;
        score: number;
        headline: string;
      }>(sql`
        SELECT
          ${codeEmbeddings.filePath} as file_path,
          ${codeEmbeddings.content} as content,
          ts_rank_cd(
            to_tsvector('english', ${codeEmbeddings.content}),
            to_tsquery('english', ${tsQuery})
          ) as score,
          ts_headline(
            'english',
            ${codeEmbeddings.content},
            to_tsquery('english', ${tsQuery}),
            'StartSel=<<, StopSel=>>, MaxWords=50, MinWords=20'
          ) as headline
        FROM ${codeEmbeddings}
        WHERE ${codeEmbeddings.projectId} = ${projectId}
          AND to_tsvector('english', ${codeEmbeddings.content}) @@ to_tsquery('english', ${tsQuery})
        ORDER BY score DESC
        LIMIT ${limit}
      `);

      const searchResults: BM25Result[] = [];
      for (const row of results ?? []) {
        const r = row as {
          file_path: string;
          content: string;
          score: number;
          headline: string;
        };
        searchResults.push({
          filePath: r.file_path,
          content: r.content,
          score: r.score,
          highlights: r.headline ? [r.headline] : [],
        });
      }

      const elapsed = Math.round(performance.now() - start);

      logger.debug(
        {
          projectId,
          query: query.slice(0, 80),
          resultCount: searchResults.length,
          durationMs: elapsed,
        },
        `BM25 search returned ${searchResults.length} results`
      );

      return searchResults;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { projectId, query: query.slice(0, 80), error: msg },
        "BM25 search failed"
      );
      return [];
    }
  }
}
