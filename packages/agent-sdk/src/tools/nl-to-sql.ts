/**
 * GAP-077: Natural Language Database Queries
 *
 * Converts natural language to SQL, validates query safety
 * (read-only, no mutations), executes and formats results.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("agent-sdk:nl-to-sql");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NLQueryResult {
  executionMs: number;
  results: Record<string, unknown>[];
  rowCount: number;
  safe: boolean;
  sql: string;
}

export interface SchemaInfo {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
  }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DANGEROUS_KEYWORDS = [
  "DROP",
  "DELETE",
  "TRUNCATE",
  "ALTER",
  "INSERT",
  "UPDATE",
  "CREATE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
];

const SAFE_QUERY_RE = /^\s*SELECT\b/i;

// ─── NL-to-SQL Converter ─────────────────────────────────────────────────────

export class NLToSQLConverter {
  private readonly modelRouterUrl: string;
  private readonly schema: SchemaInfo;

  constructor(
    schema: SchemaInfo,
    modelRouterUrl: string = process.env.MODEL_ROUTER_URL ??
      "http://localhost:4004"
  ) {
    this.schema = schema;
    this.modelRouterUrl = modelRouterUrl;
  }

  /**
   * Convert a natural language question to a safe SQL query.
   */
  async convert(question: string): Promise<string> {
    const schemaContext = this.schema.tables
      .map(
        (t) =>
          `${t.name}(${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`
      )
      .join("\n");

    const systemPrompt = `You are a SQL query generator. Given the database schema below, convert the user's natural language question into a SELECT query.

Schema:
${schemaContext}

Rules:
- ONLY generate SELECT queries (read-only)
- Never generate DROP, DELETE, INSERT, UPDATE, or other mutation queries
- Use proper table and column names from the schema
- Add LIMIT 100 if no limit is specified
- Output ONLY the SQL query, no explanation`;

    try {
      const response = await fetch(
        `${this.modelRouterUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "default",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: question },
            ],
            max_tokens: 500,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!response.ok) {
        throw new Error(`Model router returned ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const sql = (data.choices?.[0]?.message?.content ?? "").trim();

      logger.info(
        { question: question.slice(0, 80), sqlLength: sql.length },
        "NL-to-SQL conversion completed"
      );

      return sql;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "NL-to-SQL conversion failed");
      throw new Error(`NL-to-SQL conversion failed: ${msg}`);
    }
  }

  /**
   * Validate that a SQL query is safe (read-only).
   */
  validateSafety(sql: string): { safe: boolean; reason?: string } {
    const upperSQL = sql.toUpperCase();

    for (const keyword of DANGEROUS_KEYWORDS) {
      if (upperSQL.includes(keyword)) {
        return {
          safe: false,
          reason: `Query contains dangerous keyword: ${keyword}`,
        };
      }
    }

    if (!SAFE_QUERY_RE.test(sql)) {
      return {
        safe: false,
        reason: "Query does not start with SELECT",
      };
    }

    return { safe: true };
  }

  /**
   * Full pipeline: convert NL to SQL and validate safety.
   */
  async processQuestion(
    question: string
  ): Promise<{ sql: string; safe: boolean; reason?: string }> {
    const sql = await this.convert(question);
    const safety = this.validateSafety(sql);
    return { sql, ...safety };
  }
}
