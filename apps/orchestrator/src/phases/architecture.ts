import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";
import { MixtureOfAgents } from "../moa/parallel-generator";

const logger = createLogger("orchestrator:architecture");

const TECH_STACK_LINE_RE = /[-*]?\s*([^:]+):\s*(.+)/;
const ADR_HEADER_RE = /ADR-(\d+):\s*(.+?)(?:\n|$)/g;
const ADR_DECISION_RE =
  /Decision:\s*([\s\S]*?)(?=\n\s*(?:Reasoning|Context|Alternatives|ADR-)|$)/i;
const ADR_REASONING_RE =
  /Reasoning:\s*([\s\S]*?)(?=\n\s*(?:Decision|Context|Alternatives|ADR-)|$)/i;

export interface ArchitectureResult {
  adrs: Array<{
    id: string;
    title: string;
    decision: string;
    reasoning: string;
  }>;
  apiContracts: string;
  blueprint: string;
  dbSchema: string;
  techStack: Record<string, string>;
}

/**
 * ArchitecturePhase runs the Architect agent to produce a complete
 * technical blueprint from the SRS. The blueprint includes:
 * - Tech Stack (immutable section)
 * - Domain Model
 * - Database Schema
 * - API Contracts
 * - Component Hierarchy
 * - Architecture Decision Records (ADRs)
 * - Never-Do List
 * - Code Conventions
 *
 * The resulting blueprint is persisted to the blueprints table.
 */
export class ArchitecturePhase {
  async execute(
    agentLoop: AgentLoop,
    srs: string,
    preset?: string,
    useMoA = false
  ): Promise<ArchitectureResult> {
    logger.info({ preset, useMoA }, "Starting Architecture phase");

    let output: string;

    if (useMoA) {
      const moa = new MixtureOfAgents();
      const moaResult = await moa.generate(
        this.buildArchitectPrompt(srs, preset)
      );
      output = moaResult.synthesized;
      logger.info(
        {
          models: moaResult.responses.length,
          selectedModel: moaResult.selectedModel,
        },
        "MoA architecture generation complete"
      );
    } else {
      const result = await agentLoop.executeTask(
        this.buildArchitectPrompt(srs, preset),
        "architect"
      );
      output = result.output;
    }

    // Parse the blueprint output into structured sections
    const parsed = this.parseBlueprint(output);

    logger.info(
      {
        techStackEntries: Object.keys(parsed.techStack).length,
        adrCount: parsed.adrs.length,
        hasDomain: parsed.dbSchema.length > 0,
        hasApi: parsed.apiContracts.length > 0,
      },
      "Architecture phase complete"
    );

    // Persist blueprint to database
    await this.persistBlueprint(agentLoop, parsed);

    return parsed;
  }

  private buildArchitectPrompt(srs: string, preset?: string): string {
    return `Based on the following Software Requirements Specification, design the complete technical architecture.

SRS:
${srs}

${preset ? `Tech Stack Preset: ${preset}\nUse this preset as the foundation. Do not deviate from its core choices.` : "Choose the optimal tech stack based on the requirements. Prefer well-maintained, production-ready tools."}

Generate a comprehensive Blueprint.md with the following sections:

## 1. TECH_STACK (IMMUTABLE)
List every technology choice. Format as:
- Category: Technology (version)
Example:
- Frontend: Next.js (16)
- Backend: tRPC v11
- Database: PostgreSQL 16

## 2. DOMAIN_MODEL
Define all entities with their relationships. Use a clear format:
- EntityName
  - field: type (constraints)
  - relation: RelatedEntity (type: one-to-many|many-to-many)

## 3. DB_SCHEMA
Complete database schema with:
- Table name
- Columns with types, constraints, defaults
- Indexes
- Foreign keys

## 4. API_CONTRACTS
All API endpoints with:
- Method + Path
- Request body schema
- Response schema
- Auth requirements

## 5. COMPONENT_HIERARCHY
Frontend component tree showing:
- Page components
- Layout components
- Shared UI components
- State management

## 6. ADR (Architecture Decision Records)
For each major decision:
- ADR-N: Title
  - Context: why the decision was needed
  - Decision: what was decided
  - Reasoning: why this option was chosen
  - Alternatives considered

## 7. NEVER_DO_LIST
Anti-patterns and mistakes to avoid in this project.

## 8. CODE_CONVENTIONS
- File naming patterns
- Import ordering
- Code organization
- Testing conventions

Be specific and complete. Every section must contain real, actionable content - not placeholders.`;
  }

  /**
   * Parse the architect agent's output into structured sections.
   */
  private parseBlueprint(output: string): ArchitectureResult {
    return {
      blueprint: output,
      techStack: this.extractTechStack(output),
      dbSchema: this.extractSection(output, "DB_SCHEMA"),
      apiContracts: this.extractSection(output, "API_CONTRACTS"),
      adrs: this.extractADRs(output),
    };
  }

  private extractTechStack(output: string): Record<string, string> {
    const techStack: Record<string, string> = {};
    const section = this.extractSection(output, "TECH_STACK");
    if (!section) {
      return techStack;
    }

    const lines = section.split("\n");
    for (const line of lines) {
      // Match "- Category: Technology" or "Category: Technology"
      const match = line.match(TECH_STACK_LINE_RE);
      if (match?.[1] && match?.[2]) {
        const key = match[1].trim();
        const value = match[2].trim();
        // Skip section headers and empty values
        if (key.length > 0 && value.length > 0 && !key.startsWith("#")) {
          techStack[key] = value;
        }
      }
    }

    return techStack;
  }

  private extractADRs(output: string): ArchitectureResult["adrs"] {
    const adrs: ArchitectureResult["adrs"] = [];
    const section = this.extractSection(output, "ADR");
    if (!section) {
      return adrs;
    }

    // Match ADR-N: Title pattern
    ADR_HEADER_RE.lastIndex = 0;
    let match: RegExpExecArray | null = ADR_HEADER_RE.exec(section);

    while (match !== null) {
      const id = `ADR-${match[1]}`;
      const title = match[2]?.trim() ?? "";

      // Extract the block for this ADR
      const startPos = match.index + match[0].length;
      const nextAdr = section.indexOf("ADR-", startPos);
      const endPos = nextAdr > -1 ? nextAdr : section.length;
      const block = section.slice(startPos, endPos);

      const decisionMatch = block.match(ADR_DECISION_RE);
      const reasoningMatch = block.match(ADR_REASONING_RE);

      adrs.push({
        id,
        title,
        decision: decisionMatch?.[1]?.trim() ?? "",
        reasoning: reasoningMatch?.[1]?.trim() ?? "",
      });
      match = ADR_HEADER_RE.exec(section);
    }

    return adrs;
  }

  /**
   * Extract a named section from the blueprint output.
   */
  private extractSection(output: string, sectionName: string): string {
    // Try matching "## N. SECTION_NAME" or "## SECTION_NAME"
    const patterns = [
      new RegExp(
        `##\\s*\\d+\\.?\\s*${sectionName}[^\\n]*\\n([\\s\\S]*?)(?=##\\s*\\d+\\.?\\s*[A-Z]|$)`,
        "i"
      ),
      new RegExp(`##\\s*${sectionName}[^\\n]*\\n([\\s\\S]*?)(?=##|$)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return "";
  }

  /**
   * Persist the blueprint to the database for this project.
   */
  private persistBlueprint(
    agentLoop: AgentLoop,
    _result: ArchitectureResult
  ): void {
    try {
      // The agentLoop has the project context embedded
      const _iterations = agentLoop.getIterations();
      // We don't have direct access to projectId from agentLoop, but it's
      // available through the context. For now we extract from the first iteration.
      // In practice, the caller would pass projectId.

      // Blueprint is persisted by the orchestrator's processTask method
      // which has access to the projectId. Here we just log.
      logger.info("Blueprint generated and ready for persistence");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to persist blueprint to DB");
    }
  }
}
