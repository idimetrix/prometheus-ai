/**
 * Phase 8.1: Convention Memory Layer.
 * Backed by the project_conventions table.
 * Auto-extraction on batch index completion, with confidence scoring
 * that increases/decreases with confirming/contradicting files.
 */
import { db, projectConventions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";

const logger = createLogger("project-brain:convention-memory");

export interface Convention {
  category: string;
  confidence: number;
  description: string;
  examples: unknown[];
  fileCount: number;
  id: string;
  pattern: string;
  projectId: string;
}

export class ConventionMemoryLayer {
  /**
   * Store or update a convention for a project.
   */
  async store(
    projectId: string,
    data: {
      category: string;
      pattern: string;
      description: string;
      confidence?: number;
      fileCount?: number;
      examples?: unknown[];
    }
  ): Promise<Convention> {
    // Check if convention with this pattern already exists
    const existing = await db
      .select()
      .from(projectConventions)
      .where(
        and(
          eq(projectConventions.projectId, projectId),
          eq(projectConventions.pattern, data.pattern)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const record = existing[0] as NonNullable<(typeof existing)[0]>;
      // Update confidence and file count
      const newConfidence = Math.min(1.0, (record.confidence ?? 0.5) + 0.05);
      const newFileCount = (record.fileCount ?? 0) + (data.fileCount ?? 1);

      await db
        .update(projectConventions)
        .set({
          confidence: newConfidence,
          fileCount: newFileCount,
          examples: data.examples ?? record.examples,
          updatedAt: new Date(),
        })
        .where(eq(projectConventions.id, record.id));

      return {
        id: record.id,
        projectId,
        category: record.category ?? "other",
        pattern: record.pattern,
        description: record.description,
        confidence: newConfidence,
        fileCount: newFileCount,
        examples: (data.examples ?? record.examples ?? []) as unknown[],
      };
    }

    const id = generateId("conv");
    await db.insert(projectConventions).values({
      id,
      projectId,
      category: data.category as
        | "naming"
        | "structure"
        | "imports"
        | "error_handling"
        | "testing"
        | "styling"
        | "api"
        | "database"
        | "other",
      pattern: data.pattern,
      description: data.description,
      confidence: data.confidence ?? 0.5,
      fileCount: data.fileCount ?? 1,
      examples: data.examples ?? [],
    });

    return {
      id,
      projectId,
      category: data.category,
      pattern: data.pattern,
      description: data.description,
      confidence: data.confidence ?? 0.5,
      fileCount: data.fileCount ?? 1,
      examples: data.examples ?? [],
    };
  }

  /**
   * Get all conventions for a project, optionally filtered by category.
   */
  async list(projectId: string, category?: string): Promise<Convention[]> {
    const conditions = [eq(projectConventions.projectId, projectId)];
    if (category) {
      conditions.push(
        eq(
          projectConventions.category,
          category as
            | "naming"
            | "structure"
            | "imports"
            | "error_handling"
            | "testing"
            | "styling"
            | "api"
            | "database"
            | "other"
        )
      );
    }

    const results = await db
      .select()
      .from(projectConventions)
      .where(and(...conditions));

    return results.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      category: r.category ?? "other",
      pattern: r.pattern,
      description: r.description,
      confidence: r.confidence ?? 0.5,
      fileCount: r.fileCount ?? 0,
      examples: (r.examples ?? []) as unknown[],
    }));
  }

  /**
   * Decrease confidence when a file contradicts a convention.
   */
  async contradict(projectId: string, pattern: string): Promise<void> {
    const existing = await db
      .select()
      .from(projectConventions)
      .where(
        and(
          eq(projectConventions.projectId, projectId),
          eq(projectConventions.pattern, pattern)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const record = existing[0] as NonNullable<(typeof existing)[0]>;
      const newConfidence = Math.max(0, (record.confidence ?? 0.5) - 0.1);

      await db
        .update(projectConventions)
        .set({ confidence: newConfidence, updatedAt: new Date() })
        .where(eq(projectConventions.id, record.id));

      logger.debug(
        { projectId, pattern, newConfidence },
        "Convention confidence decreased"
      );
    }
  }

  /**
   * Build a conventions prompt for context injection.
   */
  async buildPrompt(projectId: string, maxTokens = 1000): Promise<string> {
    const conventions = await this.list(projectId);

    // Filter to high-confidence conventions
    const highConfidence = conventions
      .filter((c) => c.confidence >= 0.6)
      .sort((a, b) => b.confidence - a.confidence);

    if (highConfidence.length === 0) {
      return "";
    }

    const parts: string[] = ["## Project Conventions"];
    let usedChars = 0;
    const maxChars = maxTokens * 4;

    for (const conv of highConfidence) {
      const entry = `- **[${conv.category}]** ${conv.description} (pattern: \`${conv.pattern}\`, confidence: ${(conv.confidence * 100).toFixed(0)}%, seen in ${conv.fileCount} files)`;
      if (usedChars + entry.length > maxChars) {
        break;
      }
      parts.push(entry);
      usedChars += entry.length;
    }

    return parts.join("\n");
  }
}
