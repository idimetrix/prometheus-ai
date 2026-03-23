/**
 * Phase 7.15: Memory Export/Import.
 *
 * Export project memories as portable JSON bundles.
 * Import from JSON bundles for project templates.
 * Includes starter packs for common stacks.
 */
import { agentMemories, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";

const logger = createLogger("project-brain:memory-export");

export interface MemoryBundle {
  exportedAt: string;
  memories: ExportedMemory[];
  metadata: {
    projectId: string;
    totalCount: number;
    version: string;
  };
}

export interface ExportedMemory {
  content: string;
  createdAt: string;
  memoryType: string;
  tags?: string[];
}

/**
 * Export all memories for a project as a portable JSON bundle.
 */
export async function exportMemories(projectId: string): Promise<MemoryBundle> {
  const rows = await db
    .select({
      content: agentMemories.content,
      memoryType: agentMemories.memoryType,
      createdAt: agentMemories.createdAt,
    })
    .from(agentMemories)
    .where(eq(agentMemories.projectId, projectId));

  const memories: ExportedMemory[] = rows.map((r) => ({
    content: r.content,
    memoryType: r.memoryType,
    createdAt: r.createdAt.toISOString(),
  }));

  const bundle: MemoryBundle = {
    metadata: {
      projectId,
      totalCount: memories.length,
      version: "1.0.0",
    },
    memories,
    exportedAt: new Date().toISOString(),
  };

  logger.info({ projectId, count: memories.length }, "Memories exported");

  return bundle;
}

/**
 * Import memories from a JSON bundle into a project.
 * Skips duplicates based on content matching.
 */
export async function importMemories(
  projectId: string,
  bundle: MemoryBundle
): Promise<void> {
  let imported = 0;
  let skipped = 0;

  // Get existing memory contents for dedup
  const existing = await db
    .select({ content: agentMemories.content })
    .from(agentMemories)
    .where(eq(agentMemories.projectId, projectId));

  const existingContents = new Set(existing.map((e) => e.content));

  for (const mem of bundle.memories) {
    if (existingContents.has(mem.content)) {
      skipped++;
      continue;
    }

    await db.insert(agentMemories).values({
      id: generateId("mem"),
      projectId,
      memoryType: mem.memoryType as
        | "semantic"
        | "episodic"
        | "procedural"
        | "convention",
      content: mem.content,
      createdAt: new Date(mem.createdAt),
    });

    imported++;
  }

  logger.info(
    { projectId, imported, skipped, total: bundle.memories.length },
    "Memories imported from bundle"
  );
}

/**
 * Get a starter pack memory bundle for common stacks.
 */
export function getStarterPack(
  stack: "nextjs" | "express" | "fastapi"
): MemoryBundle {
  const packs: Record<string, ExportedMemory[]> = {
    nextjs: [
      {
        content:
          "Use App Router (app/) directory structure with layout.tsx for shared layouts",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Prefer Server Components by default, use 'use client' only when needed for interactivity",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Use next/image for optimized image loading, next/link for client-side navigation",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Data fetching in Server Components using async/await, no useEffect for initial data",
        memoryType: "procedural",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Use loading.tsx and error.tsx for automatic loading/error states per route segment",
        memoryType: "procedural",
        createdAt: new Date().toISOString(),
      },
    ],
    express: [
      {
        content:
          "Organize routes in /routes directory with router.use() for mounting",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Use middleware chain: cors -> helmet -> rateLimit -> auth -> routes -> errorHandler",
        memoryType: "procedural",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Centralized error handling with custom AppError class extending Error",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Validate request bodies with Zod schemas in middleware before route handlers",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
    ],
    fastapi: [
      {
        content:
          "Use Pydantic models for request/response validation and serialization",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Organize routers in /routers directory, include with app.include_router()",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Use dependency injection with Depends() for auth, db sessions, and shared logic",
        memoryType: "procedural",
        createdAt: new Date().toISOString(),
      },
      {
        content:
          "Async endpoints with async def for I/O-bound operations, def for CPU-bound",
        memoryType: "convention",
        createdAt: new Date().toISOString(),
      },
    ],
  };

  const memories = packs[stack] ?? [];

  return {
    metadata: {
      projectId: "starter-pack",
      totalCount: memories.length,
      version: "1.0.0",
    },
    memories,
    exportedAt: new Date().toISOString(),
  };
}
