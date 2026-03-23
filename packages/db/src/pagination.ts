import { and, gt, lt, type SQL } from "drizzle-orm";
import type { PgColumn, PgSelect } from "drizzle-orm/pg-core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CursorPaginationOptions {
  /** Cursor value (typically an encoded ID or timestamp) */
  cursor?: string | null;
  /** Sort direction (default: "desc") */
  direction?: "asc" | "desc";
  /** Number of items to return (default: 20, max: 100) */
  limit?: number;
}

export interface CursorPaginatedResult<T> {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ─── Cursor Encoding ──────────────────────────────────────────────────────────

/**
 * Encode a cursor value to a base64 string.
 */
export function encodeCursor(value: string | number | Date): string {
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return Buffer.from(raw).toString("base64url");
}

/**
 * Decode a base64url cursor to a string.
 */
export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, "base64url").toString("utf8");
}

// ─── Cursor Pagination Helper ─────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Apply cursor-based pagination to a Drizzle query.
 *
 * Works with any Drizzle PgSelect query. The cursor column should be
 * a unique, ordered column (e.g., `createdAt`, `id`).
 *
 * @example
 * ```ts
 * const result = await cursorPaginate(
 *   db.select().from(sessions).where(eq(sessions.orgId, orgId)),
 *   sessions.createdAt,
 *   { cursor: req.cursor, limit: 20, direction: "desc" }
 * );
 * ```
 */
export async function cursorPaginate<T extends Record<string, unknown>>(
  query: PgSelect,
  cursorColumn: PgColumn,
  options: CursorPaginationOptions = {}
): Promise<CursorPaginatedResult<T>> {
  const limit = Math.min(
    Math.max(1, options.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT
  );
  const direction = options.direction ?? "desc";

  // Build conditions
  const conditions: SQL[] = [];

  if (options.cursor) {
    const cursorValue = decodeCursor(options.cursor);
    if (direction === "desc") {
      conditions.push(lt(cursorColumn, cursorValue));
    } else {
      conditions.push(gt(cursorColumn, cursorValue));
    }
  }

  // Apply cursor filter and limit + 1 (to detect hasMore)
  let q = query.limit(limit + 1);

  if (conditions.length > 0) {
    q = q.where(and(...conditions)) as typeof q;
  }

  const rows = (await q) as T[];

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  // Extract next cursor from the last item
  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const lastItem = data.at(-1);
    if (lastItem) {
      // Use the cursor column's key name to extract the value
      const columnName = cursorColumn.name;
      const lastValue = lastItem[columnName];
      if (lastValue !== undefined && lastValue !== null) {
        nextCursor = encodeCursor(
          lastValue instanceof Date ? lastValue : String(lastValue)
        );
      }
    }
  }

  return { data, nextCursor, hasMore };
}
