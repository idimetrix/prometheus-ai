import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:memgraph");

const MEMGRAPH_URL = process.env.MEMGRAPH_URL ?? "bolt://localhost:7687";
const TRAILING_SLASH_RE = /\/$/;

/**
 * Derive the HTTP endpoint from the Memgraph URL.
 * Converts bolt:// to http:// on the same host, default HTTP port 7444.
 */
function getHttpEndpoint(): string {
  try {
    const url = new URL(MEMGRAPH_URL.replace("bolt://", "http://"));
    url.port = process.env.MEMGRAPH_HTTP_PORT ?? "7444";
    return url.toString().replace(TRAILING_SLASH_RE, "");
  } catch {
    return "http://localhost:7444";
  }
}

export interface TraversalResult {
  depth: number;
  node: {
    id: string;
    labels: string[];
    properties: Record<string, unknown>;
  };
  path: string[];
}

interface MemgraphQueryResponse {
  errors?: Array<{ code: string; message: string }>;
  results?: Array<{
    columns: string[];
    data: Array<{
      row: unknown[];
      meta?: unknown[];
    }>;
  }>;
}

/**
 * MemgraphClient provides sub-millisecond graph traversals via Memgraph's HTTP API.
 * Sends Cypher queries over HTTP using fetch().
 */
export class MemgraphClient {
  private readonly httpEndpoint: string;

  constructor() {
    this.httpEndpoint = getHttpEndpoint();
    logger.info(
      { memgraphUrl: MEMGRAPH_URL, httpEndpoint: this.httpEndpoint },
      "MemgraphClient initialized"
    );
  }

  /**
   * Upsert a node with given labels and properties.
   * Uses MERGE to avoid duplicates.
   */
  async upsertNode(
    id: string,
    labels: string[],
    properties: Record<string, unknown>
  ): Promise<void> {
    const labelStr = labels.map((l) => `:${l}`).join("");
    const cypher = `MERGE (n${labelStr} {id: $id}) SET n += $props`;

    await this.executeCypher(cypher, { id, props: properties });

    logger.debug({ id, labels }, "Node upserted");
  }

  /**
   * Upsert an edge between two nodes.
   */
  async upsertEdge(
    sourceId: string,
    targetId: string,
    type: string,
    properties?: Record<string, unknown>
  ): Promise<void> {
    const propsClause =
      properties && Object.keys(properties).length > 0
        ? " SET r += $props"
        : "";
    const cypher = `MATCH (a {id: $sourceId}), (b {id: $targetId}) MERGE (a)-[r:${type}]->(b)${propsClause}`;

    await this.executeCypher(cypher, {
      sourceId,
      targetId,
      props: properties ?? {},
    });

    logger.debug({ sourceId, targetId, type }, "Edge upserted");
  }

  /**
   * Traverse the graph from a starting node up to a given depth.
   * Optionally filter by edge types.
   */
  async traverse(
    startNodeId: string,
    depth: number,
    edgeTypes?: string[]
  ): Promise<TraversalResult[]> {
    const edgeFilter =
      edgeTypes && edgeTypes.length > 0 ? `:${edgeTypes.join("|")}` : "";
    const cypher = `
      MATCH path = (start {id: $startNodeId})-[${edgeFilter}*1..${depth}]->(end)
      RETURN end.id AS id, labels(end) AS labels, properties(end) AS properties,
             length(path) AS depth,
             [n IN nodes(path) | n.id] AS nodePath
    `;

    const response = await this.executeCypher(cypher, { startNodeId });

    return this.parseTraversalResults(response);
  }

  /**
   * Find the shortest path between two nodes.
   * Returns an array of node IDs along the path.
   */
  async shortestPath(fromId: string, toId: string): Promise<string[]> {
    const cypher = `
      MATCH path = shortestPath((a {id: $fromId})-[*]-(b {id: $toId}))
      RETURN [n IN nodes(path) | n.id] AS nodePath
    `;

    const response = await this.executeCypher(cypher, { fromId, toId });

    if (
      response.results &&
      response.results.length > 0 &&
      response.results[0]?.data &&
      response.results[0].data.length > 0
    ) {
      const firstRow = response.results[0].data[0]?.row;
      if (firstRow && Array.isArray(firstRow[0])) {
        return firstRow[0] as string[];
      }
    }

    return [];
  }

  /**
   * Close the client connection.
   */
  async close(): Promise<void> {
    await Promise.resolve();
    logger.info("MemgraphClient closed");
  }

  /**
   * Execute a Cypher query against Memgraph's HTTP API.
   */
  private async executeCypher(
    query: string,
    parameters: Record<string, unknown> = {}
  ): Promise<MemgraphQueryResponse> {
    try {
      const response = await fetch(`${this.httpEndpoint}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statements: [{ statement: query, parameters }],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Memgraph HTTP query failed (${response.status}): ${text}`
        );
      }

      return (await response.json()) as MemgraphQueryResponse;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Memgraph HTTP query failed")
      ) {
        throw error;
      }

      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          endpoint: this.httpEndpoint,
        },
        "Memgraph connection failed"
      );

      // Return empty result when Memgraph is not available
      return { results: [], errors: [] };
    }
  }

  /**
   * Parse traversal results from the Memgraph HTTP response.
   */
  private parseTraversalResults(
    response: MemgraphQueryResponse
  ): TraversalResult[] {
    const results: TraversalResult[] = [];

    if (!response.results || response.results.length === 0) {
      return results;
    }

    const firstResult = response.results[0];
    if (!firstResult?.data) {
      return results;
    }

    for (const row of firstResult.data) {
      if (!row.row || row.row.length < 5) {
        continue;
      }

      const [id, labels, properties, depth, nodePath] = row.row;

      results.push({
        node: {
          id: String(id ?? ""),
          labels: Array.isArray(labels) ? (labels as string[]) : [],
          properties:
            typeof properties === "object" && properties !== null
              ? (properties as Record<string, unknown>)
              : {},
        },
        depth: typeof depth === "number" ? depth : 0,
        path: Array.isArray(nodePath) ? (nodePath as string[]) : [],
      });
    }

    return results;
  }
}
