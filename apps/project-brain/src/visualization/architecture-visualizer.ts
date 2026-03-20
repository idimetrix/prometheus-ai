/**
 * Architecture Visualizer — Generates Mermaid and D2 diagrams
 * from code graphs, component relationships, request flows,
 * and database schemas.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:architecture-visualizer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeGraphNode {
  dependencies: string[];
  filePath: string;
  name: string;
  type: "module" | "class" | "function" | "route" | "service";
}

export interface Component {
  connections: Array<{ description: string; target: string }>;
  name: string;
  type: "service" | "database" | "queue" | "cache" | "external";
}

export interface FlowStep {
  action: string;
  from: string;
  to: string;
}

export interface SchemaTable {
  columns: Array<{ name: string; nullable: boolean; type: string }>;
  name: string;
  references: Array<{
    column: string;
    foreignColumn: string;
    foreignTable: string;
  }>;
}

export type DiagramFormat = "mermaid" | "d2";

// ---------------------------------------------------------------------------
// ArchitectureVisualizer
// ---------------------------------------------------------------------------

export class ArchitectureVisualizer {
  /**
   * Generate a dependency graph diagram from a code graph.
   */
  generateMermaidDiagram(codeGraph: CodeGraphNode[]): string {
    logger.debug(
      { nodeCount: codeGraph.length },
      "Generating Mermaid dependency diagram"
    );

    const lines: string[] = [];
    lines.push("graph TD");

    // Create node definitions with shapes based on type
    for (const node of codeGraph) {
      const shape = this.getMermaidShape(node.type);
      const sanitized = this.sanitizeId(node.name);
      lines.push(`  ${sanitized}${shape}`);
    }

    lines.push("");

    // Create edges
    for (const node of codeGraph) {
      const fromId = this.sanitizeId(node.name);
      for (const dep of node.dependencies) {
        const toId = this.sanitizeId(dep);
        // Only add edge if target exists in graph
        if (codeGraph.some((n) => n.name === dep)) {
          lines.push(`  ${fromId} --> ${toId}`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate a component diagram showing relationships.
   */
  generateComponentDiagram(components: Component[]): string {
    logger.debug(
      { componentCount: components.length },
      "Generating component diagram"
    );

    const lines: string[] = [];
    lines.push("graph LR");

    // Style definitions
    lines.push("  classDef service fill:#4CAF50,stroke:#333,color:#fff");
    lines.push("  classDef database fill:#2196F3,stroke:#333,color:#fff");
    lines.push("  classDef queue fill:#FF9800,stroke:#333,color:#fff");
    lines.push("  classDef cache fill:#9C27B0,stroke:#333,color:#fff");
    lines.push("  classDef external fill:#607D8B,stroke:#333,color:#fff");
    lines.push("");

    // Node definitions
    for (const comp of components) {
      const id = this.sanitizeId(comp.name);
      const shape = this.getComponentShape(comp.type);
      lines.push(`  ${id}${shape}`);
    }

    lines.push("");

    // Connections
    for (const comp of components) {
      const fromId = this.sanitizeId(comp.name);
      for (const conn of comp.connections) {
        const toId = this.sanitizeId(conn.target);
        if (conn.description) {
          lines.push(`  ${fromId} -->|${conn.description}| ${toId}`);
        } else {
          lines.push(`  ${fromId} --> ${toId}`);
        }
      }
    }

    lines.push("");

    // Apply styles
    for (const comp of components) {
      const id = this.sanitizeId(comp.name);
      lines.push(`  class ${id} ${comp.type}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate a sequence diagram for a request flow.
   */
  generateSequenceDiagram(flow: FlowStep[]): string {
    logger.debug({ stepCount: flow.length }, "Generating sequence diagram");

    const lines: string[] = [];
    lines.push("sequenceDiagram");

    // Collect participants in order of appearance
    const participants = new Set<string>();
    for (const step of flow) {
      participants.add(step.from);
      participants.add(step.to);
    }

    for (const participant of participants) {
      lines.push(
        `  participant ${this.sanitizeId(participant)} as ${participant}`
      );
    }

    lines.push("");

    // Add interactions
    for (const step of flow) {
      const from = this.sanitizeId(step.from);
      const to = this.sanitizeId(step.to);
      lines.push(`  ${from}->>+${to}: ${step.action}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate an ER diagram from database schema.
   */
  generateERDiagram(schema: SchemaTable[]): string {
    logger.debug({ tableCount: schema.length }, "Generating ER diagram");

    const lines: string[] = [];
    lines.push("erDiagram");

    // Table definitions
    for (const table of schema) {
      lines.push(`  ${this.sanitizeId(table.name)} {`);
      for (const col of table.columns) {
        const nullable = col.nullable ? "nullable" : "required";
        lines.push(`    ${col.type} ${col.name} "${nullable}"`);
      }
      lines.push("  }");
      lines.push("");
    }

    // Relationships
    for (const table of schema) {
      for (const ref of table.references) {
        const from = this.sanitizeId(table.name);
        const to = this.sanitizeId(ref.foreignTable);
        lines.push(
          `  ${from} }|--|| ${to} : "${ref.column} -> ${ref.foreignColumn}"`
        );
      }
    }

    return lines.join("\n");
  }

  // ---- Private helpers ------------------------------------------------------

  private sanitizeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  private getMermaidShape(type: CodeGraphNode["type"]): string {
    switch (type) {
      case "service":
        return `[["${type}"]]`;
      case "module":
        return `["${type}"]`;
      case "class":
        return `{"${type}"}`;
      case "function":
        return `("${type}")`;
      case "route":
        return `>"${type}"]`;
      default:
        return `["${type}"]`;
    }
  }

  private getComponentShape(type: Component["type"]): string {
    switch (type) {
      case "service":
        return `["${type}"]`;
      case "database":
        return `[("${type}")]`;
      case "queue":
        return `{{"${type}"}}`;
      case "cache":
        return `("${type}")`;
      case "external":
        return `>"${type}"]`;
      default:
        return `["${type}"]`;
    }
  }
}
