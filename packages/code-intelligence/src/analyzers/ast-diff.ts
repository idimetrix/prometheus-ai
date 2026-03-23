/**
 * AST-based structural diff analyzer.
 *
 * Compares two versions of source code at the structural level,
 * identifying added, removed, modified, and moved code entities
 * (functions, classes, types, etc.) rather than raw text lines.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("code-intelligence:ast-diff");

/**
 * The type of structural change detected.
 */
export type StructuralChangeType = "added" | "modified" | "moved" | "removed";

/**
 * The kind of code entity that changed.
 */
export type EntityKind =
  | "class"
  | "enum"
  | "function"
  | "import"
  | "interface"
  | "method"
  | "type"
  | "variable";

/**
 * A single structural change between two versions of a file.
 */
export interface StructuralChange {
  /** Human-readable description of the change */
  details: string;
  /** The kind of entity (function, class, type, etc.) */
  entity: EntityKind;
  /** Name of the changed entity */
  name: string;
  /** New line number (for added/modified/moved) */
  newLine?: number;
  /** Old line number (for removed/modified/moved) */
  oldLine?: number;
  /** The type of change */
  type: StructuralChangeType;
}

/**
 * Result of a structural diff.
 */
export interface StructuralDiffResult {
  /** All detected structural changes */
  changes: StructuralChange[];
  /** Duration of the diff in milliseconds */
  durationMs: number;
  /** Summary counts by change type */
  summary: Record<StructuralChangeType, number>;
}

/**
 * Internal representation of an extracted code entity for diffing.
 */
interface CodeEntity {
  /** Content/body of the entity */
  body: string;
  /** The entity kind */
  kind: EntityKind;
  /** Start line number (1-indexed) */
  line: number;
  /** Entity name */
  name: string;
  /** Signature (parameters, return type) for functions/methods */
  signature: string;
}

// ─── Regex-based entity extraction ───────────────────────────────

const ENTITY_PATTERNS: Array<{
  kind: EntityKind;
  regex: RegExp;
}> = [
  {
    kind: "function",
    regex: /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))/gm,
  },
  {
    kind: "function",
    regex:
      /^[ \t]*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(\([^)]*\))\s*(?::\s*\S+\s*)?=>/gm,
  },
  {
    kind: "class",
    regex: /^[ \t]*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
  },
  {
    kind: "interface",
    regex: /^[ \t]*(?:export\s+)?interface\s+(\w+)/gm,
  },
  {
    kind: "type",
    regex: /^[ \t]*(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/gm,
  },
  {
    kind: "enum",
    regex: /^[ \t]*(?:export\s+)?enum\s+(\w+)/gm,
  },
  {
    kind: "import",
    regex:
      /^[ \t]*import\s+(?:(?:type\s+)?(?:\{[^}]*\}|[\w*]+).*?from\s+)?['"]([^'"]+)['"]/gm,
  },
  {
    kind: "method",
    regex: /^[ \t]+(?:async\s+)?(\w+)\s*(\([^)]*\))/gm,
  },
  // Python
  {
    kind: "function",
    regex: /^[ \t]*(?:async\s+)?def\s+(\w+)\s*(\([^)]*\))/gm,
  },
  {
    kind: "class",
    regex: /^[ \t]*class\s+(\w+)/gm,
  },
  // Rust
  {
    kind: "function",
    regex:
      /^[ \t]*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*(\([^)]*\))/gm,
  },
  {
    kind: "class",
    regex: /^[ \t]*(?:pub\s+)?struct\s+(\w+)/gm,
  },
  {
    kind: "interface",
    regex: /^[ \t]*(?:pub\s+)?trait\s+(\w+)/gm,
  },
  // Go
  {
    kind: "function",
    regex: /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*(\([^)]*\))/gm,
  },
  {
    kind: "interface",
    regex: /^type\s+(\w+)\s+interface\b/gm,
  },
  {
    kind: "class",
    regex: /^type\s+(\w+)\s+struct\b/gm,
  },
];

/**
 * Extract code entities from source content using regex patterns.
 */
function extractEntities(content: string): CodeEntity[] {
  const entities: CodeEntity[] = [];
  const lines = content.split("\n");

  for (const { kind, regex } of ENTITY_PATTERNS) {
    regex.lastIndex = 0;
    let match = regex.exec(content);
    while (match !== null) {
      const name = match[1];
      if (name) {
        const lineNumber = content.slice(0, match.index).split("\n").length;
        const signature = match[2] ?? "";

        // Extract the body: from match line to next entity or end
        const startLineIdx = lineNumber - 1;
        const bodyLines: string[] = [];
        const maxBodyLines = 50;
        for (
          let i = startLineIdx;
          i < lines.length && i < startLineIdx + maxBodyLines;
          i++
        ) {
          bodyLines.push(lines[i] ?? "");
        }

        entities.push({
          name,
          kind,
          line: lineNumber,
          signature,
          body: bodyLines.join("\n"),
        });
      }
      match = regex.exec(content);
    }
  }

  // Deduplicate by name + kind (keep first occurrence)
  const seen = new Set<string>();
  return entities.filter((e) => {
    const key = `${e.kind}:${e.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * AST-based structural diff analyzer.
 *
 * Compares two versions of source code at the entity level (functions,
 * classes, types, etc.) rather than raw text lines. This provides
 * semantic understanding of what changed.
 *
 * @example
 * ```ts
 * const analyzer = new AstDiffAnalyzer();
 *
 * const result = analyzer.diffFiles(
 *   oldContent,
 *   newContent,
 *   "typescript",
 * );
 *
 * for (const change of result.changes) {
 *   console.log(`${change.type}: ${change.entity} "${change.name}" - ${change.details}`);
 * }
 * ```
 */
export class AstDiffAnalyzer {
  /**
   * Compute a structural diff between two versions of source code.
   *
   * @param oldContent - The previous version of the source code
   * @param newContent - The new version of the source code
   * @param _language - The language identifier (used for future AST-based parsing)
   * @returns Structural diff result with changes and summary
   */
  diffFiles(
    oldContent: string,
    newContent: string,
    _language: string
  ): StructuralDiffResult {
    const start = performance.now();

    const oldEntities = extractEntities(oldContent);
    const newEntities = extractEntities(newContent);

    const oldByKey = new Map<string, CodeEntity>();
    for (const entity of oldEntities) {
      oldByKey.set(`${entity.kind}:${entity.name}`, entity);
    }

    const newByKey = new Map<string, CodeEntity>();
    for (const entity of newEntities) {
      newByKey.set(`${entity.kind}:${entity.name}`, entity);
    }

    const changes: StructuralChange[] = [];

    // Find added and modified entities
    for (const [key, newEntity] of newByKey) {
      const oldEntity = oldByKey.get(key);

      if (!oldEntity) {
        changes.push({
          type: "added",
          entity: newEntity.kind,
          name: newEntity.name,
          newLine: newEntity.line,
          details: `New ${newEntity.kind} "${newEntity.name}" added at line ${newEntity.line}`,
        });
        continue;
      }

      // Check if the entity was moved (different line but same content)
      const signatureChanged = oldEntity.signature !== newEntity.signature;
      const lineChanged = oldEntity.line !== newEntity.line;
      const bodyChanged = oldEntity.body !== newEntity.body;

      if (signatureChanged || bodyChanged) {
        const detail = signatureChanged
          ? `Signature changed from "${oldEntity.signature}" to "${newEntity.signature}"`
          : "Body modified";

        changes.push({
          type: "modified",
          entity: newEntity.kind,
          name: newEntity.name,
          oldLine: oldEntity.line,
          newLine: newEntity.line,
          details: detail,
        });
      } else if (lineChanged) {
        changes.push({
          type: "moved",
          entity: newEntity.kind,
          name: newEntity.name,
          oldLine: oldEntity.line,
          newLine: newEntity.line,
          details: `Moved from line ${oldEntity.line} to line ${newEntity.line}`,
        });
      }
    }

    // Find removed entities
    for (const [key, oldEntity] of oldByKey) {
      if (!newByKey.has(key)) {
        changes.push({
          type: "removed",
          entity: oldEntity.kind,
          name: oldEntity.name,
          oldLine: oldEntity.line,
          details: `${oldEntity.kind} "${oldEntity.name}" removed from line ${oldEntity.line}`,
        });
      }
    }

    // Sort by line number (prefer newLine, fall back to oldLine)
    changes.sort(
      (a, b) => (a.newLine ?? a.oldLine ?? 0) - (b.newLine ?? b.oldLine ?? 0)
    );

    const durationMs = Math.round(performance.now() - start);
    const summary: Record<StructuralChangeType, number> = {
      added: 0,
      removed: 0,
      modified: 0,
      moved: 0,
    };
    for (const change of changes) {
      summary[change.type]++;
    }

    logger.debug(
      { summary, durationMs },
      `Structural diff complete: ${changes.length} changes in ${durationMs}ms`
    );

    return { changes, summary, durationMs };
  }
}
