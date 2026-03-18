import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:procedural");

export interface Procedure {
  name: string;
  description: string;
  steps: string[];
  lastUsed: Date;
}

export class ProceduralLayer {
  private procedures = new Map<string, Map<string, Procedure>>();

  async store(projectId: string, data: {
    name: string;
    description: string;
    steps: string[];
  }): Promise<void> {
    if (!this.procedures.has(projectId)) {
      this.procedures.set(projectId, new Map());
    }

    this.procedures.get(projectId)!.set(data.name, {
      ...data,
      lastUsed: new Date(),
    });

    logger.debug({ projectId, procedure: data.name }, "Procedure stored");
  }

  async get(projectId: string, name: string): Promise<Procedure | null> {
    return this.procedures.get(projectId)?.get(name) ?? null;
  }

  async list(projectId: string): Promise<Procedure[]> {
    const projectProcs = this.procedures.get(projectId);
    return projectProcs ? Array.from(projectProcs.values()) : [];
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

    logger.info({ projectId, scriptCount: Object.keys(scripts).length }, "Procedures extracted from package.json");
  }
}
