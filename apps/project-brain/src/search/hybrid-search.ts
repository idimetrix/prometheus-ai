/**
 * Hybrid Search Orchestrator
 *
 * Runs three search methods in parallel:
 * 1. Zoekt (trigram/exact) — literal queries, import paths, function names
 * 2. pgvector (semantic) — conceptual queries, "how does auth work"
 * 3. ast-grep (structural) — pattern queries, "all functions returning Promise<void>"
 *
 * Results are fused using Reciprocal Rank Fusion (RRF) and optionally
 * reranked using Voyage rerank-2.5.
 *
 * Target: p99 < 500ms for hybrid search.
 */

import { createLogger } from "@prometheus/logger";
import type { SearchResult, SemanticLayer } from "../layers/semantic";
import {
  type RankedDocument,
  RRFRanker,
  type SearchMethodResult,
} from "./rrf-ranker";

const logger = createLogger("project-brain:hybrid-search");

const ZOEKT_URL = process.env.ZOEKT_URL ?? "http://localhost:6070";
const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";
const VOYAGE_API_BASE = "https://api.voyageai.com/v1";

export interface HybridSearchOptions {
  /** ast-grep patterns to search for (structural) */
  astPatterns?: string[];
  /** Maximum results per method before fusion */
  maxPerMethod?: number;
  /** Whether to apply cross-encoder reranking */
  rerank?: boolean;
  /** Number of final results after fusion */
  topK?: number;
}

export interface HybridSearchResult {
  latencyMs: number;
  methodLatencies: Record<string, number>;
  results: RankedDocument[];
  totalCandidates: number;
}

interface ZoektSearchResponse {
  Result?: {
    Files?: Array<{
      FileName: string;
      LineMatches?: Array<{
        LineNumber: number;
        Line: string;
      }>;
    }>;
  };
}

export class HybridSearch {
  private readonly semantic: SemanticLayer;
  private readonly rrfRanker: RRFRanker;

  constructor(semantic: SemanticLayer) {
    this.semantic = semantic;
    this.rrfRanker = new RRFRanker({
      k: 60,
      maxResults: 40,
      methodWeights: {
        semantic: 1.0,
        zoekt: 0.9,
        "ast-grep": 0.85,
      },
    });
  }

  async search(
    projectId: string,
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult> {
    const startTime = Date.now();
    const maxPerMethod = options.maxPerMethod ?? 30;
    const topK = options.topK ?? 20;
    const methodLatencies: Record<string, number> = {};

    // Run all three search methods in parallel
    const [semanticResult, zoektResult, astResult] = await Promise.allSettled([
      this.searchSemantic(projectId, query, maxPerMethod),
      this.searchZoekt(projectId, query, maxPerMethod),
      this.searchAstGrep(projectId, options.astPatterns ?? [], maxPerMethod),
    ]);

    const methodResults: SearchMethodResult[] = [];

    if (semanticResult.status === "fulfilled") {
      methodResults.push(semanticResult.value.methodResult);
      methodLatencies.semantic = semanticResult.value.latencyMs;
    } else {
      logger.warn(
        { error: String(semanticResult.reason) },
        "Semantic search failed"
      );
      methodLatencies.semantic = -1;
    }

    if (zoektResult.status === "fulfilled") {
      methodResults.push(zoektResult.value.methodResult);
      methodLatencies.zoekt = zoektResult.value.latencyMs;
    } else {
      logger.warn({ error: String(zoektResult.reason) }, "Zoekt search failed");
      methodLatencies.zoekt = -1;
    }

    if (
      astResult.status === "fulfilled" &&
      astResult.value.methodResult.results.length > 0
    ) {
      methodResults.push(astResult.value.methodResult);
      methodLatencies["ast-grep"] = astResult.value.latencyMs;
    } else if (astResult.status === "rejected") {
      logger.warn(
        { error: String(astResult.reason) },
        "ast-grep search failed"
      );
      methodLatencies["ast-grep"] = -1;
    }

    // Fuse results using RRF
    let fusedResults = this.rrfRanker.fuse(methodResults);
    const totalCandidates = methodResults.reduce(
      (sum, m) => sum + m.results.length,
      0
    );

    // Optional cross-encoder reranking via Voyage
    if (options.rerank !== false && fusedResults.length > 0) {
      const rerankStart = Date.now();
      fusedResults = await this.rerankWithVoyage(query, fusedResults, topK);
      methodLatencies.rerank = Date.now() - rerankStart;
    }

    const results = fusedResults.slice(0, topK);
    const latencyMs = Date.now() - startTime;

    logger.info(
      {
        projectId,
        query: query.slice(0, 80),
        totalCandidates,
        fusedCount: fusedResults.length,
        returnedCount: results.length,
        latencyMs,
        methodLatencies,
      },
      "Hybrid search completed"
    );

    return { results, totalCandidates, latencyMs, methodLatencies };
  }

  private async searchSemantic(
    projectId: string,
    query: string,
    maxResults: number
  ): Promise<{ methodResult: SearchMethodResult; latencyMs: number }> {
    const start = Date.now();
    const results = await this.semantic.search(projectId, query, maxResults);

    return {
      latencyMs: Date.now() - start,
      methodResult: {
        method: "semantic",
        results: results.map((r: SearchResult) => ({
          id: `semantic:${r.filePath}:${r.content.slice(0, 50)}`,
          filePath: r.filePath,
          content: r.content,
          score: r.score,
        })),
      },
    };
  }

  private async searchZoekt(
    projectId: string,
    query: string,
    maxResults: number
  ): Promise<{ methodResult: SearchMethodResult; latencyMs: number }> {
    const start = Date.now();

    const response = await fetch(
      `${ZOEKT_URL}/api/search?q=${encodeURIComponent(query)}&num=${maxResults}&ctx=3&repos=${encodeURIComponent(projectId)}`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!response.ok) {
      throw new Error(`Zoekt returned ${response.status}`);
    }

    const data = (await response.json()) as ZoektSearchResponse;
    const files = data.Result?.Files ?? [];

    const results = files.flatMap((file) => {
      const matches = file.LineMatches ?? [];
      return matches.map((match, idx) => ({
        id: `zoekt:${file.FileName}:${match.LineNumber}`,
        filePath: file.FileName,
        content: match.Line,
        score: 1.0 - idx * 0.02,
        startLine: match.LineNumber,
      }));
    });

    return {
      latencyMs: Date.now() - start,
      methodResult: {
        method: "zoekt",
        results: results.slice(0, maxResults),
      },
    };
  }

  private async searchAstGrep(
    projectId: string,
    patterns: string[],
    maxResults: number
  ): Promise<{ methodResult: SearchMethodResult; latencyMs: number }> {
    const start = Date.now();

    if (patterns.length === 0) {
      return {
        latencyMs: Date.now() - start,
        methodResult: { method: "ast-grep", results: [] },
      };
    }

    const allResults: SearchMethodResult["results"] = [];

    for (const pattern of patterns) {
      try {
        const command = `sg run --pattern '${pattern.replace(/'/g, "'\\''")}' --json`;

        const response = await fetch(
          `${SANDBOX_MANAGER_URL}/sandbox/${encodeURIComponent(projectId)}/exec`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command, timeout: 10_000 }),
            signal: AbortSignal.timeout(15_000),
          }
        );

        if (!response.ok) {
          logger.warn(
            { status: response.status, pattern },
            "ast-grep sandbox exec failed"
          );
          continue;
        }

        const execResult = (await response.json()) as {
          exitCode: number;
          stdout: string;
          stderr: string;
        };

        if (execResult.exitCode !== 0) {
          logger.debug(
            { pattern, stderr: execResult.stderr.slice(0, 200) },
            "ast-grep pattern returned non-zero exit"
          );
          continue;
        }

        const matches = JSON.parse(execResult.stdout) as Array<{
          file: string;
          range: {
            start: { line: number; column: number };
            end: { line: number; column: number };
          };
          text: string;
          metaVariables?: Record<string, { text: string }>;
        }>;

        for (const match of matches) {
          allResults.push({
            id: `ast-grep:${match.file}:${match.range.start.line}`,
            filePath: match.file,
            content: match.text,
            score: 1.0,
            startLine: match.range.start.line,
            endLine: match.range.end.line,
            metadata: match.metaVariables
              ? { metaVariables: match.metaVariables }
              : undefined,
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn({ error: msg, pattern }, "ast-grep pattern search failed");
      }
    }

    // Assign decaying scores by position so RRF can rank them
    const scored = allResults.slice(0, maxResults).map((result, idx) => ({
      ...result,
      score: 1.0 - idx * 0.02,
    }));

    return {
      latencyMs: Date.now() - start,
      methodResult: {
        method: "ast-grep",
        results: scored,
      },
    };
  }

  private async rerankWithVoyage(
    query: string,
    documents: RankedDocument[],
    topK: number
  ): Promise<RankedDocument[]> {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      logger.debug("VOYAGE_API_KEY not set, skipping reranking");
      return documents;
    }

    try {
      const docTexts = documents.map(
        (d) => `${d.filePath}\n${d.content.slice(0, 1000)}`
      );

      const response = await fetch(`${VOYAGE_API_BASE}/rerank`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "rerank-2.5",
          query,
          documents: docTexts,
          top_k: topK,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Voyage rerank failed, using RRF order"
        );
        return documents;
      }

      const data = (await response.json()) as {
        data: Array<{ index: number; relevance_score: number }>;
      };

      return data.data.map((item) => {
        const doc = documents[item.index] as RankedDocument;
        return {
          ...doc,
          score: item.relevance_score,
          methodScores: {
            ...doc.methodScores,
            rerank: item.relevance_score,
          },
        };
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Voyage reranking failed, using RRF order");
      return documents;
    }
  }
}
