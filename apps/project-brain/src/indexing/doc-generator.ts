/**
 * Living Documentation Generator (P4.2).
 *
 * Generates API, component, database, and architecture documentation
 * by parsing source code with regex patterns to extract tRPC procedures,
 * React component prop types, and Drizzle table definitions.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:doc-generator");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

// ── Regex patterns (top-level for performance) ──

/** Matches tRPC procedure definitions: router.procedureName.query/mutation/subscription */
const TRPC_PROCEDURE_PATTERN =
  /(\w+):\s*(?:protectedProcedure|publicProcedure|procedure)\s*\.(?:input\s*\(([^)]*)\)\s*\.)?(?:output\s*\(([^)]*)\)\s*\.)?(query|mutation|subscription)\s*\(/g;

/** Matches tRPC router definitions: export const someRouter = router({...}) */
const TRPC_ROUTER_PATTERN =
  /export\s+const\s+(\w+Router)\s*=\s*(?:createTRPCRouter|router)\s*\(/g;

/** Matches React component prop interface/type definitions. */
const REACT_PROPS_PATTERN =
  /(?:interface|type)\s+(\w+Props)\s*(?:=\s*\{|extends[^{]*\{|\{)([\s\S]*?)^\}/gm;

/** Matches React component function declarations. */
const REACT_COMPONENT_PATTERN =
  /export\s+(?:default\s+)?(?:function|const)\s+(\w+)\s*(?::\s*React\.FC<(\w+)>)?\s*(?:\((?:\{[^}]*\}|\w+)\s*:\s*(\w+Props?)?\)|=)/g;

/** Matches Drizzle table definitions: export const tableName = pgTable("name", {...}) */
const DRIZZLE_TABLE_PATTERN =
  /export\s+const\s+(\w+)\s*=\s*pgTable\s*\(\s*["'](\w+)["']\s*,\s*\{([\s\S]*?)\}\s*\)/g;

/** Matches Drizzle column definitions within a table. */
const DRIZZLE_COLUMN_PATTERN =
  /(\w+):\s*(varchar|text|integer|bigint|boolean|timestamp|uuid|serial|jsonb|json|decimal|real|numeric|smallint|pgEnum)\s*\(([^)]*)\)/g;

/** Matches JSDoc comments preceding a declaration. */
const _JSDOC_PATTERN =
  /\/\*\*\s*([\s\S]*?)\s*\*\/\s*(?=export|const|function)/g;

/** Matches single-line prop type entries like `name: string;` or `name?: Type;` */
const PROP_ENTRY_PATTERN = /(\w+)(\?)?:\s*([^;]+);/g;

export interface GeneratedDoc {
  content: string;
  filePaths: string[];
  generatedAt: string;
  title: string;
  type: "api" | "component" | "database" | "architecture";
}

interface ExtractedProcedure {
  filePath: string;
  inputSchema: string;
  kind: "query" | "mutation" | "subscription";
  name: string;
  outputSchema: string;
  routerName: string;
}

interface ExtractedComponent {
  filePath: string;
  name: string;
  props: Array<{ name: string; type: string; optional: boolean }>;
}

interface ExtractedTable {
  columns: Array<{ name: string; type: string; args: string }>;
  filePath: string;
  tableName: string;
  variableName: string;
}

export class DocGenerator {
  private readonly projectBrainUrl: string;

  constructor(opts?: { projectBrainUrl?: string }) {
    this.projectBrainUrl = opts?.projectBrainUrl ?? PROJECT_BRAIN_URL;
  }

  /**
   * Generate API docs from tRPC router definitions.
   */
  async generateAPIDocs(
    projectId: string,
    routerFiles: string[]
  ): Promise<GeneratedDoc[]> {
    const docs: GeneratedDoc[] = [];
    const allProcedures: ExtractedProcedure[] = [];

    for (const filePath of routerFiles) {
      const content = await this.fetchFileContent(projectId, filePath);
      if (!content) {
        continue;
      }

      const procedures = this.extractProcedures(content, filePath);
      allProcedures.push(...procedures);
    }

    // Group procedures by router
    const routerGroups = new Map<string, ExtractedProcedure[]>();
    for (const proc of allProcedures) {
      const existing = routerGroups.get(proc.routerName) ?? [];
      existing.push(proc);
      routerGroups.set(proc.routerName, existing);
    }

    for (const [routerName, procedures] of routerGroups) {
      const lines: string[] = [
        `# ${routerName} API Reference`,
        "",
        `Router: \`${routerName}\``,
        "",
        "## Procedures",
        "",
      ];

      for (const proc of procedures) {
        lines.push(`### \`${proc.name}\` (${proc.kind})`);
        lines.push("");
        lines.push(`- **Type**: ${proc.kind}`);
        lines.push(`- **File**: \`${proc.filePath}\``);

        if (proc.inputSchema) {
          lines.push(`- **Input**: \`${proc.inputSchema}\``);
        }

        if (proc.outputSchema) {
          lines.push(`- **Output**: \`${proc.outputSchema}\``);
        }

        lines.push("");
      }

      const sourceFiles = [...new Set(procedures.map((p) => p.filePath))];

      docs.push({
        type: "api",
        title: `${routerName} API Reference`,
        content: lines.join("\n"),
        filePaths: sourceFiles,
        generatedAt: new Date().toISOString(),
      });
    }

    logger.info(
      {
        projectId,
        routerFiles: routerFiles.length,
        docsGenerated: docs.length,
        totalProcedures: allProcedures.length,
      },
      "Generated API documentation"
    );

    return docs;
  }

  /**
   * Generate component docs from React component prop types.
   */
  async generateComponentDocs(
    projectId: string,
    componentFiles: string[]
  ): Promise<GeneratedDoc[]> {
    const docs: GeneratedDoc[] = [];

    for (const filePath of componentFiles) {
      const content = await this.fetchFileContent(projectId, filePath);
      if (!content) {
        continue;
      }

      const components = this.extractComponents(content, filePath);

      for (const component of components) {
        const lines: string[] = [
          `# ${component.name}`,
          "",
          `**File**: \`${component.filePath}\``,
          "",
        ];

        if (component.props.length > 0) {
          lines.push("## Props");
          lines.push("");
          lines.push("| Prop | Type | Required |");
          lines.push("|------|------|----------|");

          for (const prop of component.props) {
            const required = prop.optional ? "No" : "Yes";
            lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${required} |`);
          }

          lines.push("");
        } else {
          lines.push("_No props defined._");
          lines.push("");
        }

        docs.push({
          type: "component",
          title: component.name,
          content: lines.join("\n"),
          filePaths: [filePath],
          generatedAt: new Date().toISOString(),
        });
      }
    }

    logger.info(
      {
        projectId,
        componentFiles: componentFiles.length,
        docsGenerated: docs.length,
      },
      "Generated component documentation"
    );

    return docs;
  }

  /**
   * Generate database docs from Drizzle schema definitions.
   */
  async generateDatabaseDocs(
    projectId: string,
    schemaFiles: string[]
  ): Promise<GeneratedDoc[]> {
    const docs: GeneratedDoc[] = [];
    const allTables: ExtractedTable[] = [];

    for (const filePath of schemaFiles) {
      const content = await this.fetchFileContent(projectId, filePath);
      if (!content) {
        continue;
      }

      const tables = this.extractTables(content, filePath);
      allTables.push(...tables);
    }

    if (allTables.length > 0) {
      const lines: string[] = [
        "# Database Schema Reference",
        "",
        `Generated from ${allTables.length} table(s).`,
        "",
      ];

      for (const table of allTables) {
        lines.push(`## \`${table.tableName}\``);
        lines.push("");
        lines.push(`**Variable**: \`${table.variableName}\`  `);
        lines.push(`**File**: \`${table.filePath}\``);
        lines.push("");

        if (table.columns.length > 0) {
          lines.push("| Column | Type | Arguments |");
          lines.push("|--------|------|-----------|");

          for (const col of table.columns) {
            const args = col.args ? col.args.trim() : "-";
            lines.push(`| \`${col.name}\` | \`${col.type}\` | ${args} |`);
          }

          lines.push("");
        }
      }

      const sourceFiles = [...new Set(allTables.map((t) => t.filePath))];

      docs.push({
        type: "database",
        title: "Database Schema Reference",
        content: lines.join("\n"),
        filePaths: sourceFiles,
        generatedAt: new Date().toISOString(),
      });
    }

    logger.info(
      {
        projectId,
        schemaFiles: schemaFiles.length,
        tablesFound: allTables.length,
      },
      "Generated database documentation"
    );

    return docs;
  }

  /**
   * Generate architecture overview from the knowledge graph.
   */
  async generateArchitectureDocs(projectId: string): Promise<GeneratedDoc> {
    let graphData: {
      nodes: Array<{ name: string; type: string; path: string }>;
      edges: Array<{ from: string; to: string; type: string }>;
    } = { nodes: [], edges: [] };

    try {
      const response = await fetch(
        `${this.projectBrainUrl}/api/graph/overview?projectId=${encodeURIComponent(projectId)}`,
        { signal: AbortSignal.timeout(30_000) }
      );

      if (response.ok) {
        graphData = (await response.json()) as typeof graphData;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { projectId, error: msg },
        "Could not fetch knowledge graph for architecture docs"
      );
    }

    const lines: string[] = [
      "# Architecture Overview",
      "",
      `Project: ${projectId}`,
      "",
    ];

    // Group nodes by type
    const nodesByType = new Map<
      string,
      Array<{ name: string; path: string }>
    >();
    for (const node of graphData.nodes) {
      const existing = nodesByType.get(node.type) ?? [];
      existing.push({ name: node.name, path: node.path });
      nodesByType.set(node.type, existing);
    }

    if (nodesByType.size > 0) {
      lines.push("## Components");
      lines.push("");

      for (const [type, nodes] of nodesByType) {
        lines.push(`### ${type}`);
        lines.push("");
        for (const node of nodes) {
          lines.push(`- **${node.name}** (\`${node.path}\`)`);
        }
        lines.push("");
      }
    }

    // Document dependency relationships
    if (graphData.edges.length > 0) {
      lines.push("## Dependencies");
      lines.push("");

      const depGroups = new Map<string, string[]>();
      for (const edge of graphData.edges) {
        const existing = depGroups.get(edge.from) ?? [];
        existing.push(`${edge.to} (${edge.type})`);
        depGroups.set(edge.from, existing);
      }

      for (const [source, targets] of depGroups) {
        lines.push(`- **${source}** depends on:`);
        for (const target of targets) {
          lines.push(`  - ${target}`);
        }
      }

      lines.push("");
    }

    if (nodesByType.size === 0 && graphData.edges.length === 0) {
      lines.push(
        "_Knowledge graph is empty. Run a full index to populate architecture data._"
      );
      lines.push("");
    }

    const filePaths = graphData.nodes.map((n) => n.path);

    logger.info(
      {
        projectId,
        nodeCount: graphData.nodes.length,
        edgeCount: graphData.edges.length,
      },
      "Generated architecture documentation"
    );

    return {
      type: "architecture",
      title: "Architecture Overview",
      content: lines.join("\n"),
      filePaths,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Private extraction helpers ──

  private extractProcedures(
    content: string,
    filePath: string
  ): ExtractedProcedure[] {
    const procedures: ExtractedProcedure[] = [];

    // Detect router name
    let routerName = "unknownRouter";
    const routerMatches = content.matchAll(TRPC_ROUTER_PATTERN);
    for (const match of routerMatches) {
      routerName = match[1] ?? routerName;
      break; // Use the first router found
    }

    const procMatches = content.matchAll(TRPC_PROCEDURE_PATTERN);
    for (const match of procMatches) {
      const name = match[1] ?? "";
      const inputSchema = (match[2] ?? "").trim();
      const outputSchema = (match[3] ?? "").trim();
      const kind = (match[4] ?? "query") as
        | "query"
        | "mutation"
        | "subscription";

      procedures.push({
        name,
        kind,
        inputSchema,
        outputSchema,
        routerName,
        filePath,
      });
    }

    return procedures;
  }

  private extractComponents(
    content: string,
    filePath: string
  ): ExtractedComponent[] {
    const components: ExtractedComponent[] = [];

    // Extract prop types first
    const propTypes = new Map<
      string,
      Array<{ name: string; type: string; optional: boolean }>
    >();

    const propsMatches = content.matchAll(REACT_PROPS_PATTERN);
    for (const match of propsMatches) {
      const propsName = match[1] ?? "";
      const propsBody = match[2] ?? "";
      const entries: Array<{ name: string; type: string; optional: boolean }> =
        [];

      const entryMatches = propsBody.matchAll(PROP_ENTRY_PATTERN);
      for (const entry of entryMatches) {
        entries.push({
          name: entry[1] ?? "",
          optional: entry[2] === "?",
          type: (entry[3] ?? "").trim(),
        });
      }

      propTypes.set(propsName, entries);
    }

    // Extract component declarations
    const compMatches = content.matchAll(REACT_COMPONENT_PATTERN);
    for (const match of compMatches) {
      const name = match[1] ?? "";
      const fcGeneric = match[2] ?? "";
      const paramType = match[3] ?? "";

      // Find props from the type reference
      const propsRef = fcGeneric || paramType;
      const props = propTypes.get(propsRef) ?? [];

      components.push({ name, props, filePath });
    }

    return components;
  }

  private extractTables(content: string, filePath: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];

    const tableMatches = content.matchAll(DRIZZLE_TABLE_PATTERN);
    for (const match of tableMatches) {
      const variableName = match[1] ?? "";
      const tableName = match[2] ?? "";
      const columnsBody = match[3] ?? "";

      const columns: Array<{ name: string; type: string; args: string }> = [];
      const colMatches = columnsBody.matchAll(DRIZZLE_COLUMN_PATTERN);
      for (const col of colMatches) {
        columns.push({
          name: col[1] ?? "",
          type: col[2] ?? "",
          args: col[3] ?? "",
        });
      }

      tables.push({ variableName, tableName, columns, filePath });
    }

    return tables;
  }

  private async fetchFileContent(
    projectId: string,
    filePath: string
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.projectBrainUrl}/api/files/content?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!response.ok) {
        return null;
      }

      return await response.text();
    } catch {
      return null;
    }
  }
}
