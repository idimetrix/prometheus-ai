import { db } from "@prometheus/db";
import { proceduralMemories } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { createLogger } from "@prometheus/logger";
import { eq, and } from "drizzle-orm";

const logger = createLogger("project-brain:procedural");

export interface Procedure {
  id: string;
  projectId: string;
  name: string;
  description: string;
  steps: string[];
  lastUsed: Date | null;
}

export class ProceduralLayer {
  async store(
    projectId: string,
    data: {
      name: string;
      description: string;
      steps: string[];
    },
  ): Promise<Procedure> {
    // Upsert: check if a procedure with this name already exists
    const existing = await db
      .select()
      .from(proceduralMemories)
      .where(
        and(
          eq(proceduralMemories.projectId, projectId),
          eq(proceduralMemories.procedureName, data.name),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const record = existing[0]!;
      await db
        .update(proceduralMemories)
        .set({
          steps: data.steps,
          lastUsed: new Date(),
        })
        .where(eq(proceduralMemories.id, record.id));

      logger.debug({ projectId, procedure: data.name }, "Procedure updated");
      return {
        id: record.id,
        projectId,
        name: data.name,
        description: data.description,
        steps: data.steps,
        lastUsed: new Date(),
      };
    }

    const id = generateId("proc");
    await db.insert(proceduralMemories).values({
      id,
      projectId,
      procedureName: data.name,
      steps: data.steps,
      lastUsed: new Date(),
    });

    logger.debug({ projectId, procedure: data.name }, "Procedure stored");
    return {
      id,
      projectId,
      name: data.name,
      description: data.description,
      steps: data.steps,
      lastUsed: new Date(),
    };
  }

  async get(projectId: string, name: string): Promise<Procedure | null> {
    const results = await db
      .select()
      .from(proceduralMemories)
      .where(
        and(
          eq(proceduralMemories.projectId, projectId),
          eq(proceduralMemories.procedureName, name),
        ),
      )
      .limit(1);

    if (results.length === 0) return null;

    const r = results[0]!;
    return {
      id: r.id,
      projectId: r.projectId,
      name: r.procedureName,
      description: r.procedureName, // Description stored as part of the name
      steps: r.steps as string[],
      lastUsed: r.lastUsed,
    };
  }

  async list(projectId: string): Promise<Procedure[]> {
    const results = await db
      .select()
      .from(proceduralMemories)
      .where(eq(proceduralMemories.projectId, projectId));

    return results.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      name: r.procedureName,
      description: r.procedureName,
      steps: r.steps as string[],
      lastUsed: r.lastUsed,
    }));
  }

  async recordSuccess(projectId: string, name: string): Promise<void> {
    await db
      .update(proceduralMemories)
      .set({ lastUsed: new Date() })
      .where(
        and(
          eq(proceduralMemories.projectId, projectId),
          eq(proceduralMemories.procedureName, name),
        ),
      );

    logger.debug({ projectId, procedure: name }, "Procedure success recorded");
  }

  async extractFromConfig(projectId: string, packageJson: Record<string, unknown>): Promise<void> {
    const scripts = packageJson.scripts as Record<string, string> | undefined;
    if (!scripts) return;

    for (const [name, command] of Object.entries(scripts)) {
      await this.store(projectId, {
        name: `run:${name}`,
        description: `Run ${name} script`,
        steps: [`pnpm ${name}`, `Command: ${command}`],
      });
    }

    logger.info(
      { projectId, scriptCount: Object.keys(scripts).length },
      "Procedures extracted from package.json",
    );
  }
}
