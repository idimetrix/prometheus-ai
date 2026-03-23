import { createLogger } from "@prometheus/logger";
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgSelect, PgTable } from "drizzle-orm/pg-core";
import { type Database, db } from "./client";

const logger = createLogger("db:tenant-isolation");

// ---------------------------------------------------------------------------
// Branded type for org-scoped queries
// ---------------------------------------------------------------------------

/**
 * Branded type that indicates a query has been scoped to a specific org.
 * This prevents accidentally forgetting the org_id filter on tenant-scoped
 * queries. The brand is a compile-time-only marker.
 */
declare const OrgScopedBrand: unique symbol;

export type OrgScopedQuery<T> = T & { readonly [OrgScopedBrand]: true };

/**
 * Mark a value as org-scoped. Use this after verifying the org_id filter
 * has been applied. This is a type-level assertion only; no runtime cost.
 */
export function markOrgScoped<T>(value: T): OrgScopedQuery<T> {
  return value as OrgScopedQuery<T>;
}

// ---------------------------------------------------------------------------
// withOrgScope: wraps queries with org_id filter
// ---------------------------------------------------------------------------

export interface OrgScopeOptions {
  /** Optional database instance (defaults to the shared db) */
  database?: Database;
  /** The organization ID to scope queries to */
  orgId: string;
}

/**
 * Create an org-scoped query helper that automatically applies org_id
 * filters to all queries. Returns a set of helper functions that enforce
 * tenant isolation at the query level.
 *
 * @example
 * ```ts
 * const scoped = withOrgScope({ orgId: ctx.orgId });
 * const tasks = await scoped.findMany(tasks, eq(tasks.status, 'active'));
 * const [task] = await scoped.select(tasks).where(eq(tasks.id, taskId));
 * ```
 */
export function withOrgScope(options: OrgScopeOptions) {
  const { orgId, database } = options;
  const dbInstance = database ?? db;

  return {
    orgId,

    /**
     * Create an org_id equality condition for use in WHERE clauses.
     */
    orgFilter<T extends PgTable & { orgId: PgColumn }>(table: T): SQL {
      return eq(table.orgId, orgId);
    },

    /**
     * Combine an org_id filter with additional conditions.
     */
    scopedWhere<T extends PgTable & { orgId: PgColumn }>(
      table: T,
      ...conditions: (SQL | undefined)[]
    ): SQL {
      const validConditions = conditions.filter(
        (c): c is SQL => c !== undefined
      );
      return and(eq(table.orgId, orgId), ...validConditions) as SQL;
    },

    /**
     * Execute a SELECT query scoped to the org.
     * Returns the Drizzle query builder with the org_id filter pre-applied.
     */
    select<T extends PgTable & { orgId: PgColumn }>(table: T) {
      return markOrgScoped(
        dbInstance
          .select()
          .from(table as PgTable)
          .where(eq(table.orgId, orgId))
      );
    },

    /**
     * Execute a findMany using Drizzle's query API with org_id scoping.
     */
    async findMany<T extends PgTable & { orgId: PgColumn }>(
      table: T,
      extraCondition?: SQL,
      queryOptions?: { limit?: number; offset?: number; orderBy?: SQL }
    ): Promise<OrgScopedQuery<Record<string, unknown>[]>> {
      const where = extraCondition
        ? and(eq(table.orgId, orgId), extraCondition)
        : eq(table.orgId, orgId);

      let query = dbInstance
        .select()
        .from(table as PgTable)
        .where(where) as unknown as PgSelect;

      if (queryOptions?.limit) {
        query = query.limit(queryOptions.limit) as unknown as PgSelect;
      }
      if (queryOptions?.offset) {
        query = query.offset(queryOptions.offset) as unknown as PgSelect;
      }
      if (queryOptions?.orderBy) {
        query = query.orderBy(queryOptions.orderBy) as unknown as PgSelect;
      }

      const results = await query;
      return markOrgScoped(results as Record<string, unknown>[]);
    },

    /**
     * Execute a findFirst using Drizzle's query API with org_id scoping.
     */
    async findFirst<T extends PgTable & { orgId: PgColumn }>(
      table: T,
      extraCondition?: SQL
    ): Promise<OrgScopedQuery<Record<string, unknown> | undefined>> {
      const where = extraCondition
        ? and(eq(table.orgId, orgId), extraCondition)
        : eq(table.orgId, orgId);

      const [result] = await dbInstance
        .select()
        .from(table as PgTable)
        .where(where)
        .limit(1);

      return markOrgScoped(result as Record<string, unknown> | undefined);
    },

    /**
     * Execute an UPDATE query scoped to the org.
     * Automatically adds org_id to the WHERE clause.
     */
    update<T extends PgTable & { orgId: PgColumn }>(
      table: T,
      values: Record<string, unknown>,
      extraCondition?: SQL
    ) {
      const where = extraCondition
        ? and(eq(table.orgId, orgId), extraCondition)
        : eq(table.orgId, orgId);

      return markOrgScoped(dbInstance.update(table).set(values).where(where));
    },

    /**
     * Execute a DELETE query scoped to the org.
     * Automatically adds org_id to the WHERE clause.
     */
    delete<T extends PgTable & { orgId: PgColumn }>(
      table: T,
      extraCondition?: SQL
    ) {
      const where = extraCondition
        ? and(eq(table.orgId, orgId), extraCondition)
        : eq(table.orgId, orgId);

      return markOrgScoped(dbInstance.delete(table).where(where));
    },
  };
}

// ---------------------------------------------------------------------------
// Query verification helpers
// ---------------------------------------------------------------------------

/** List of tables that require org_id scoping */
const TENANT_SCOPED_TABLES = new Set([
  "credit_transactions",
  "credit_balances",
  "credit_reservations",
  "subscriptions",
  "tasks",
  "sessions",
  "projects",
  "model_usage",
  "model_usage_logs",
  "usage_rollups",
  "agents",
  "api_keys",
  "blueprints",
  "code_reviews",
  "workflow_checkpoints",
  "workflow_events",
]);

/**
 * Verify that a SQL query string includes an org_id filter.
 * This is a development-time safety check that can be used in tests
 * or middleware to catch unscoped queries.
 *
 * @returns true if the query contains an org_id filter
 */
export function verifyOrgIdInQuery(queryString: string): boolean {
  // Check for org_id in WHERE clause (common patterns)
  const hasOrgId =
    queryString.includes("org_id") || queryString.includes('"org_id"');
  return hasOrgId;
}

/**
 * Check if a table name requires org_id scoping.
 */
export function requiresOrgScope(tableName: string): boolean {
  return TENANT_SCOPED_TABLES.has(tableName);
}

/**
 * Development helper: log a warning if a query on a tenant-scoped table
 * is missing the org_id filter. Use this in middleware or test utilities.
 */
export function warnIfMissingScopeFilter(
  tableName: string,
  queryString: string
): void {
  if (requiresOrgScope(tableName) && !verifyOrgIdInQuery(queryString)) {
    logger.warn(
      { tableName },
      "Query on tenant-scoped table missing org_id filter"
    );
  }
}
