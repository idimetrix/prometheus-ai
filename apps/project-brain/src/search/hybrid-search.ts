/**
 * Hybrid Search Orchestrator with adaptive query classification.
 *
 * Runs Zoekt, pgvector, and ast-grep in parallel.
 * Enhanced with query classification, adaptive weights, quality metrics.
 * Target: p99 < 500ms.
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

export type HybridQueryType = "keyword" | "semantic" | "structural" | "mixed";

export interface HybridSearchOptions {
  astPatterns?: string[];
  maxPerMethod?: number;
  methodWeights?: Record<string, number>;
  rerank?: boolean;
  topK?: number;
  trackMetrics?: boolean;
}

export interface HybridSearchResult {
  latencyMs: number;
  methodLatencies: Record<string, number>;
  metrics?: HybridSearchMetrics;
  results: RankedDocument[];
  totalCandidates: number;
}

export interface HybridSearchMetrics {
  meanReciprocalRank: number;
  methodResultCounts: Record<string, number>;
  methodWeights: Record<string, number>;
  overlapCount: number;
  queryType: HybridQueryType;
  rerankerApplied: boolean;
  rerankerLatencyMs: number;
  totalLatencyMs: number;
}

interface ZoektSearchResponse {
  Result?: {
    Files?: Array<{
      FileName: string;
      LineMatches?: Array<{ LineNumber: number; Line: string }>;
    }>;
  };
}

const KEYWORD_QUERY_RE =
  /^[A-Z][\w.]+$|^["']|import\s|from\s|require\(|\.ts$|\.js$|\.py$|^\/[\w/]+\./i;
const STRUCTURAL_QUERY_RE =
  /\$\w+|\bpattern\b|\bast\b|\bgrep\b|\bfind\s+all\b|\bfunctions?\s+(?:that|returning|with)\b/i;
const SEMANTIC_QUERY_RE =
  /\bhow\b|\bwhat\b|\bwhy\b|\bexplain\b|\bdescribe\b|\bunderstand|\bconcept|\bwork|\bpurpose/i;
const QUERY_WORD_SPLIT_RE = /\s+/;

const QUERY_TYPE_WEIGHTS: Record<HybridQueryType, Record<string, number>> = {
  keyword: { semantic: 0.5, zoekt: 1.0, "ast-grep": 0.3 },
  semantic: { semantic: 1.0, zoekt: 0.5, "ast-grep": 0.3 },
  structural: { semantic: 0.4, zoekt: 0.6, "ast-grep": 1.0 },
  mixed: { semantic: 0.85, zoekt: 0.8, "ast-grep": 0.6 },
};

export class HybridSearch {
  private readonly semantic: SemanticLayer;

  constructor(semantic: SemanticLayer) {
    this.semantic = semantic;
  }

  classifyQuery(query: string): HybridQueryType {
    const isKeyword = KEYWORD_QUERY_RE.test(query);
    const isStructural = STRUCTURAL_QUERY_RE.test(query);
    const isSemantic = SEMANTIC_QUERY_RE.test(query);
    const signalCount =
      (isKeyword ? 1 : 0) + (isStructural ? 1 : 0) + (isSemantic ? 1 : 0);
    if (signalCount >= 2) {
      return "mixed";
    }
    if (isKeyword) {
      return "keyword";
    }
    if (isStructural) {
      return "structural";
    }
    if (isSemantic) {
      return "semantic";
    }
    const wordCount = query.trim().split(QUERY_WORD_SPLIT_RE).length;
    if (wordCount <= 2) {
      return "keyword";
    }
    if (wordCount >= 5) {
      return "semantic";
    }
    return "mixed";
  }

  async search(
    projectId: string,
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult> {
    const startTime = Date.now();
    const maxPerMethod = options.maxPerMethod ?? 30;
    const topK = options.topK ?? 20;
    const trackMetrics = options.trackMetrics ?? false;
    const methodLatencies: Record<string, number> = {};

    const queryType = this.classifyQuery(query);
    const adaptiveWeights =
      options.methodWeights ?? QUERY_TYPE_WEIGHTS[queryType];
    const adaptiveRanker = new RRFRanker({
      k: 60,
      maxResults: 40,
      methodWeights: adaptiveWeights,
    });

    const [semanticResult, zoektResult, astResult] = await Promise.allSettled([
      this.searchSemantic(projectId, query, maxPerMethod),
      this.searchZoekt(projectId, query, maxPerMethod),
      this.searchAstGrep(projectId, options.astPatterns ?? [], maxPerMethod),
    ]);

    const methodResults: SearchMethodResult[] = [];
    const methodResultCounts: Record<string, number> = {};

    if (semanticResult.status === "fulfilled") {
      methodResults.push(semanticResult.value.methodResult);
      methodLatencies.semantic = semanticResult.value.latencyMs;
      methodResultCounts.semantic =
        semanticResult.value.methodResult.results.length;
    } else {
      logger.warn(
        { error: String(semanticResult.reason) },
        "Semantic search failed"
      );
      methodLatencies.semantic = -1;
      methodResultCounts.semantic = 0;
    }

    if (zoektResult.status === "fulfilled") {
      methodResults.push(zoektResult.value.methodResult);
      methodLatencies.zoekt = zoektResult.value.latencyMs;
      methodResultCounts.zoekt = zoektResult.value.methodResult.results.length;
    } else {
      logger.warn({ error: String(zoektResult.reason) }, "Zoekt search failed");
      methodLatencies.zoekt = -1;
      methodResultCounts.zoekt = 0;
    }

    if (
      astResult.status === "fulfilled" &&
      astResult.value.methodResult.results.length > 0
    ) {
      methodResults.push(astResult.value.methodResult);
      methodLatencies["ast-grep"] = astResult.value.latencyMs;
      methodResultCounts["ast-grep"] =
        astResult.value.methodResult.results.length;
    } else if (astResult.status === "rejected") {
      logger.warn(
        { error: String(astResult.reason) },
        "ast-grep search failed"
      );
      methodLatencies["ast-grep"] = -1;
      methodResultCounts["ast-grep"] = 0;
    } else {
      methodResultCounts["ast-grep"] = 0;
    }

    let fusedResults = adaptiveRanker.fuse(methodResults);
    const totalCandidates = methodResults.reduce(
      (sum, m) => sum + m.results.length,
      0
    );

    let rerankerApplied = false;
    let rerankerLatencyMs = 0;
    if (options.rerank !== false && fusedResults.length > 0) {
      const rerankStart = Date.now();
      const reranked = await this.rerankWithVoyage(query, fusedResults, topK);
      rerankerLatencyMs = Date.now() - rerankStart;
      methodLatencies.rerank = rerankerLatencyMs;
      if (reranked !== fusedResults) {
        fusedResults = reranked;
        rerankerApplied = true;
      }
    }

    const results = fusedResults.slice(0, topK);
    const latencyMs = Date.now() - startTime;
    const overlapCount = this.countMethodOverlap(methodResults);
    const mrr = this.calculateMRR(methodResults, results);

    logger.info(
      {
        projectId,
        query: query.slice(0, 80),
        queryType,
        totalCandidates,
        returnedCount: results.length,
        rerankerApplied,
        latencyMs,
      },
      "Hybrid search completed"
    );

    const metrics: HybridSearchMetrics | undefined = trackMetrics
      ? {
          queryType,
          methodWeights: adaptiveWeights,
          methodResultCounts,
          overlapCount,
          meanReciprocalRank: mrr,
          rerankerApplied,
          rerankerLatencyMs,
          totalLatencyMs: latencyMs,
        }
      : undefined;

    return { results, totalCandidates, latencyMs, methodLatencies, metrics };
  }

  private countMethodOverlap(methodResults: SearchMethodResult[]): number {
    const idCounts = new Map<string, number>();
    for (const { results } of methodResults) {
      const seenInMethod = new Set<string>();
      for (const r of results) {
        const key = `${r.filePath}:${r.content.slice(0, 50)}`;
        if (!seenInMethod.has(key)) {
          seenInMethod.add(key);
          idCounts.set(key, (idCounts.get(key) ?? 0) + 1);
        }
      }
    }
    let overlap = 0;
    for (const count of idCounts.values()) {
      if (count > 1) {
        overlap++;
      }
    }
    return overlap;
  }

  private calculateMRR(
    methodResults: SearchMethodResult[],
    topResults: RankedDocument[]
  ): number {
    if (topResults.length === 0 || methodResults.length === 0) {
      return 0;
    }
    const topResult = topResults[0];
    if (!topResult) {
      return 0;
    }
    const topKey = `${topResult.filePath}:${topResult.content.slice(0, 50)}`;
    let rrSum = 0;
    let methodCount = 0;
    for (const { results } of methodResults) {
      methodCount++;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && `${r.filePath}:${r.content.slice(0, 50)}` === topKey) {
          rrSum += 1 / (i + 1);
          break;
        }
      }
    }
    return methodCount > 0 ? rrSum / methodCount : 0;
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
    const results = files.flatMap((file) =>
      (file.LineMatches ?? []).map((match, idx) => ({
        id: `zoekt:${file.FileName}:${match.LineNumber}`,
        filePath: file.FileName,
        content: match.Line,
        score: 1.0 - idx * 0.02,
        startLine: match.LineNumber,
      }))
    );
    return {
      latencyMs: Date.now() - start,
      methodResult: { method: "zoekt", results: results.slice(0, maxResults) },
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
            "ast-grep non-zero exit"
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
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            pattern,
          },
          "ast-grep pattern search failed"
        );
      }
    }
    const scored = allResults
      .slice(0, maxResults)
      .map((result, idx) => ({ ...result, score: 1.0 - idx * 0.02 }));
    return {
      latencyMs: Date.now() - start,
      methodResult: { method: "ast-grep", results: scored },
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
          methodScores: { ...doc.methodScores, rerank: item.relevance_score },
        };
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Voyage reranking failed, using RRF order"
      );
      return documents;
    }
  }
}
