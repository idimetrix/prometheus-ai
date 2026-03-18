import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("project-brain:domain-knowledge");

const WHITESPACE_RE = /\s+/;

export interface DomainEntry {
  category: string;
  content: string;
  contributedBy?: string;
  createdAt: Date;
  framework?: string;
  id: string;
  tags: string[];
  topic: string;
}

const TECH_STACK_KNOWLEDGE: Record<string, DomainEntry[]> = {
  "next.js": [
    {
      id: "dk_nextjs_1",
      category: "framework",
      topic: "App Router Conventions",
      content:
        "Next.js App Router uses file-based routing in the app/ directory. page.tsx for pages, layout.tsx for layouts, loading.tsx for loading states, error.tsx for error boundaries. Server Components by default, use 'use client' for client components.",
      framework: "next.js",
      tags: ["routing", "app-router", "conventions"],
      createdAt: new Date(),
    },
    {
      id: "dk_nextjs_2",
      category: "framework",
      topic: "Server Actions",
      content:
        "Server Actions are async functions that run on the server. Define with 'use server' directive. Can be used in forms and event handlers. Automatically handle loading/error states with useFormStatus/useFormState.",
      framework: "next.js",
      tags: ["server-actions", "forms"],
      createdAt: new Date(),
    },
  ],
  trpc: [
    {
      id: "dk_trpc_1",
      category: "api",
      topic: "tRPC Router Patterns",
      content:
        "tRPC v11 uses router() and procedure builders. Use protectedProcedure for auth-required routes. Input validation via .input(zodSchema). Queries for reads, mutations for writes. Subscriptions for real-time.",
      framework: "trpc",
      tags: ["api", "router", "procedures"],
      createdAt: new Date(),
    },
  ],
  drizzle: [
    {
      id: "dk_drizzle_1",
      category: "orm",
      topic: "Drizzle Query Patterns",
      content:
        "Drizzle ORM uses a SQL-like query builder. Use db.select().from(table).where(condition). For inserts: db.insert(table).values(data).returning(). Always use .returning() to get results. Use eq(), and(), or() for conditions.",
      framework: "drizzle",
      tags: ["database", "queries", "orm"],
      createdAt: new Date(),
    },
  ],
  postgresql: [
    {
      id: "dk_pg_1",
      category: "database",
      topic: "PostgreSQL Best Practices",
      content:
        "Use pgvector for embeddings (vector type with cosine similarity). Always add indexes for WHERE/ORDER BY columns. Use HNSW index for vector search. Use transactions for multi-table operations. Use FOR UPDATE for row-level locking.",
      framework: "postgresql",
      tags: ["database", "indexing", "pgvector"],
      createdAt: new Date(),
    },
  ],
  bullmq: [
    {
      id: "dk_bullmq_1",
      category: "queue",
      topic: "BullMQ Job Processing",
      content:
        "BullMQ uses Redis for job queuing. Define queues with new Queue(name, opts). Process with new Worker(name, handler). Jobs have: id, data, opts (priority, attempts, backoff). Use job.progress() for progress tracking. DLQ for failed jobs after max attempts.",
      framework: "bullmq",
      tags: ["queue", "jobs", "redis"],
      createdAt: new Date(),
    },
  ],
};

/**
 * DomainKnowledgeLayer provides framework-specific knowledge, API docs,
 * common patterns, and gotchas. Pre-seeded from tech stack when blueprint
 * is created, and agents can contribute new entries.
 */
export class DomainKnowledgeLayer {
  private readonly projectEntries = new Map<string, DomainEntry[]>();

  /**
   * Pre-seed domain knowledge from a tech stack.
   */
  seedFromTechStack(
    projectId: string,
    techStack: Record<string, string>
  ): number {
    const entries: DomainEntry[] = [];

    for (const [_category, technology] of Object.entries(techStack)) {
      const techLower = technology.toLowerCase();

      for (const [key, knowledge] of Object.entries(TECH_STACK_KNOWLEDGE)) {
        if (techLower.includes(key)) {
          entries.push(...knowledge);
        }
      }
    }

    // Deduplicate by ID
    const existing = this.projectEntries.get(projectId) ?? [];
    const existingIds = new Set(existing.map((e) => e.id));
    const newEntries = entries.filter((e) => !existingIds.has(e.id));

    this.projectEntries.set(projectId, [...existing, ...newEntries]);

    logger.info(
      {
        projectId,
        seeded: newEntries.length,
        total: existing.length + newEntries.length,
      },
      "Domain knowledge seeded from tech stack"
    );

    return newEntries.length;
  }

  /**
   * Add a domain knowledge entry contributed by an agent.
   */
  contribute(
    projectId: string,
    entry: Omit<DomainEntry, "id" | "createdAt">
  ): DomainEntry {
    const full: DomainEntry = {
      ...entry,
      id: generateId("dk"),
      createdAt: new Date(),
    };

    const entries = this.projectEntries.get(projectId) ?? [];
    entries.push(full);
    this.projectEntries.set(projectId, entries);

    logger.info(
      { projectId, topic: entry.topic, category: entry.category },
      "Domain knowledge contributed"
    );

    return full;
  }

  /**
   * Query domain knowledge relevant to a task.
   */
  query(projectId: string, queryText: string, limit = 5): DomainEntry[] {
    const entries = this.projectEntries.get(projectId) ?? [];
    if (entries.length === 0) {
      return [];
    }

    const queryLower = queryText.toLowerCase();
    const queryWords = queryLower
      .split(WHITESPACE_RE)
      .filter((w) => w.length > 2);

    // Score each entry by relevance
    const scored = entries.map((entry) => {
      let score = 0;
      const entryText =
        `${entry.topic} ${entry.content} ${entry.tags.join(" ")}`.toLowerCase();

      for (const word of queryWords) {
        if (entryText.includes(word)) {
          score += 1;
        }
      }

      // Boost exact topic matches
      if (entry.topic.toLowerCase().includes(queryLower)) {
        score += 3;
      }

      // Boost tag matches
      for (const tag of entry.tags) {
        if (queryLower.includes(tag)) {
          score += 2;
        }
      }

      return { entry, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  /**
   * Build context string for injection into agent prompts.
   */
  buildContext(projectId: string, query: string, maxTokens = 700): string {
    const relevant = this.query(projectId, query, 5);
    if (relevant.length === 0) {
      return "";
    }

    const parts: string[] = ["## Domain Knowledge"];
    let usedChars = 0;
    const maxChars = maxTokens * 4;

    for (const entry of relevant) {
      const section = `\n### ${entry.topic}\n${entry.content}`;
      if (usedChars + section.length > maxChars) {
        break;
      }
      parts.push(section);
      usedChars += section.length;
    }

    return parts.join("\n");
  }

  /**
   * Get all entries for a project.
   */
  getAll(projectId: string): DomainEntry[] {
    return this.projectEntries.get(projectId) ?? [];
  }
}
