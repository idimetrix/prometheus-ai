import { createLogger } from "@prometheus/logger";
import type { GraphEdge, GraphNode } from "./types";

const logger = createLogger("architecture-graph:diagram-generator");

/**
 * Generates architecture diagrams in Mermaid and DOT (Graphviz) formats
 * from graph nodes and edges. Used to auto-generate visual architecture
 * documentation from the codebase knowledge graph.
 */
export class DiagramGenerator {
  /**
   * Generate a Mermaid flowchart from graph nodes and edges.
   * Groups nodes by type and renders directed edges.
   */
  generateMermaid(
    nodes: GraphNode[],
    edges: GraphEdge[],
    options?: { direction?: "TB" | "LR" | "BT" | "RL"; title?: string }
  ): string {
    const direction = options?.direction ?? "TB";
    const lines: string[] = [];

    if (options?.title) {
      lines.push("---");
      lines.push(`title: ${options.title}`);
      lines.push("---");
    }

    lines.push(`flowchart ${direction}`);

    // Group nodes by type for subgraph rendering
    const groupedByType = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const group = groupedByType.get(node.type) ?? [];
      group.push(node);
      groupedByType.set(node.type, group);
    }

    // Create a set of valid node IDs for edge filtering
    const nodeIds = new Set(nodes.map((n) => n.id));

    // Render subgraphs per type
    for (const [type, groupNodes] of groupedByType) {
      lines.push(
        `  subgraph ${sanitizeMermaidId(type)}["${escapeLabel(type)}"]`
      );
      for (const node of groupNodes) {
        const shape = getMermaidShape(node.type);
        lines.push(
          `    ${sanitizeMermaidId(node.id)}${shape.open}"${escapeLabel(node.label)}"${shape.close}`
        );
      }
      lines.push("  end");
    }

    // Render edges
    for (const edge of edges) {
      if (!(nodeIds.has(edge.source) && nodeIds.has(edge.target))) {
        continue;
      }
      const label = edge.label ? `|"${escapeLabel(edge.label)}"|` : "";
      lines.push(
        `  ${sanitizeMermaidId(edge.source)} -->${label} ${sanitizeMermaidId(edge.target)}`
      );
    }

    logger.info(
      { nodeCount: nodes.length, edgeCount: edges.length },
      "Generated Mermaid diagram"
    );

    return lines.join("\n");
  }

  /**
   * Generate a DOT (Graphviz) graph from nodes and edges.
   */
  generateDot(
    nodes: GraphNode[],
    edges: GraphEdge[],
    options?: { graphName?: string; rankdir?: "TB" | "LR" }
  ): string {
    const graphName = options?.graphName ?? "architecture";
    const rankdir = options?.rankdir ?? "LR";
    const lines: string[] = [];
    const nodeIds = new Set(nodes.map((n) => n.id));

    lines.push(`digraph ${graphName} {`);
    lines.push(`  rankdir=${rankdir};`);
    lines.push(
      `  node [shape=box, style="rounded,filled", fillcolor="#f0f0f0", fontname="Helvetica"];`
    );
    lines.push(`  edge [fontname="Helvetica", fontsize=10];`);
    lines.push("");

    // Group nodes into subgraphs by type
    const groupedByType = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const group = groupedByType.get(node.type) ?? [];
      group.push(node);
      groupedByType.set(node.type, group);
    }

    for (const [type, groupNodes] of groupedByType) {
      const color = getDotColor(type);
      lines.push(`  subgraph cluster_${sanitizeDotId(type)} {`);
      lines.push(`    label="${type}";`);
      lines.push("    style=dashed;");
      lines.push(`    color="${color}";`);
      for (const node of groupNodes) {
        lines.push(
          `    ${sanitizeDotId(node.id)} [label="${escapeDotLabel(node.label)}", fillcolor="${color}"];`
        );
      }
      lines.push("  }");
      lines.push("");
    }

    // Render edges
    for (const edge of edges) {
      if (!(nodeIds.has(edge.source) && nodeIds.has(edge.target))) {
        continue;
      }
      const label = edge.label
        ? ` [label="${escapeDotLabel(edge.label)}"]`
        : "";
      lines.push(
        `  ${sanitizeDotId(edge.source)} -> ${sanitizeDotId(edge.target)}${label};`
      );
    }

    lines.push("}");

    logger.info(
      { nodeCount: nodes.length, edgeCount: edges.length },
      "Generated DOT diagram"
    );

    return lines.join("\n");
  }

  /**
   * Generate a simple component dependency diagram in Mermaid format
   * suitable for embedding in markdown documentation.
   */
  generateComponentDiagram(
    components: Array<{ name: string; type: string; dependsOn: string[] }>
  ): string {
    const lines: string[] = ["flowchart LR"];

    for (const comp of components) {
      const shape = getMermaidShape(comp.type);
      lines.push(
        `  ${sanitizeMermaidId(comp.name)}${shape.open}"${escapeLabel(comp.name)}"${shape.close}`
      );
    }

    for (const comp of components) {
      for (const dep of comp.dependsOn) {
        lines.push(
          `  ${sanitizeMermaidId(comp.name)} --> ${sanitizeMermaidId(dep)}`
        );
      }
    }

    return lines.join("\n");
  }
}

// ── Helpers ──

function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function sanitizeDotId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, "'");
}

function escapeDotLabel(label: string): string {
  return label.replace(/"/g, '\\"');
}

function getMermaidShape(nodeType: string): { open: string; close: string } {
  switch (nodeType) {
    case "service":
      return { open: "([", close: "])" };
    case "package":
    case "module":
      return { open: "[[", close: "]]" };
    case "file":
      return { open: ">", close: "]" };
    case "component":
      return { open: "[/", close: "/]" };
    default:
      return { open: "[", close: "]" };
  }
}

function getDotColor(nodeType: string): string {
  switch (nodeType) {
    case "service":
      return "#e3f2fd";
    case "package":
    case "module":
      return "#e8f5e9";
    case "file":
      return "#fff3e0";
    case "component":
      return "#f3e5f5";
    default:
      return "#f5f5f5";
  }
}
