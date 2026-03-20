/**
 * BM25 Full-Text Search via PostgreSQL tsvector/tsquery.
 *
 * Uses PostgreSQL's built-in full-text search capabilities for
 * keyword-based code search with BM25-like ranking via ts_rank_cd.
 *
 * Enhanced with:
 * - GIN index support for fast full-text search
 * - CamelCase splitting for identifier matching
 * - Phrase matching support via tsquery operators
 * - Configurable text search configurations
 */

import { codeEmbeddings, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { sql } from "drizzle-orm";

const logger = createLogger("project-brain:bm25-search");

const WHITESPACE_RE = /\s+/;
const NON_WORD_RE = /[^a-zA-Z0-9_]/g;
const CAMEL_CASE_RE = /([a-z])([A-Z])/g;
const UPPER_CAMEL_RE = /([A-Z]+)([A-Z][a-z])/g;
const SNAKE_CASE_RE = /_+/;
const PHRASE_RE = /"([^"]+)"/g;

export interface BM25Result {
  content: string;
  filePath: string;
  highlights: string[];
  score: number;
}

export interface BM25SearchOptions {
  camelCaseSplit?: boolean;
  config?: string;
  enablePhraseBoost?: boolean;
  normalization?: number;
}

const DEFAULT_OPTIONS: Required<BM25SearchOptions> = {
  config: "english",
  camelCaseSplit: true,
  enablePhraseBoost: true,
  normalization: 32,
};

/**
 * Split a CamelCase or snake_case identifier into individual terms.
 */
export function splitIdentifier(identifier: string): string[] {
  const snakeParts = identifier.split(SNAKE_CASE_RE);
  const result: string[] = [];
  for (const part of snakeParts) {
    if (!part) {
      continue;
    }
    const camelSplit = part
      .replace(CAMEL_CASE_RE, "$1 $2")
      .replace(UPPER_CAMEL_RE, "$1 $2")
      .split(" ")
      .filter((s) => s.length > 0);
    for (const token of camelSplit) {
      result.push(token);
    }
  }
  return result;
}

/**
 * Build a tsquery string from a natural language query with phrase and CamelCase support.
 */
export function buildTsQuery(
  query: string,
  options: BM25SearchOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parts: string[] = [];

  const phrases: string[] = [];
  let remaining = query;
  if (opts.enablePhraseBoost) {
    PHRASE_RE.lastIndex = 0;
    let phraseMatch: RegExpExecArray | null = PHRASE_RE.exec(query);
    while (phraseMatch !== null) {
      if (phraseMatch[1]) {
        phrases.push(phraseMatch[1]);
      }
      phraseMatch = PHRASE_RE.exec(query);
    }
    remaining = query.replace(PHRASE_RE, "").trim();
  }

  for (const phrase of phrases) {
    const words = phrase
      .split(WHITESPACE_RE)
      .filter((w) => w.length > 0)
      .map((w) => w.replace(NON_WORD_RE, ""))
      .filter((w) => w.length > 0);
    if (words.length > 1) {
      parts.push(`(${words.map((w) => `'${w}'`).join(" <-> ")})`);
    } else if (words.length === 1 && words[0]) {
      parts.push(`'${words[0]}'`);
    }
  }

  const words = remaining
    .split(WHITESPACE_RE)
    .filter((w) => w.length > 0)
    .map((w) => w.replace(NON_WORD_RE, ""))
    .filter((w) => w.length > 0);

  for (const word of words) {
    if (opts.camelCaseSplit) {
      const subTokens = splitIdentifier(word);
      if (subTokens.length > 1) {
        const splitQuery = subTokens
          .map((t) => `'${t.toLowerCase()}'`)
          .join(" & ");
        parts.push(`(${splitQuery} | '${word.toLowerCase()}')`);
        continue;
      }
    }
    parts.push(`'${word.toLowerCase()}'`);
  }

  return parts.join(" & ");
}

export class BM25Search {
  private readonly options: Required<BM25SearchOptions>;
  private ginIndexEnsured = false;

  constructor(options?: BM25SearchOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async ensureGinIndex(): Promise<void> {
    if (this.ginIndexEnsured) {
      return;
    }
    try {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_code_embeddings_fts
        ON code_embeddings USING GIN (to_tsvector('english', content))
      `);
      this.ginIndexEnsured = true;
      logger.info("GIN index for full-text search ensured");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to ensure GIN index");
      this.ginIndexEnsured = true;
    }
  }

  async search(
    projectId: string,
    query: string,
    limit = 20
  ): Promise<BM25Result[]> {
    const start = performance.now();
    await this.ensureGinIndex();

    const tsQuery = buildTsQuery(query, this.options);
    if (!tsQuery) {
      return [];
    }

    const config = this.options.config;
    const normalization = this.options.normalization;

    try {
      const results = await db.execute<{
        file_path: string;
        content: string;
        rank_score: number;
        headline: string;
      }>(sql`
        SELECT
          ${codeEmbeddings.filePath} as file_path,
          ${codeEmbeddings.content} as content,
          ts_rank_cd(
            to_tsvector(${sql.raw(`'${config}'`)}, ${codeEmbeddings.content}),
            to_tsquery(${sql.raw(`'${config}'`)}, ${tsQuery}),
            ${normalization}
          ) as rank_score,
          ts_headline(
            ${sql.raw(`'${config}'`)},
            ${codeEmbeddings.content},
            to_tsquery(${sql.raw(`'${config}'`)}, ${tsQuery}),
            'StartSel=<<, StopSel=>>, MaxWords=60, MinWords=20, MaxFragments=3, FragmentDelimiter= ... '
          ) as headline
        FROM ${codeEmbeddings}
        WHERE ${codeEmbeddings.projectId} = ${projectId}
          AND to_tsvector(${sql.raw(`'${config}'`)}, ${codeEmbeddings.content})
            @@ to_tsquery(${sql.raw(`'${config}'`)}, ${tsQuery})
        ORDER BY rank_score DESC
        LIMIT ${limit}
      `);

      const searchResults: BM25Result[] = [];
      for (const row of results ?? []) {
        const r = row as {
          file_path: string;
          content: string;
          rank_score: number;
          headline: string;
        };
        searchResults.push({
          filePath: r.file_path,
          content: r.content,
          score: r.rank_score,
          highlights: r.headline
            ? r.headline.split(" ... ").filter((h) => h.trim().length > 0)
            : [],
        });
      }

      const elapsed = Math.round(performance.now() - start);
      logger.debug(
        {
          projectId,
          query: query.slice(0, 80),
          tsQuery: tsQuery.slice(0, 120),
          resultCount: searchResults.length,
          durationMs: elapsed,
        },
        `BM25 search returned ${searchResults.length} results`
      );
      return searchResults;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { projectId, query: query.slice(0, 80), tsQuery, error: msg },
        "BM25 search failed"
      );
      return [];
    }
  }

  async searchWithPhraseBoost(
    projectId: string,
    query: string,
    limit = 20
  ): Promise<BM25Result[]> {
    const phraseQuery = `"${query}"`;
    const [phraseResults, keywordResults] = await Promise.all([
      this.search(projectId, phraseQuery, limit),
      this.search(projectId, query, limit),
    ]);

    const resultMap = new Map<string, BM25Result>();
    for (const r of keywordResults) {
      resultMap.set(`${r.filePath}:${r.content.slice(0, 60)}`, r);
    }
    for (const r of phraseResults) {
      const key = `${r.filePath}:${r.content.slice(0, 60)}`;
      const existing = resultMap.get(key);
      if (existing) {
        existing.score += r.score * 1.5;
      } else {
        resultMap.set(key, { ...r, score: r.score * 1.5 });
      }
    }

    return Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
