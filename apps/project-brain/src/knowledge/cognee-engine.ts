import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:cognee-engine");

const COGNEE_API_URL =
  process.env.COGNEE_API_URL ?? "http://localhost:8000/api";

export interface CodeRelationship {
  source: string;
  target: string;
  type: "imports" | "calls" | "extends" | "implements" | "uses";
  weight: number;
}

export interface GraphNode {
  id: string;
  label: string;
  metadata: Record<string, unknown>;
  type: string;
}

/**
 * CogneeEngine extracts relationships from code using the Cognee API.
 * Falls back to simple import/export analysis when the API is unavailable.
 */
export class CogneeEngine {
  private apiAvailable: boolean | null = null;

  /**
   * Extract relationships from a source file's content and symbol table.
   */
  async extractRelationships(
    filePath: string,
    content: string,
    symbolTable: unknown
  ): Promise<CodeRelationship[]> {
    const available = await this.checkApiAvailability();

    if (available) {
      return this.extractViaCognee(filePath, content, symbolTable);
    }

    logger.debug(
      { filePath },
      "Cognee API unavailable, using fallback import analysis"
    );
    return this.extractViaImportAnalysis(filePath, content);
  }

  /**
   * Build a graph in Cognee from extracted relationships.
   */
  async buildGraph(
    projectId: string,
    relationships: CodeRelationship[]
  ): Promise<void> {
    const available = await this.checkApiAvailability();

    if (!available) {
      logger.warn(
        { projectId, relationshipCount: relationships.length },
        "Cognee API unavailable, skipping graph build"
      );
      return;
    }

    try {
      const response = await fetch(`${COGNEE_API_URL}/graph/build`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({ projectId, relationships }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Cognee graph build failed (${response.status}): ${text}`
        );
      }

      logger.info(
        { projectId, relationshipCount: relationships.length },
        "Graph built successfully via Cognee"
      );
    } catch (error) {
      logger.error(
        {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to build graph via Cognee"
      );
    }
  }

  /**
   * Query related nodes from a starting node, up to a given depth.
   */
  async queryRelated(nodeId: string, depth = 2): Promise<GraphNode[]> {
    const available = await this.checkApiAvailability();

    if (!available) {
      logger.warn(
        { nodeId, depth },
        "Cognee API unavailable, returning empty results"
      );
      return [];
    }

    try {
      const response = await fetch(
        `${COGNEE_API_URL}/graph/query?nodeId=${encodeURIComponent(nodeId)}&depth=${depth}`
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Cognee query failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as { nodes: GraphNode[] };
      return data.nodes;
    } catch (error) {
      logger.error(
        {
          nodeId,
          depth,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to query related nodes from Cognee"
      );
      return [];
    }
  }

  /**
   * Extract relationships via the Cognee API.
   */
  private async extractViaCognee(
    filePath: string,
    content: string,
    symbolTable: unknown
  ): Promise<CodeRelationship[]> {
    try {
      const response = await fetch(`${COGNEE_API_URL}/extract/relationships`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({ filePath, content, symbolTable }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Cognee extraction failed (${response.status}): ${text}`
        );
      }

      const data = (await response.json()) as {
        relationships: CodeRelationship[];
      };
      return data.relationships;
    } catch (error) {
      logger.warn(
        {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        },
        "Cognee extraction failed, falling back to import analysis"
      );
      return this.extractViaImportAnalysis(filePath, content);
    }
  }

  /**
   * Fallback: extract relationships by parsing import/export statements.
   */
  private extractViaImportAnalysis(
    filePath: string,
    content: string
  ): CodeRelationship[] {
    const relationships: CodeRelationship[] = [];

    // Match static import statements
    const importRegex =
      /import\s+(?:(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?['"]([^'"]+)['"]/g;

    let match: RegExpExecArray | null = importRegex.exec(content);
    while (match !== null) {
      const importPath = match[1];
      if (importPath) {
        relationships.push({
          source: filePath,
          target: importPath,
          type: "imports",
          weight: 1,
        });
      }
      match = importRegex.exec(content);
    }

    // Match extends clauses
    const extendsRegex = /class\s+\w+\s+extends\s+([\w.]+)/g;
    let extendsMatch: RegExpExecArray | null = extendsRegex.exec(content);
    while (extendsMatch !== null) {
      const baseClass = extendsMatch[1];
      if (baseClass) {
        relationships.push({
          source: filePath,
          target: baseClass,
          type: "extends",
          weight: 0.9,
        });
      }
      extendsMatch = extendsRegex.exec(content);
    }

    // Match implements clauses
    const implementsRegex =
      /class\s+\w+(?:\s+extends\s+\w+)?\s+implements\s+([\w,\s]+)/g;
    let implMatch: RegExpExecArray | null = implementsRegex.exec(content);
    while (implMatch !== null) {
      const interfaces = implMatch[1];
      if (interfaces) {
        for (const iface of interfaces.split(",")) {
          const trimmed = iface.trim();
          if (trimmed) {
            relationships.push({
              source: filePath,
              target: trimmed,
              type: "implements",
              weight: 0.8,
            });
          }
        }
      }
      implMatch = implementsRegex.exec(content);
    }

    // Match dynamic imports / require calls
    const dynamicImportRegex =
      /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let dynMatch: RegExpExecArray | null = dynamicImportRegex.exec(content);
    while (dynMatch !== null) {
      const importPath = dynMatch[1];
      if (importPath) {
        relationships.push({
          source: filePath,
          target: importPath,
          type: "imports",
          weight: 0.7,
        });
      }
      dynMatch = dynamicImportRegex.exec(content);
    }

    logger.debug(
      { filePath, relationshipCount: relationships.length },
      "Extracted relationships via import analysis"
    );

    return relationships;
  }

  /**
   * Check whether the Cognee API is reachable (cached after first check).
   */
  private async checkApiAvailability(): Promise<boolean> {
    if (this.apiAvailable !== null) {
      return this.apiAvailable;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${COGNEE_API_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      this.apiAvailable = response.ok;
    } catch {
      this.apiAvailable = false;
    }

    if (!this.apiAvailable) {
      logger.info("Cognee API not available, will use fallback analysis");
    }

    return this.apiAvailable;
  }
}
