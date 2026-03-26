/**
 * Codebase Digital Twin — A complete, queryable model of the entire codebase.
 *
 * Combines knowledge graph, vector store, runtime metrics, and git history
 * into a unified query interface that agents use for impact analysis,
 * architectural understanding, and change prediction.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:digital-twin");

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TwinQuery {
  maxResults?: number;
  projectId: string;
  query: string;
  queryType:
    | "call_graph"
    | "impact_analysis"
    | "architecture"
    | "runtime"
    | "change_history"
    | "natural_language";
}

export interface TwinResult {
  answer: string;
  confidence: number;
  queryTimeMs: number;
  sources: TwinSource[];
}

export interface TwinSource {
  content?: string;
  filePath?: string;
  relevance: number;
  type: "graph" | "semantic" | "runtime" | "git";
}

export interface ArchitectureView {
  couplingScore: number;
  entryPoints: string[];
  layers: Array<{
    name: string;
    files: string[];
    dependencies: string[];
  }>;
  moduleCount: number;
}

export interface RuntimeSnapshot {
  endpoints: Array<{
    path: string;
    method: string;
    avgLatencyMs: number;
    errorRate: number;
    p95LatencyMs: number;
  }>;
  errorHotspots: Array<{
    filePath: string;
    errorCount: number;
    lastError: string;
  }>;
  testCoverage: Record<string, number>;
}

export interface ChangeModel {
  churnFiles: Array<{
    filePath: string;
    changeCount: number;
    lastChanged: string;
    authors: string[];
  }>;
  coupledFiles: Array<{
    fileA: string;
    fileB: string;
    coChangeCount: number;
    confidence: number;
  }>;
  techDebtScore: Record<string, number>;
}

export interface PredictedImpact {
  affectedFiles: string[];
  affectedTests: string[];
  breakingRisk: "low" | "medium" | "high";
  filePath: string;
  reason: string;
}

// ─── DigitalTwin ───────────────────────────────────────────────────────────────

export class DigitalTwin {
  private readonly projectBrainUrl: string;

  constructor(projectBrainUrl?: string) {
    this.projectBrainUrl =
      projectBrainUrl ??
      process.env.PROJECT_BRAIN_URL ??
      "http://localhost:4003";
  }

  /**
   * Query the digital twin with natural language or structured queries.
   */
  async query(twinQuery: TwinQuery): Promise<TwinResult> {
    const start = Date.now();
    const sources: TwinSource[] = [];
    let answer = "";

    try {
      switch (twinQuery.queryType) {
        case "call_graph": {
          const graphResult = await this.queryGraph(
            twinQuery.projectId,
            twinQuery.query
          );
          sources.push(...graphResult.sources);
          answer = graphResult.answer;
          break;
        }

        case "impact_analysis": {
          const impact = await this.predictImpact(
            twinQuery.projectId,
            twinQuery.query
          );
          answer = formatImpactAnswer(impact);
          sources.push({
            type: "graph",
            relevance: 1,
            content: JSON.stringify(impact, null, 2),
          });
          break;
        }

        case "architecture": {
          const arch = await this.getArchitectureView(twinQuery.projectId);
          answer = formatArchitectureAnswer(arch);
          sources.push({
            type: "graph",
            relevance: 1,
            content: JSON.stringify(arch, null, 2),
          });
          break;
        }

        case "change_history": {
          const changes = await this.getChangeModel(twinQuery.projectId);
          answer = formatChangeAnswer(changes, twinQuery.query);
          sources.push({
            type: "git",
            relevance: 1,
            content: JSON.stringify(changes, null, 2),
          });
          break;
        }

        case "runtime": {
          const runtime = await this.getRuntimeSnapshot(twinQuery.projectId);
          answer = formatRuntimeAnswer(runtime);
          sources.push({
            type: "runtime",
            relevance: 1,
            content: JSON.stringify(runtime, null, 2),
          });
          break;
        }
        default: {
          // Combine graph + semantic search
          const [graphResult, semanticResult] = await Promise.allSettled([
            this.queryGraph(twinQuery.projectId, twinQuery.query),
            this.querySemantic(twinQuery.projectId, twinQuery.query),
          ]);

          if (
            graphResult.status === "fulfilled" &&
            graphResult.value.sources.length > 0
          ) {
            sources.push(...graphResult.value.sources);
            answer += graphResult.value.answer;
          }

          if (
            semanticResult.status === "fulfilled" &&
            semanticResult.value.sources.length > 0
          ) {
            sources.push(...semanticResult.value.sources);
            if (answer) {
              answer += "\n\n";
            }
            answer += semanticResult.value.answer;
          }

          if (!answer) {
            answer = "No relevant information found in the codebase.";
          }
          break;
        }
      }
    } catch (error) {
      logger.error(
        { error: String(error), query: twinQuery.query },
        "Digital twin query failed"
      );
      answer = `Query failed: ${String(error)}`;
    }

    const queryTimeMs = Date.now() - start;
    const confidence =
      sources.length > 0 ? Math.min(1, sources.length * 0.2) : 0;

    return { answer, sources, confidence, queryTimeMs };
  }

  /**
   * Predict the impact of changing a file.
   */
  async predictImpact(
    projectId: string,
    filePath: string
  ): Promise<PredictedImpact> {
    try {
      const response = await fetch(
        `${this.projectBrainUrl}/graph/related-context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, filePath, maxHops: 3 }),
        }
      );

      if (response.ok) {
        const data = (await response.json()) as {
          dependents?: Array<{ filePath: string; edgeType: string }>;
          dependencies?: Array<{ filePath: string; edgeType: string }>;
        };

        const affectedFiles = (data.dependents ?? []).map((d) => d.filePath);
        const affectedTests = affectedFiles.filter(
          (f) =>
            f.includes(".test.") ||
            f.includes(".spec.") ||
            f.includes("__tests__")
        );

        let breakingRisk: "low" | "medium" | "high";
        if (affectedFiles.length > 20) {
          breakingRisk = "high";
        } else if (affectedFiles.length > 5) {
          breakingRisk = "medium";
        } else {
          breakingRisk = "low";
        }

        return {
          filePath,
          affectedFiles,
          affectedTests,
          breakingRisk,
          reason: `${affectedFiles.length} dependent files found via knowledge graph traversal`,
        };
      }
    } catch (error) {
      logger.warn(
        { projectId, filePath, error: String(error) },
        "Impact prediction failed"
      );
    }

    return {
      filePath,
      affectedFiles: [],
      affectedTests: [],
      breakingRisk: "low",
      reason: "Could not determine impact (graph unavailable)",
    };
  }

  /**
   * Get architecture view of the project.
   */
  async getArchitectureView(projectId: string): Promise<ArchitectureView> {
    try {
      const response = await fetch(
        `${this.projectBrainUrl}/graph/file-deps/${projectId}`
      );

      if (response.ok) {
        const data = (await response.json()) as {
          nodes?: Array<{
            filePath: string;
            nodeType: string;
            metadata?: Record<string, unknown>;
          }>;
          edges?: Array<{ source: string; target: string; edgeType: string }>;
        };

        const nodes = data.nodes ?? [];
        const edges = data.edges ?? [];

        // Group files into layers by directory
        const layerMap = new Map<string, string[]>();
        for (const node of nodes) {
          const parts = node.filePath.split("/");
          const layerName =
            parts.length > 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? "root");
          const files = layerMap.get(layerName) ?? [];
          files.push(node.filePath);
          layerMap.set(layerName, files);
        }

        const layers = [...layerMap.entries()].map(([name, files]) => ({
          name,
          files,
          dependencies: edges
            .filter((e) => files.includes(e.source))
            .map((e) => e.target)
            .filter((t) => !files.includes(t)),
        }));

        const entryPoints = nodes
          .filter(
            (n) =>
              n.filePath.includes("index.ts") ||
              n.filePath.includes("main.ts") ||
              n.filePath.includes("app.ts")
          )
          .map((n) => n.filePath);

        return {
          layers,
          entryPoints,
          moduleCount: layerMap.size,
          couplingScore: edges.length / Math.max(1, nodes.length),
        };
      }
    } catch (error) {
      logger.warn(
        { projectId, error: String(error) },
        "Architecture view generation failed"
      );
    }

    return {
      layers: [],
      entryPoints: [],
      moduleCount: 0,
      couplingScore: 0,
    };
  }

  /**
   * Get runtime snapshot for the project (endpoints, errors, coverage).
   */
  async getRuntimeSnapshot(projectId: string): Promise<RuntimeSnapshot> {
    try {
      const response = await fetch(
        `${this.projectBrainUrl}/runtime/snapshot/${projectId}`
      );

      if (response.ok) {
        return (await response.json()) as RuntimeSnapshot;
      }
    } catch (error) {
      logger.warn(
        { projectId, error: String(error) },
        "Runtime snapshot fetch failed"
      );
    }

    return {
      endpoints: [],
      errorHotspots: [],
      testCoverage: {},
    };
  }

  /**
   * Get change model from git history.
   */
  getChangeModel(_projectId: string): Promise<ChangeModel> {
    // Change model would typically be built from git log analysis.
    // For now, return structure that can be populated by indexing jobs.
    return Promise.resolve({
      churnFiles: [],
      coupledFiles: [],
      techDebtScore: {},
    });
  }

  // ─── Internal Query Methods ──────────────────────────────────────────────────

  private async queryGraph(
    projectId: string,
    query: string
  ): Promise<{ answer: string; sources: TwinSource[] }> {
    try {
      const response = await fetch(`${this.projectBrainUrl}/graph/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          nodes?: Array<{
            name: string;
            nodeType: string;
            filePath: string;
          }>;
          edges?: Array<{
            source: string;
            target: string;
            edgeType: string;
          }>;
        };

        const nodes = data.nodes ?? [];
        const edges = data.edges ?? [];

        if (nodes.length === 0) {
          return { answer: "", sources: [] };
        }

        const sources: TwinSource[] = nodes.slice(0, 10).map((n) => ({
          type: "graph" as const,
          filePath: n.filePath,
          content: `${n.nodeType}: ${n.name}`,
          relevance: 0.8,
        }));

        const answer = [
          `Found ${nodes.length} related entities and ${edges.length} relationships:`,
          ...nodes
            .slice(0, 10)
            .map((n) => `- ${n.nodeType} "${n.name}" in ${n.filePath}`),
        ].join("\n");

        return { answer, sources };
      }
    } catch (error) {
      logger.warn({ projectId, error: String(error) }, "Graph query failed");
    }

    return { answer: "", sources: [] };
  }

  private async querySemantic(
    projectId: string,
    query: string
  ): Promise<{ answer: string; sources: TwinSource[] }> {
    try {
      const response = await fetch(`${this.projectBrainUrl}/search/semantic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query, limit: 10 }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          results: Array<{
            filePath: string;
            content: string;
            score: number;
          }>;
        };

        const sources: TwinSource[] = data.results.map((r) => ({
          type: "semantic" as const,
          filePath: r.filePath,
          content: r.content.slice(0, 200),
          relevance: r.score,
        }));

        const answer =
          data.results.length > 0
            ? [
                `Found ${data.results.length} relevant code sections:`,
                ...data.results
                  .slice(0, 5)
                  .map(
                    (r) =>
                      `- ${r.filePath} (${(r.score * 100).toFixed(0)}% relevant)`
                  ),
              ].join("\n")
            : "";

        return { answer, sources };
      }
    } catch (error) {
      logger.warn({ projectId, error: String(error) }, "Semantic query failed");
    }

    return { answer: "", sources: [] };
  }
}

// ─── Formatting Helpers ────────────────────────────────────────────────────────

function formatImpactAnswer(impact: PredictedImpact): string {
  const lines = [
    `Impact analysis for ${impact.filePath}:`,
    `- Risk level: ${impact.breakingRisk}`,
    `- ${impact.affectedFiles.length} affected files`,
    `- ${impact.affectedTests.length} affected tests`,
    `- Reason: ${impact.reason}`,
  ];

  if (impact.affectedFiles.length > 0) {
    lines.push(
      "",
      "Affected files:",
      ...impact.affectedFiles.slice(0, 15).map((f) => `  - ${f}`)
    );
  }

  return lines.join("\n");
}

function formatArchitectureAnswer(arch: ArchitectureView): string {
  const lines = [
    "Architecture overview:",
    `- ${arch.moduleCount} modules`,
    `- ${arch.entryPoints.length} entry points`,
    `- Coupling score: ${arch.couplingScore.toFixed(2)}`,
  ];

  if (arch.layers.length > 0) {
    lines.push("", "Layers:");
    for (const layer of arch.layers.slice(0, 10)) {
      lines.push(
        `  - ${layer.name}: ${layer.files.length} files, ${layer.dependencies.length} external deps`
      );
    }
  }

  return lines.join("\n");
}

function formatRuntimeAnswer(runtime: RuntimeSnapshot): string {
  const lines = [
    "Runtime snapshot:",
    `- ${runtime.endpoints.length} endpoints tracked`,
    `- ${runtime.errorHotspots.length} error hotspots`,
    `- ${Object.keys(runtime.testCoverage).length} files with test coverage data`,
  ];

  if (runtime.errorHotspots.length > 0) {
    lines.push("", "Error hotspots:");
    for (const hotspot of runtime.errorHotspots.slice(0, 5)) {
      lines.push(
        `  - ${hotspot.filePath}: ${hotspot.errorCount} errors (last: ${hotspot.lastError})`
      );
    }
  }

  if (runtime.endpoints.length > 0) {
    lines.push("", "Slowest endpoints:");
    const slowest = [...runtime.endpoints]
      .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
      .slice(0, 5);
    for (const ep of slowest) {
      lines.push(
        `  - ${ep.method} ${ep.path}: ${ep.avgLatencyMs.toFixed(0)}ms avg, ${(ep.errorRate * 100).toFixed(1)}% errors`
      );
    }
  }

  return lines.join("\n");
}

function formatChangeAnswer(changes: ChangeModel, query: string): string {
  const lines = [`Change analysis for "${query}":`];

  if (changes.churnFiles.length > 0) {
    lines.push(
      "",
      "High-churn files:",
      ...changes.churnFiles
        .slice(0, 10)
        .map((f) => `  - ${f.filePath}: ${f.changeCount} changes`)
    );
  }

  if (changes.coupledFiles.length > 0) {
    lines.push(
      "",
      "Coupled file pairs:",
      ...changes.coupledFiles
        .slice(0, 5)
        .map(
          (c) => `  - ${c.fileA} <-> ${c.fileB} (${c.coChangeCount} co-changes)`
        )
    );
  }

  return lines.join("\n");
}
