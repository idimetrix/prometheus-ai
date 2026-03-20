/**
 * Cognee-inspired Knowledge Graph Pipeline.
 *
 * A 6-stage pipeline for transforming source code into a knowledge graph:
 * 1. Classify - Determine file language, type, and purpose
 * 2. Chunk - Split code into semantic chunks
 * 3. Embed - Generate vector embeddings for chunks
 * 4. Graph - Extract relationships and build graph edges
 * 5. Summarize - Generate summaries for files and modules
 * 6. Store - Persist graph nodes, edges, and embeddings to PG+pgvector
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("code-intelligence:cognee-pipeline");

/**
 * Input file for the pipeline.
 */
export interface CodeFile {
  /** Source code content */
  content: string;
  /** Programming language identifier */
  language: string;
  /** File path relative to project root */
  path: string;
}

/**
 * A node in the knowledge graph.
 */
export interface GraphNode {
  /** File path this node belongs to */
  filePath: string;
  /** Unique node identifier */
  id: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Display name */
  name: string;
  /** Node classification */
  type:
    | "file"
    | "function"
    | "class"
    | "module"
    | "interface"
    | "type"
    | "variable";
}

/**
 * An edge connecting two nodes in the knowledge graph.
 */
export interface GraphEdge {
  /** Optional metadata about the relationship */
  metadata?: Record<string, unknown>;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Relationship type */
  type:
    | "imports"
    | "calls"
    | "extends"
    | "implements"
    | "depends_on"
    | "contains"
    | "exports"
    | "uses_type";
  /** Relationship strength (0-1) */
  weight: number;
}

/**
 * Complete knowledge graph produced by the pipeline.
 */
export interface KnowledgeGraph {
  /** All relationships between nodes */
  edges: GraphEdge[];
  /** All code entities */
  nodes: GraphNode[];
}

/**
 * A semantic chunk of code with metadata.
 */
export interface CodeChunk {
  /** The chunk content */
  content: string;
  /** End line in the source file */
  endLine: number;
  /** File path */
  filePath: string;
  /** Chunk index within the file */
  index: number;
  /** Language identifier */
  language: string;
  /** Start line in the source file */
  startLine: number;
  /** Semantic type of the chunk */
  type: "function" | "class" | "module" | "import-block" | "comment" | "other";
}

/**
 * Classification result for a file.
 */
export interface FileClassification {
  /** Detected framework (e.g., "react", "express") */
  framework?: string;
  /** Language identifier */
  language: string;
  /** File path */
  path: string;
  /** File purpose (e.g., "component", "route", "model", "test", "config") */
  purpose: string;
}

/**
 * Embedding result for a code chunk.
 */
export interface ChunkEmbedding {
  /** Chunk index */
  chunkIndex: number;
  /** Vector embedding */
  embedding: number[];
  /** File path */
  filePath: string;
}

/**
 * Summary of a file or module.
 */
export interface FileSummary {
  /** File path */
  filePath: string;
  /** Key exports from the file */
  keyExports: string[];
  /** One-line summary */
  summary: string;
}

// ─── Regex patterns for extraction ───────────────────────────────

const CHUNK_FUNCTION_RE = /^(?:export\s+)?(?:async\s+)?function\s/;
const CHUNK_CLASS_RE = /^(?:export\s+)?(?:abstract\s+)?class\s/;
const CHUNK_INTERFACE_RE = /^(?:export\s+)?interface\s/;
const CHUNK_TYPE_RE = /^(?:export\s+)?type\s/;
const CHUNK_IMPORT_RE = /^import\s/;
const CHUNK_JSDOC_RE = /^\/\*\*/;
const CHUNK_COMMENT_RE = /^\/\//;

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/g;
const EXPORT_RE =
  /export\s+(?:default\s+)?(?:abstract\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
const FUNCTION_RE = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
const CLASS_RE =
  /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;
const INTERFACE_RE = /(?:export\s+)?interface\s+(\w+)/g;
const TYPE_RE = /(?:export\s+)?type\s+(\w+)\s*=/g;

/**
 * 6-stage pipeline for building a knowledge graph from source code.
 *
 * Each stage is independently callable, or the full pipeline can be
 * run via the `process()` method.
 *
 * @example
 * ```ts
 * const pipeline = new CogneePipeline();
 * const graph = await pipeline.process(files);
 * console.log(`${graph.nodes.length} nodes, ${graph.edges.length} edges`);
 * ```
 */
export class CogneePipeline {
  /**
   * Run the full 6-stage pipeline on a set of files.
   */
  process(files: CodeFile[]): KnowledgeGraph {
    const start = performance.now();

    logger.info({ fileCount: files.length }, "Starting Cognee pipeline");

    // Stage 1: Classify
    const classifications = this.classify(files);

    // Stage 2: Chunk
    const chunks = this.chunk(files);

    // Stage 3: Embed (placeholder -- actual embedding requires model)
    const embeddings = this.embed(chunks);

    // Stage 4: Graph
    const graph = this.graph(files, classifications);

    // Stage 5: Summarize
    const summaries = this.summarize(files, graph);

    // Stage 6: Store (returns the graph; persistence is caller responsibility)
    const result = this.store(graph, embeddings, summaries);

    const elapsed = Math.round(performance.now() - start);

    logger.info(
      {
        fileCount: files.length,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        durationMs: elapsed,
      },
      "Cognee pipeline completed"
    );

    return result;
  }

  /**
   * Stage 1: Classify files by language, purpose, and framework.
   */
  classify(files: CodeFile[]): FileClassification[] {
    return files.map((file) => {
      const purpose = detectPurpose(file.path, file.content);
      const framework = detectFramework(file.content);

      return {
        path: file.path,
        language: file.language,
        purpose,
        framework,
      };
    });
  }

  /**
   * Stage 2: Split files into semantic code chunks.
   */
  chunk(files: CodeFile[]): CodeChunk[] {
    const allChunks: CodeChunk[] = [];

    for (const file of files) {
      const chunks = chunkFile(file);
      allChunks.push(...chunks);
    }

    return allChunks;
  }

  /**
   * Stage 3: Generate embeddings for code chunks.
   *
   * Returns empty embeddings by default. Override or extend to connect
   * to an actual embedding service (Ollama, OpenAI, Voyage).
   */
  embed(chunks: CodeChunk[]): ChunkEmbedding[] {
    logger.debug(
      { chunkCount: chunks.length },
      "Embedding stage (placeholder -- no model configured)"
    );
    return chunks.map((c) => ({
      filePath: c.filePath,
      chunkIndex: c.index,
      embedding: [],
    }));
  }

  /**
   * Stage 4: Extract graph nodes and edges from files.
   */
  graph(
    files: CodeFile[],
    classifications: FileClassification[]
  ): KnowledgeGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const classMap = new Map(classifications.map((c) => [c.path, c]));

    for (const file of files) {
      const classification = classMap.get(file.path);
      const fileNodeId = `file:${file.path}`;

      nodes.push({
        id: fileNodeId,
        type: "file",
        name: file.path.split("/").pop() ?? file.path,
        filePath: file.path,
        metadata: {
          language: file.language,
          purpose: classification?.purpose ?? "unknown",
          framework: classification?.framework,
          loc: file.content.split("\n").length,
        },
      });

      // Extract functions
      FUNCTION_RE.lastIndex = 0;
      let fnMatch: RegExpExecArray | null = FUNCTION_RE.exec(file.content);
      while (fnMatch !== null) {
        const name = fnMatch[1];
        if (name) {
          const fnId = `fn:${file.path}:${name}`;
          nodes.push({
            id: fnId,
            type: "function",
            name,
            filePath: file.path,
            metadata: {},
          });
          edges.push({
            source: fileNodeId,
            target: fnId,
            type: "contains",
            weight: 1,
          });
        }
        fnMatch = FUNCTION_RE.exec(file.content);
      }

      // Extract classes
      CLASS_RE.lastIndex = 0;
      let clsMatch: RegExpExecArray | null = CLASS_RE.exec(file.content);
      while (clsMatch !== null) {
        const className = clsMatch[1];
        if (className) {
          const classId = `class:${file.path}:${className}`;
          nodes.push({
            id: classId,
            type: "class",
            name: className,
            filePath: file.path,
            metadata: {},
          });
          edges.push({
            source: fileNodeId,
            target: classId,
            type: "contains",
            weight: 1,
          });

          if (clsMatch[2]) {
            edges.push({
              source: classId,
              target: `class:unknown:${clsMatch[2]}`,
              type: "extends",
              weight: 0.9,
            });
          }

          if (clsMatch[3]) {
            for (const iface of clsMatch[3].split(",")) {
              const trimmed = iface.trim();
              if (trimmed) {
                edges.push({
                  source: classId,
                  target: `interface:unknown:${trimmed}`,
                  type: "implements",
                  weight: 0.8,
                });
              }
            }
          }
        }
        clsMatch = CLASS_RE.exec(file.content);
      }

      // Extract interfaces
      INTERFACE_RE.lastIndex = 0;
      let ifMatch: RegExpExecArray | null = INTERFACE_RE.exec(file.content);
      while (ifMatch !== null) {
        const name = ifMatch[1];
        if (name) {
          const ifaceId = `interface:${file.path}:${name}`;
          nodes.push({
            id: ifaceId,
            type: "interface",
            name,
            filePath: file.path,
            metadata: {},
          });
          edges.push({
            source: fileNodeId,
            target: ifaceId,
            type: "contains",
            weight: 1,
          });
        }
        ifMatch = INTERFACE_RE.exec(file.content);
      }

      // Extract types
      TYPE_RE.lastIndex = 0;
      let tpMatch: RegExpExecArray | null = TYPE_RE.exec(file.content);
      while (tpMatch !== null) {
        const name = tpMatch[1];
        if (name) {
          const typeId = `type:${file.path}:${name}`;
          nodes.push({
            id: typeId,
            type: "type",
            name,
            filePath: file.path,
            metadata: {},
          });
          edges.push({
            source: fileNodeId,
            target: typeId,
            type: "contains",
            weight: 1,
          });
        }
        tpMatch = TYPE_RE.exec(file.content);
      }

      // Extract import edges
      IMPORT_RE.lastIndex = 0;
      let impMatch: RegExpExecArray | null = IMPORT_RE.exec(file.content);
      while (impMatch !== null) {
        const source = impMatch[1];
        if (source) {
          edges.push({
            source: fileNodeId,
            target: `file:${source}`,
            type: "imports",
            weight: 1,
          });
        }
        impMatch = IMPORT_RE.exec(file.content);
      }
    }

    return { nodes, edges };
  }

  /**
   * Stage 5: Generate summaries for files.
   */
  summarize(files: CodeFile[], graph: KnowledgeGraph): FileSummary[] {
    return files.map((file) => {
      const fileEdges = graph.edges.filter(
        (e) => e.source === `file:${file.path}` && e.type === "contains"
      );
      const containedNodes = fileEdges
        .map((e) => graph.nodes.find((n) => n.id === e.target))
        .filter((n): n is GraphNode => n !== undefined);

      EXPORT_RE.lastIndex = 0;
      const exports: string[] = [];
      let expMatch: RegExpExecArray | null = EXPORT_RE.exec(file.content);
      while (expMatch !== null) {
        if (expMatch[1]) {
          exports.push(expMatch[1]);
        }
        expMatch = EXPORT_RE.exec(file.content);
      }

      const functions = containedNodes
        .filter((n) => n.type === "function")
        .map((n) => n.name);
      const classes = containedNodes
        .filter((n) => n.type === "class")
        .map((n) => n.name);

      const parts: string[] = [];
      if (classes.length > 0) {
        parts.push(`Defines ${classes.join(", ")}`);
      }
      if (functions.length > 0) {
        parts.push(`with functions ${functions.join(", ")}`);
      }

      return {
        filePath: file.path,
        summary: parts.length > 0 ? parts.join(" ") : `Module ${file.path}`,
        keyExports: exports,
      };
    });
  }

  /**
   * Stage 6: Prepare final graph for storage.
   *
   * Returns the assembled graph for the caller to persist.
   */
  store(
    graph: KnowledgeGraph,
    _embeddings: ChunkEmbedding[],
    _summaries: FileSummary[]
  ): KnowledgeGraph {
    logger.debug(
      { nodeCount: graph.nodes.length, edgeCount: graph.edges.length },
      "Knowledge graph ready for storage"
    );
    return graph;
  }
}

// ─── Helper functions ────────────────────────────────────────────

function detectPurpose(filePath: string, content: string): string {
  const lower = filePath.toLowerCase();

  if (lower.includes("test") || lower.includes("spec")) {
    return "test";
  }
  if (
    lower.includes("config") ||
    lower.endsWith(".config.ts") ||
    lower.endsWith(".config.js")
  ) {
    return "config";
  }
  if (lower.includes("route") || lower.includes("router")) {
    return "route";
  }
  if (lower.includes("model") || lower.includes("schema")) {
    return "model";
  }
  if (
    lower.includes("component") ||
    content.includes("export default function") ||
    content.includes("React.FC")
  ) {
    return "component";
  }
  if (lower.includes("util") || lower.includes("helper")) {
    return "utility";
  }
  if (lower.includes("middleware")) {
    return "middleware";
  }
  if (lower.includes("service")) {
    return "service";
  }
  return "module";
}

function detectFramework(content: string): string | undefined {
  if (content.includes("from 'react'") || content.includes('from "react"')) {
    return "react";
  }
  if (content.includes("from 'next'") || content.includes('from "next"')) {
    return "next";
  }
  if (
    content.includes("from 'express'") ||
    content.includes('from "express"')
  ) {
    return "express";
  }
  if (content.includes("from '@hono'") || content.includes('from "hono"')) {
    return "hono";
  }
  return undefined;
}

function chunkFile(file: CodeFile): CodeChunk[] {
  const lines = file.content.split("\n");
  const chunks: CodeChunk[] = [];
  let chunkIndex = 0;
  let currentStart = 0;
  const chunkSize = 50;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const isBreak =
      i - currentStart >= chunkSize &&
      (CHUNK_FUNCTION_RE.test(line) ||
        CHUNK_CLASS_RE.test(line) ||
        CHUNK_INTERFACE_RE.test(line) ||
        CHUNK_TYPE_RE.test(line));

    if (isBreak || i === lines.length - 1) {
      const endLine = i === lines.length - 1 ? i : i - 1;
      const content = lines.slice(currentStart, endLine + 1).join("\n");

      if (content.trim().length > 0) {
        chunks.push({
          filePath: file.path,
          language: file.language,
          index: chunkIndex++,
          content,
          startLine: currentStart,
          endLine,
          type: detectChunkType(content),
        });
      }

      currentStart = i === lines.length - 1 ? i + 1 : i;
    }
  }

  if (currentStart < lines.length) {
    const content = lines.slice(currentStart).join("\n");
    if (content.trim().length > 0) {
      chunks.push({
        filePath: file.path,
        language: file.language,
        index: chunkIndex,
        content,
        startLine: currentStart,
        endLine: lines.length - 1,
        type: detectChunkType(content),
      });
    }
  }

  return chunks;
}

function detectChunkType(content: string): CodeChunk["type"] {
  const trimmed = content.trim();
  if (CHUNK_CLASS_RE.test(trimmed)) {
    return "class";
  }
  if (CHUNK_FUNCTION_RE.test(trimmed)) {
    return "function";
  }
  if (CHUNK_IMPORT_RE.test(trimmed)) {
    return "import-block";
  }
  if (CHUNK_JSDOC_RE.test(trimmed) || CHUNK_COMMENT_RE.test(trimmed)) {
    return "comment";
  }
  return "other";
}
