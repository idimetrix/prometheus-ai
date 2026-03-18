import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:architecture");

export interface ArchitectureResult {
  blueprint: string;
  techStack: Record<string, string>;
  dbSchema: string;
  apiContracts: string;
  adrs: Array<{ id: string; title: string; decision: string; reasoning: string }>;
}

export class ArchitecturePhase {
  async execute(agentLoop: AgentLoop, srs: string, preset?: string): Promise<ArchitectureResult> {
    logger.info({ preset }, "Starting Architecture phase");

    const result = await agentLoop.executeTask(
      `Based on the following Software Requirements Specification, design the complete technical architecture.

SRS:
${srs}

${preset ? `Tech Stack Preset: ${preset}` : "Choose the optimal tech stack."}

Generate a Blueprint.md with:
1. Tech Stack (IMMUTABLE section)
2. Domain Model with entities and relationships
3. Database Schema with all tables, columns, types, and indexes
4. API Contracts with endpoints, methods, request/response shapes
5. Component Hierarchy for frontend
6. Architecture Decision Records (ADRs) for key decisions
7. Never-Do List (anti-patterns to avoid)
8. Code Conventions (naming, file structure, imports)`,
      "architect"
    );

    return {
      blueprint: result.output,
      techStack: {},
      dbSchema: "",
      apiContracts: "",
      adrs: [],
    };
  }
}
