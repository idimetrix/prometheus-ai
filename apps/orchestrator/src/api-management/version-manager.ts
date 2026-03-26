/**
 * Automated API Versioning (MOON-014)
 *
 * Analyzes diffs for breaking API changes, suggests semantic version
 * bumps, generates migration guides, and creates deprecation notices
 * with middleware for X-Deprecated headers.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:api-management:version-manager");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BreakingChangeType =
  | "removed"
  | "type_changed"
  | "required_added"
  | "renamed";

export type Impact = "high" | "medium" | "low";

export interface BreakingChangeEntry {
  change: string;
  endpoint: string;
  impact: Impact;
  type: BreakingChangeType;
}

export interface BreakingChangeAnalysis {
  breakingChanges: BreakingChangeEntry[];
  migrationGuide: string;
  suggestedVersion: string;
}

export interface DeprecationEntry {
  endpoint: string;
  removalDate: string;
  replacement: string;
}

export interface DeprecationNotice {
  code: string;
  documentation: string;
}

export interface DeprecationResult {
  headerMiddleware: string;
  notices: DeprecationNotice[];
}

// ---------------------------------------------------------------------------
// Diff parsing patterns
// ---------------------------------------------------------------------------

const REMOVED_ENDPOINT_RE =
  /^-\s*(app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/;
const ADDED_ENDPOINT_RE =
  /^\+\s*(app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/;
const REMOVED_FIELD_RE = /^-\s+(\w+)\s*[?]?\s*:\s*(\w+)/;
const ADDED_FIELD_RE = /^\+\s+(\w+)\s*:\s*(\w+)/;

// ---------------------------------------------------------------------------
// Diff parsing helpers (extracted to reduce cognitive complexity)
// ---------------------------------------------------------------------------

interface ParsedDiff {
  addedEndpoints: Array<{ method: string; path: string }>;
  addedFields: Array<{ name: string; type: string }>;
  removedEndpoints: Array<{ method: string; path: string }>;
  removedFields: Array<{ name: string; type: string }>;
}

function parseDiffLines(diff: string): ParsedDiff {
  const lines = diff.split("\n");
  const removedEndpoints: ParsedDiff["removedEndpoints"] = [];
  const addedEndpoints: ParsedDiff["addedEndpoints"] = [];
  const removedFields: ParsedDiff["removedFields"] = [];
  const addedFields: ParsedDiff["addedFields"] = [];

  for (const line of lines) {
    const removedMatch = line.match(REMOVED_ENDPOINT_RE);
    if (removedMatch) {
      removedEndpoints.push({
        method: removedMatch[2] ?? "unknown",
        path: removedMatch[3] ?? "unknown",
      });
    }

    const addedMatch = line.match(ADDED_ENDPOINT_RE);
    if (addedMatch) {
      addedEndpoints.push({
        method: addedMatch[2] ?? "unknown",
        path: addedMatch[3] ?? "unknown",
      });
    }

    const removedFieldMatch = line.match(REMOVED_FIELD_RE);
    if (removedFieldMatch) {
      removedFields.push({
        name: removedFieldMatch[1] ?? "unknown",
        type: removedFieldMatch[2] ?? "unknown",
      });
    }

    const addedFieldMatch = line.match(ADDED_FIELD_RE);
    if (addedFieldMatch) {
      addedFields.push({
        name: addedFieldMatch[1] ?? "unknown",
        type: addedFieldMatch[2] ?? "unknown",
      });
    }
  }

  return { removedEndpoints, addedEndpoints, removedFields, addedFields };
}

function detectBreakingChanges(parsed: ParsedDiff): BreakingChangeEntry[] {
  const changes: BreakingChangeEntry[] = [];

  for (const removed of parsed.removedEndpoints) {
    const renamed = parsed.addedEndpoints.find(
      (a) => a.method === removed.method && a.path !== removed.path
    );
    if (renamed) {
      changes.push({
        endpoint: `${removed.method.toUpperCase()} ${removed.path}`,
        change: `Renamed to ${renamed.method.toUpperCase()} ${renamed.path}`,
        type: "renamed",
        impact: "high",
      });
    } else {
      changes.push({
        endpoint: `${removed.method.toUpperCase()} ${removed.path}`,
        change: "Endpoint removed",
        type: "removed",
        impact: "high",
      });
    }
  }

  for (const removed of parsed.removedFields) {
    const changed = parsed.addedFields.find(
      (a) => a.name === removed.name && a.type !== removed.type
    );
    if (changed) {
      changes.push({
        endpoint: `field: ${removed.name}`,
        change: `Type changed from ${removed.type} to ${changed.type}`,
        type: "type_changed",
        impact: "medium",
      });
    }
  }

  for (const added of parsed.addedFields) {
    const wasExisting = parsed.removedFields.some((r) => r.name === added.name);
    if (!wasExisting) {
      changes.push({
        endpoint: `field: ${added.name}`,
        change: `New required field: ${added.name}: ${added.type}`,
        type: "required_added",
        impact: "medium",
      });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// ApiVersionManager
// ---------------------------------------------------------------------------

export class ApiVersionManager {
  /**
   * Analyze a diff for breaking API changes.
   *
   * Detects:
   * - Removed endpoints
   * - Changed field types
   * - New required fields
   * - Renamed endpoints or fields
   */
  analyzeBreakingChanges(
    projectId: string,
    diff: string
  ): BreakingChangeAnalysis {
    logger.info(
      { projectId, diffLength: diff.length },
      "Analyzing diff for breaking changes"
    );

    const parsed = parseDiffLines(diff);
    const breakingChanges = detectBreakingChanges(parsed);

    // Determine version bump suggestion
    const suggestedVersion = this.suggestVersionBump(breakingChanges);

    // Generate migration guide
    const migrationGuide = this.generateMigrationGuide(breakingChanges);

    logger.info(
      {
        projectId,
        breakingChanges: breakingChanges.length,
        suggestedVersion,
      },
      "Breaking change analysis complete"
    );

    return { breakingChanges, suggestedVersion, migrationGuide };
  }

  /**
   * Generate deprecation notices and middleware for endpoints being
   * phased out.
   */
  generateDeprecationNotices(options: {
    deprecations: DeprecationEntry[];
    projectId: string;
  }): DeprecationResult {
    const { projectId, deprecations } = options;

    logger.info(
      { projectId, deprecationCount: deprecations.length },
      "Generating deprecation notices"
    );

    const notices: DeprecationNotice[] = [];

    for (const dep of deprecations) {
      const code = this.generateDeprecationCode(dep);
      const documentation = this.generateDeprecationDoc(dep);
      notices.push({ code, documentation });
    }

    const headerMiddleware = this.generateDeprecationMiddleware(deprecations);

    logger.info(
      { projectId, noticeCount: notices.length },
      "Deprecation notices generated"
    );

    return { notices, headerMiddleware };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private suggestVersionBump(changes: BreakingChangeEntry[]): string {
    if (changes.length === 0) {
      return "patch"; // No breaking changes — patch bump
    }

    const hasHighImpact = changes.some((c) => c.impact === "high");
    const hasRemovals = changes.some(
      (c) => c.type === "removed" || c.type === "renamed"
    );

    if (hasHighImpact || hasRemovals) {
      return "major"; // Breaking changes — major bump
    }

    return "minor"; // Non-breaking additions
  }

  private generateMigrationGuide(changes: BreakingChangeEntry[]): string {
    if (changes.length === 0) {
      return "No breaking changes detected. No migration required.";
    }

    const lines: string[] = [
      "# API Migration Guide",
      "",
      "## Breaking Changes",
      "",
    ];

    for (const change of changes) {
      lines.push(`### ${change.endpoint}`);
      lines.push("");
      lines.push(`- **Type:** ${change.type}`);
      lines.push(`- **Impact:** ${change.impact}`);
      lines.push(`- **Change:** ${change.change}`);
      lines.push("");

      // Add migration instructions
      switch (change.type) {
        case "removed": {
          lines.push(
            "**Migration:** Remove usage of this endpoint and switch to the recommended alternative."
          );
          break;
        }
        case "renamed": {
          lines.push(
            "**Migration:** Update all references to use the new endpoint path."
          );
          break;
        }
        case "type_changed": {
          lines.push(
            "**Migration:** Update client code to handle the new type."
          );
          break;
        }
        case "required_added": {
          lines.push(
            "**Migration:** Ensure all API calls include the new required field."
          );
          break;
        }
        default: {
          lines.push("**Migration:** Review changes and update client code.");
          break;
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  private generateDeprecationCode(dep: DeprecationEntry): string {
    return [
      "/**",
      ` * @deprecated This endpoint will be removed on ${dep.removalDate}.`,
      ` * Use ${dep.replacement} instead.`,
      " */",
      `// ${dep.endpoint} -> ${dep.replacement}`,
    ].join("\n");
  }

  private generateDeprecationDoc(dep: DeprecationEntry): string {
    return [
      `## Deprecated: ${dep.endpoint}`,
      "",
      `This endpoint is deprecated and will be removed on **${dep.removalDate}**.`,
      "",
      "### Replacement",
      "",
      `Use \`${dep.replacement}\` instead.`,
      "",
      "### Migration Steps",
      "",
      `1. Update your client to call \`${dep.replacement}\``,
      "2. Adjust request/response handling for any API differences",
      `3. Remove references to \`${dep.endpoint}\` before ${dep.removalDate}`,
    ].join("\n");
  }

  private generateDeprecationMiddleware(
    deprecations: DeprecationEntry[]
  ): string {
    const endpointChecks = deprecations
      .map(
        (dep) =>
          `    if (path === "${dep.endpoint}") {\n` +
          `      c.header("X-Deprecated", "true");\n` +
          `      c.header("X-Deprecated-Replacement", "${dep.replacement}");\n` +
          `      c.header("X-Deprecated-Removal-Date", "${dep.removalDate}");\n` +
          "    }"
      )
      .join("\n");

    return [
      `import type { MiddlewareHandler } from "hono";`,
      "",
      "/**",
      " * Middleware that adds X-Deprecated headers to deprecated endpoints.",
      " * Auto-generated by ApiVersionManager.",
      " */",
      "export const deprecationMiddleware: MiddlewareHandler = async (c, next) => {",
      "  const path = new URL(c.req.url).pathname;",
      "",
      endpointChecks,
      "",
      "  await next();",
      "};",
    ].join("\n");
  }
}
