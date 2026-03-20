/**
 * Phase 7.1: HNSW Index Tuning Migration.
 *
 * Recreates HNSW indexes with tuned parameters for better recall/performance:
 * - m=16 (connections per layer, default is 16 but we set explicitly)
 * - ef_construction=200 (build-time search depth, default 64)
 * - SET hnsw.ef_search=100 (query-time search depth, default 40)
 *
 * Applied to code_embeddings and agent_memories tables.
 */

/** Returns SQL statements to recreate HNSW indexes with tuned parameters. */
export function tuneHNSWIndexes(): string[] {
  return [
    // Session-level search quality parameter
    "SET hnsw.ef_search = 100",

    // ── code_embeddings indexes ─────────────────────────────────────
    "DROP INDEX IF EXISTS code_embeddings_embedding_idx",
    `CREATE INDEX code_embeddings_embedding_idx
       ON code_embeddings
       USING hnsw (embedding vector_cosine_ops)
       WITH (m = 16, ef_construction = 200)`,

    "DROP INDEX IF EXISTS code_embeddings_embedding_1024_idx",
    `CREATE INDEX code_embeddings_embedding_1024_idx
       ON code_embeddings
       USING hnsw (embedding_1024 vector_cosine_ops)
       WITH (m = 16, ef_construction = 200)`,

    "DROP INDEX IF EXISTS code_embeddings_embedding_256_idx",
    `CREATE INDEX code_embeddings_embedding_256_idx
       ON code_embeddings
       USING hnsw (embedding_256 vector_cosine_ops)
       WITH (m = 16, ef_construction = 200)`,

    // ── agent_memories indexes ──────────────────────────────────────
    "DROP INDEX IF EXISTS agent_memories_embedding_idx",
    `CREATE INDEX agent_memories_embedding_idx
       ON agent_memories
       USING hnsw (embedding vector_cosine_ops)
       WITH (m = 16, ef_construction = 200)`,

    "DROP INDEX IF EXISTS agent_memories_embedding_1024_idx",
    `CREATE INDEX agent_memories_embedding_1024_idx
       ON agent_memories
       USING hnsw (embedding_1024 vector_cosine_ops)
       WITH (m = 16, ef_construction = 200)`,
  ];
}

/**
 * Run the HNSW tuning migration.
 * Returns the SQL statements for use in a Drizzle custom migration
 * or direct execution via `db.execute(sql.raw(...))`.
 */
export function getHNSWTuningMigrationSQL(): string {
  return tuneHNSWIndexes().join(";\n");
}
