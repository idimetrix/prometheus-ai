import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:spec-first");

export interface SpecOutput {
  apiSignatures: string;
  dbChanges: string;
  interfaces: string;
  testStubs: string;
  validators: string;
}

/**
 * SpecFirst generates TypeScript interfaces, Zod validators, tRPC signatures,
 * and DB schema changes BEFORE any implementation code is written.
 * This ensures all agents work from the same contract.
 */
export class SpecFirst {
  private readonly eventPublisher = new EventPublisher();

  /**
   * Generate specifications from a blueprint.
   */
  async generateSpecs(
    agentLoop: AgentLoop,
    blueprint: string,
    taskDescription: string
  ): Promise<{ result: AgentExecutionResult; specs: SpecOutput }> {
    logger.info("Generating specifications from blueprint");

    const prompt = `Based on the blueprint and task requirements, generate all specifications BEFORE any implementation.

## Task
${taskDescription}

## Blueprint
${blueprint}

## Generate the Following Specifications

### 1. TYPESCRIPT_INTERFACES
Define all TypeScript interfaces and types needed:
- Request/response types
- Entity types
- Enum types
- Utility types

### 2. ZOD_VALIDATORS
Define Zod schemas for all inputs:
- API input validation schemas
- Form validation schemas
- Configuration schemas

### 3. API_SIGNATURES
Define all tRPC procedure signatures:
- Procedure name
- Input schema reference
- Output type
- Auth requirements (public/protected)

### 4. DB_CHANGES
Define any database schema changes needed:
- New tables (Drizzle format)
- New columns on existing tables
- New indexes
- Migration considerations

### 5. TEST_STUBS
Define test file structure with empty test cases:
- Test file paths
- Describe blocks
- Individual test cases (it/test)

Rules:
- Use the project's conventions: camelCase, generateId(), Drizzle ORM
- All interfaces must be exported
- All validators must use Zod from 'zod'
- All DB changes must use Drizzle schema format
- Test stubs should use vitest syntax`;

    const result = await agentLoop.executeTask(prompt, "architect");

    const specs = this.parseSpecs(result.output);

    await this.eventPublisher.publishSessionEvent(agentLoop.getSessionId(), {
      type: QueueEvents.PLAN_UPDATE,
      data: {
        phase: "spec",
        status: "completed",
        specs: {
          hasInterfaces: specs.interfaces.length > 0,
          hasValidators: specs.validators.length > 0,
          hasApiSignatures: specs.apiSignatures.length > 0,
          hasDbChanges: specs.dbChanges.length > 0,
          hasTestStubs: specs.testStubs.length > 0,
        },
      },
      timestamp: new Date().toISOString(),
    });

    return { result, specs };
  }

  /**
   * Validate that implementation matches specs after build.
   */
  validateImplementation(
    agentLoop: AgentLoop,
    specs: SpecOutput
  ): Promise<AgentExecutionResult> {
    const prompt = `Validate that the current implementation matches these specifications.

## Specifications to Verify

### TypeScript Interfaces
${specs.interfaces}

### Zod Validators
${specs.validators}

### API Signatures
${specs.apiSignatures}

### DB Schema Changes
${specs.dbChanges}

Check:
1. All interfaces are implemented and match the spec
2. All validators are used in the correct procedures
3. All API endpoints exist and match signatures
4. DB schema changes have been applied
5. Run \`pnpm typecheck\` to verify type safety

Report any mismatches between spec and implementation.`;

    return agentLoop.executeTask(prompt, "test_engineer");
  }

  private parseSpecs(output: string): SpecOutput {
    return {
      interfaces: this.extractSection(output, "TYPESCRIPT_INTERFACES"),
      validators: this.extractSection(output, "ZOD_VALIDATORS"),
      apiSignatures: this.extractSection(output, "API_SIGNATURES"),
      dbChanges: this.extractSection(output, "DB_CHANGES"),
      testStubs: this.extractSection(output, "TEST_STUBS"),
    };
  }

  private extractSection(output: string, sectionName: string): string {
    const patterns = [
      new RegExp(
        `###?\\s*\\d*\\.?\\s*${sectionName}[^\\n]*\\n([\\s\\S]*?)(?=###?\\s*\\d*\\.?\\s*[A-Z]|$)`,
        "i"
      ),
      new RegExp(`${sectionName}[^\\n]*\\n([\\s\\S]*?)(?=###?|$)`, "i"),
    ];
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match?.[1]?.trim()) {
        return match[1].trim();
      }
    }
    return "";
  }
}
