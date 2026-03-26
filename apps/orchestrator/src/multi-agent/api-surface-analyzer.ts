/**
 * API Surface Analyzer
 *
 * Extracts API surface from repositories (exported functions, REST endpoints,
 * GraphQL schemas), compares surfaces before and after changes, and detects
 * breaking changes across multiple repos.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:api-surface-analyzer");

// ─── Types ──────────────────────────────────────────────────────────────────────

export type EndpointMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ExportedFunction {
  /** Module path relative to repo root */
  filePath: string;
  name: string;
  /** Stringified TypeScript signature, e.g. `(id: string) => Promise<User>` */
  signature: string;
}

export interface RestEndpoint {
  method: EndpointMethod;
  /** Request body schema hint (e.g. Zod validator name) */
  requestSchema?: string;
  /** Response schema hint */
  responseSchema?: string;
  route: string;
}

export interface GraphQLField {
  fieldName: string;
  /** "query" | "mutation" | "subscription" */
  operationType: string;
  returnType: string;
}

export interface APISurface {
  exports: ExportedFunction[];
  graphql: GraphQLField[];
  repoId: string;
  rest: RestEndpoint[];
  /** SHA or ref the surface was extracted from */
  snapshotRef: string;
}

export interface BreakingChange {
  detail: string;
  kind:
    | "removed_export"
    | "changed_signature"
    | "removed_endpoint"
    | "changed_endpoint"
    | "removed_graphql_field"
    | "changed_graphql_field";
  repoId: string;
  severity: "warning" | "error";
}

export interface SurfaceDiff {
  addedEndpoints: RestEndpoint[];
  addedExports: ExportedFunction[];
  addedGraphQLFields: GraphQLField[];
  breakingChanges: BreakingChange[];
  removedEndpoints: RestEndpoint[];
  removedExports: ExportedFunction[];
  removedGraphQLFields: GraphQLField[];
  repoId: string;
}

// ─── Extraction helpers ─────────────────────────────────────────────────────────

/** Regex patterns used to extract API surface from source code */
const PATTERNS = {
  /** Matches `export function name(` or `export const name =` or `export async function name(` */
  exportedFunction:
    /export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)\s*[=(]/g,
  /** Matches tRPC-style `.query(` / `.mutation(` definitions */
  trpcRoute: /\.(\w+)\s*=\s*\w+\.(query|mutation)\(/g,
  /** Matches express/hono-style route definitions: router.get("/path", ...) */
  restRoute: /\.(get|post|put|patch|delete)\s*\(\s*["'`](\/[^"'`]*)["'`]/gi,
  /** Matches GraphQL `type Query { fieldName: ReturnType }` etc. */
  graphqlField: /type\s+(Query|Mutation|Subscription)\s*\{([^}]+)\}/gs,
  /** Individual field inside a GraphQL type block */
  graphqlFieldEntry: /(\w+)\s*(?:\([^)]*\))?\s*:\s*([^\n!]+!?)/g,
  /** Matches Zod schema references in route handlers */
  zodSchema: /(?:input|body|query)\s*\(\s*(\w+)/g,
};

/**
 * Extract exported functions from TypeScript / JavaScript source content.
 */
export function extractExports(
  filePath: string,
  content: string
): ExportedFunction[] {
  const results: ExportedFunction[] = [];
  const regex = new RegExp(PATTERNS.exportedFunction.source, "g");
  let match: RegExpExecArray | null = regex.exec(content);

  while (match !== null) {
    const name = match[1];
    if (name) {
      // Grab a rough signature: the line containing the match
      const lineStart = content.lastIndexOf("\n", match.index) + 1;
      const lineEnd = content.indexOf("\n", match.index);
      const line = content.slice(
        lineStart,
        lineEnd === -1 ? undefined : lineEnd
      );

      results.push({
        name,
        filePath,
        signature: line.trim(),
      });
    }
    match = regex.exec(content);
  }

  return results;
}

/**
 * Extract REST endpoint definitions from source content.
 */
export function extractRestEndpoints(content: string): RestEndpoint[] {
  const results: RestEndpoint[] = [];
  const regex = new RegExp(PATTERNS.restRoute.source, "gi");
  let match: RegExpExecArray | null = regex.exec(content);

  while (match !== null) {
    const method = (match[1]?.toUpperCase() ?? "GET") as EndpointMethod;
    const route = match[2] ?? "/";
    results.push({ method, route });
    match = regex.exec(content);
  }

  // Also detect tRPC-style routes
  const trpcRegex = new RegExp(PATTERNS.trpcRoute.source, "g");
  let trpcMatch: RegExpExecArray | null = trpcRegex.exec(content);

  while (trpcMatch !== null) {
    const routeName = trpcMatch[1] ?? "unknown";
    const type = trpcMatch[2] ?? "query";
    const method: EndpointMethod = type === "mutation" ? "POST" : "GET";
    results.push({ method, route: `/trpc/${routeName}` });
    trpcMatch = trpcRegex.exec(content);
  }

  return results;
}

/**
 * Extract GraphQL field definitions from source content.
 */
export function extractGraphQLFields(content: string): GraphQLField[] {
  const results: GraphQLField[] = [];
  const typeRegex = new RegExp(PATTERNS.graphqlField.source, "gs");
  let typeMatch: RegExpExecArray | null = typeRegex.exec(content);

  while (typeMatch !== null) {
    const operationType = (typeMatch[1] ?? "Query").toLowerCase();
    const body = typeMatch[2] ?? "";

    const fieldRegex = new RegExp(PATTERNS.graphqlFieldEntry.source, "g");
    let fieldMatch: RegExpExecArray | null = fieldRegex.exec(body);

    while (fieldMatch !== null) {
      const fieldName = fieldMatch[1] ?? "unknown";
      const returnType = fieldMatch[2]?.trim() ?? "unknown";
      results.push({ operationType, fieldName, returnType });
      fieldMatch = fieldRegex.exec(body);
    }

    typeMatch = typeRegex.exec(content);
  }

  return results;
}

// ─── Comparison helpers ─────────────────────────────────────────────────────────

function diffExports(
  before: APISurface,
  after: APISurface
): {
  added: ExportedFunction[];
  removed: ExportedFunction[];
  breaking: BreakingChange[];
} {
  const beforeMap = new Map(
    before.exports.map((e) => [`${e.filePath}::${e.name}`, e])
  );
  const afterMap = new Map(
    after.exports.map((e) => [`${e.filePath}::${e.name}`, e])
  );

  const removed: ExportedFunction[] = [];
  const added: ExportedFunction[] = [];
  const breaking: BreakingChange[] = [];

  for (const [key, exp] of beforeMap) {
    const afterExp = afterMap.get(key);
    if (!afterExp) {
      removed.push(exp);
      breaking.push({
        kind: "removed_export",
        repoId: before.repoId,
        detail: `Export "${exp.name}" removed from ${exp.filePath}`,
        severity: "error",
      });
    } else if (afterExp.signature !== exp.signature) {
      breaking.push({
        kind: "changed_signature",
        repoId: before.repoId,
        detail: `Export "${exp.name}" in ${exp.filePath} signature changed: "${exp.signature}" -> "${afterExp.signature}"`,
        severity: "warning",
      });
    }
  }

  for (const [key] of afterMap) {
    if (!beforeMap.has(key)) {
      const exp = afterMap.get(key);
      if (exp) {
        added.push(exp);
      }
    }
  }

  return { added, removed, breaking };
}

function endpointKey(e: RestEndpoint): string {
  return `${e.method} ${e.route}`;
}

function diffEndpoints(
  before: APISurface,
  after: APISurface
): {
  added: RestEndpoint[];
  removed: RestEndpoint[];
  breaking: BreakingChange[];
} {
  const beforeMap = new Map(before.rest.map((e) => [endpointKey(e), e]));
  const afterMap = new Map(after.rest.map((e) => [endpointKey(e), e]));

  const removed: RestEndpoint[] = [];
  const added: RestEndpoint[] = [];
  const breaking: BreakingChange[] = [];

  for (const [key, ep] of beforeMap) {
    const afterEp = afterMap.get(key);
    if (!afterEp) {
      removed.push(ep);
      breaking.push({
        kind: "removed_endpoint",
        repoId: before.repoId,
        detail: `REST endpoint ${ep.method} ${ep.route} removed`,
        severity: "error",
      });
    } else if (
      afterEp.requestSchema !== ep.requestSchema ||
      afterEp.responseSchema !== ep.responseSchema
    ) {
      breaking.push({
        kind: "changed_endpoint",
        repoId: before.repoId,
        detail: `REST endpoint ${ep.method} ${ep.route} schema changed`,
        severity: "warning",
      });
    }
  }

  for (const [key, ep] of afterMap) {
    if (!beforeMap.has(key)) {
      added.push(ep);
    }
  }

  return { added, removed, breaking };
}

function gqlFieldKey(f: GraphQLField): string {
  return `${f.operationType}.${f.fieldName}`;
}

function diffGraphQL(
  before: APISurface,
  after: APISurface
): {
  added: GraphQLField[];
  removed: GraphQLField[];
  breaking: BreakingChange[];
} {
  const beforeMap = new Map(before.graphql.map((f) => [gqlFieldKey(f), f]));
  const afterMap = new Map(after.graphql.map((f) => [gqlFieldKey(f), f]));

  const removed: GraphQLField[] = [];
  const added: GraphQLField[] = [];
  const breaking: BreakingChange[] = [];

  for (const [key, field] of beforeMap) {
    const afterField = afterMap.get(key);
    if (!afterField) {
      removed.push(field);
      breaking.push({
        kind: "removed_graphql_field",
        repoId: before.repoId,
        detail: `GraphQL ${field.operationType}.${field.fieldName} removed`,
        severity: "error",
      });
    } else if (afterField.returnType !== field.returnType) {
      breaking.push({
        kind: "changed_graphql_field",
        repoId: before.repoId,
        detail: `GraphQL ${field.operationType}.${field.fieldName} return type changed: "${field.returnType}" -> "${afterField.returnType}"`,
        severity: "warning",
      });
    }
  }

  for (const [key, field] of afterMap) {
    if (!beforeMap.has(key)) {
      added.push(field);
    }
  }

  return { added, removed, breaking };
}

// ─── Comparison ─────────────────────────────────────────────────────────────────

/**
 * Compare two API surfaces and detect breaking changes.
 */
export function diffSurfaces(
  before: APISurface,
  after: APISurface
): SurfaceDiff {
  const exportDiff = diffExports(before, after);
  const endpointDiff = diffEndpoints(before, after);
  const graphqlDiff = diffGraphQL(before, after);

  const breakingChanges = [
    ...exportDiff.breaking,
    ...endpointDiff.breaking,
    ...graphqlDiff.breaking,
  ];

  logger.info(
    {
      repoId: before.repoId,
      breakingChanges: breakingChanges.length,
      addedExports: exportDiff.added.length,
      removedExports: exportDiff.removed.length,
      addedEndpoints: endpointDiff.added.length,
      removedEndpoints: endpointDiff.removed.length,
    },
    "API surface diff computed"
  );

  return {
    repoId: before.repoId,
    breakingChanges,
    addedExports: exportDiff.added,
    removedExports: exportDiff.removed,
    addedEndpoints: endpointDiff.added,
    removedEndpoints: endpointDiff.removed,
    addedGraphQLFields: graphqlDiff.added,
    removedGraphQLFields: graphqlDiff.removed,
  };
}

// ─── Full surface builder ───────────────────────────────────────────────────────

/**
 * Build a complete API surface from a map of file paths to file contents.
 */
export function buildAPISurface(
  repoId: string,
  snapshotRef: string,
  files: Map<string, string>
): APISurface {
  const allExports: ExportedFunction[] = [];
  const allRest: RestEndpoint[] = [];
  const allGraphql: GraphQLField[] = [];

  for (const [filePath, content] of files) {
    allExports.push(...extractExports(filePath, content));
    allRest.push(...extractRestEndpoints(content));
    allGraphql.push(...extractGraphQLFields(content));
  }

  logger.info(
    {
      repoId,
      snapshotRef,
      exports: allExports.length,
      restEndpoints: allRest.length,
      graphqlFields: allGraphql.length,
    },
    "API surface built"
  );

  return {
    repoId,
    snapshotRef,
    exports: allExports,
    rest: allRest,
    graphql: allGraphql,
  };
}

/**
 * Validate cross-repo API consistency: check that all consumers reference
 * exports or endpoints that exist in the provider surface.
 *
 * Returns a list of inconsistencies.
 */
export function validateCrossRepoConsistency(
  providerSurface: APISurface,
  consumerImports: Array<{
    repoId: string;
    importedName: string;
    fromModule: string;
  }>
): BreakingChange[] {
  const issues: BreakingChange[] = [];
  const providerExportNames = new Set(
    providerSurface.exports.map((e) => e.name)
  );

  for (const imp of consumerImports) {
    if (!providerExportNames.has(imp.importedName)) {
      issues.push({
        kind: "removed_export",
        repoId: imp.repoId,
        detail: `Consumer repo ${imp.repoId} imports "${imp.importedName}" from "${imp.fromModule}" but provider repo ${providerSurface.repoId} does not export it`,
        severity: "error",
      });
    }
  }

  logger.info(
    {
      providerRepo: providerSurface.repoId,
      consumers: consumerImports.length,
      issues: issues.length,
    },
    "Cross-repo consistency validated"
  );

  return issues;
}
