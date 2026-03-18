/**
 * Phase 9.5: Blueprint Enforcement for the Orchestrator.
 *
 * Loads the project Blueprint.md into context and validates agent actions
 * against architectural decisions. Warns when deviating from the blueprint.
 *
 * Features:
 *  - Load blueprint from project-brain or DB
 *  - Validate proposed file changes against tech stack, conventions, and architecture rules
 *  - Blueprint version tracking (detect when blueprint changes mid-session)
 *  - Inject blueprint context into agent prompts
 *  - Pre-action and post-action validation hooks
 */

import crypto from "node:crypto";

// ─── Top-level regex constants ──────────────────────────────────────────
const RAW_SQL_QUERY_RE =
  /\bquery\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE)\b/i;
const REDUX_IMPORT_RE = /from\s+['"]redux['"]/;
const NPM_YARN_INSTALL_RE = /npm install|yarn add/;
const CONSOLE_LOG_RE = /console\.(log|warn|error|info)\s*\(/;
const SNAKE_CASE_VAR_RE = /(?:const|let|var)\s+([a-z]+_[a-z_]+)/;
const UUID_OR_RANDOM_RE = /uuid|crypto\.randomUUID|Math\.random/;
const DB_SELECT_RE = /db\s*\.\s*select\s*\(\s*\)/;
const NPM_YARN_COMMAND_RE = /^(npm|yarn)\s/;
const TECH_STACK_SECTION_RE = /## Tech Stack.*?\n([\s\S]*?)(?=\n##|$)/;

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:blueprint-enforcer");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4005";

export interface BlueprintViolation {
  description: string;
  file?: string;
  rule: string;
  severity: "error" | "warning" | "info";
  suggestion?: string;
}

export interface BlueprintContext {
  architectureRules: string[];
  content: string;
  conventions: string[];
  neverDo: string[];
  techStack: Record<string, string>;
  version: string;
}

/**
 * BlueprintEnforcer ensures agent actions comply with the project's
 * architectural blueprint. Integrates with the AgentLoop to provide
 * pre-action validation and post-action checks.
 */
export class BlueprintEnforcer {
  private blueprint: BlueprintContext | null = null;
  private lastLoadedVersion: string | null = null;

  /**
   * Load the blueprint for a project, either from the project-brain
   * service or directly from provided content.
   */
  async loadForProject(projectId: string): Promise<boolean> {
    try {
      const response = await fetch(`${PROJECT_BRAIN_URL}/blueprint/enforce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, changes: [] }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.warn(
          { projectId, status: response.status },
          "Failed to load blueprint from project-brain"
        );
        return false;
      }

      // Even though we made a call, we need the actual content.
      // Try the context assembly endpoint instead.
      const ctxResponse = await fetch(`${PROJECT_BRAIN_URL}/context/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          taskDescription: "blueprint loading",
          agentRole: "orchestrator",
          maxTokens: 4000,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (ctxResponse.ok) {
        const ctx = (await ctxResponse.json()) as { global: string };
        if (ctx.global) {
          this.loadFromContent(ctx.global);
          logger.info(
            { projectId, version: this.blueprint?.version },
            "Blueprint loaded from project-brain"
          );
          return true;
        }
      }

      return false;
    } catch (err) {
      logger.warn(
        { projectId, err },
        "Project-brain unavailable for blueprint loading"
      );
      return false;
    }
  }

  /**
   * Load blueprint directly from markdown content.
   */
  loadFromContent(content: string): void {
    const version = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex")
      .slice(0, 12);

    // Detect version change
    if (this.lastLoadedVersion && this.lastLoadedVersion !== version) {
      logger.info(
        { oldVersion: this.lastLoadedVersion, newVersion: version },
        "Blueprint version changed mid-session"
      );
    }

    this.blueprint = {
      content,
      version,
      techStack: this.parseTechStack(content),
      neverDo: this.parseListSection(content, "Never-Do"),
      conventions: this.parseListSection(content, "Conventions"),
      architectureRules: this.parseListSection(content, "Architecture"),
    };

    this.lastLoadedVersion = version;
  }

  /**
   * Check whether the blueprint has changed since last load.
   */
  async checkVersionChanged(projectId: string): Promise<boolean> {
    if (!this.blueprint) {
      return false;
    }

    try {
      const response = await fetch(`${PROJECT_BRAIN_URL}/context/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          taskDescription: "version check",
          agentRole: "orchestrator",
          maxTokens: 2000,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const ctx = (await response.json()) as { global: string };
        if (ctx.global) {
          const newVersion = crypto
            .createHash("sha256")
            .update(ctx.global)
            .digest("hex")
            .slice(0, 12);
          return newVersion !== this.blueprint.version;
        }
      }
    } catch {
      // Can't check version, assume unchanged
    }

    return false;
  }

  /**
   * Validate a proposed action against the blueprint.
   * Called before the agent writes/modifies files.
   */
  validateAction(action: {
    type: "file_write" | "file_edit" | "terminal_exec" | "other";
    filePath?: string;
    content?: string;
    command?: string;
  }): BlueprintViolation[] {
    if (!this.blueprint) {
      return [];
    }

    const violations: BlueprintViolation[] = [];

    if (
      (action.type === "file_write" || action.type === "file_edit") &&
      action.content
    ) {
      violations.push(...this.checkNeverDo(action.content, action.filePath));
      violations.push(
        ...this.checkTechStackViolations(action.content, action.filePath)
      );
      violations.push(
        ...this.checkConventionViolations(action.content, action.filePath)
      );
      violations.push(
        ...this.checkArchitectureViolations(action.content, action.filePath)
      );
    }

    if (action.type === "terminal_exec" && action.command) {
      violations.push(...this.checkCommandViolations(action.command));
    }

    if (violations.length > 0) {
      logger.warn(
        {
          actionType: action.type,
          filePath: action.filePath,
          violationCount: violations.length,
          errors: violations.filter((v) => v.severity === "error").length,
        },
        "Blueprint violations detected"
      );
    }

    return violations;
  }

  /**
   * Generate a blueprint context string for injection into agent prompts.
   */
  getContextForPrompt(): string {
    if (!this.blueprint) {
      return "";
    }

    const parts: string[] = ["## Blueprint Constraints (MUST follow)", ""];

    if (Object.keys(this.blueprint.techStack).length > 0) {
      parts.push("### Tech Stack");
      for (const [key, value] of Object.entries(this.blueprint.techStack)) {
        parts.push(`- ${key}: ${value}`);
      }
      parts.push("");
    }

    if (this.blueprint.neverDo.length > 0) {
      parts.push("### Never Do (STRICT)");
      for (const rule of this.blueprint.neverDo) {
        parts.push(`- ${rule}`);
      }
      parts.push("");
    }

    if (this.blueprint.conventions.length > 0) {
      parts.push("### Conventions");
      for (const conv of this.blueprint.conventions) {
        parts.push(`- ${conv}`);
      }
      parts.push("");
    }

    if (this.blueprint.architectureRules.length > 0) {
      parts.push("### Architecture Rules");
      for (const rule of this.blueprint.architectureRules) {
        parts.push(`- ${rule}`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Get the current blueprint version hash.
   */
  getVersion(): string | null {
    return this.blueprint?.version ?? null;
  }

  /**
   * Check if a blueprint is loaded.
   */
  isLoaded(): boolean {
    return this.blueprint !== null;
  }

  // ─── Private Checks ──────────────────────────────────────────────

  private checkNeverDo(
    content: string,
    filePath?: string
  ): BlueprintViolation[] {
    if (!this.blueprint) {
      return [];
    }
    const violations: BlueprintViolation[] = [];
    const contentLower = content.toLowerCase();

    for (const rule of this.blueprint.neverDo) {
      const ruleLower = rule.toLowerCase();
      if (contentLower.includes(ruleLower)) {
        violations.push({
          rule: `Never-Do: ${rule}`,
          description: `Content violates "Never Do" rule: "${rule}"`,
          severity: "error",
          file: filePath,
          suggestion: `Remove or refactor the code that violates: ${rule}`,
        });
      }
    }

    return violations;
  }

  private checkTechStackViolations(
    content: string,
    filePath?: string
  ): BlueprintViolation[] {
    if (!this.blueprint) {
      return [];
    }
    const violations: BlueprintViolation[] = [];

    // Check for ORM violations
    if (
      this.blueprint.techStack.ORM?.includes("Drizzle") &&
      RAW_SQL_QUERY_RE.test(content)
    ) {
      violations.push({
        rule: "Tech Stack: ORM",
        description: "Raw SQL detected; use Drizzle ORM per blueprint",
        severity: "warning",
        file: filePath,
        suggestion: "Rewrite using Drizzle query builder methods",
      });
    }

    // Check for state management violations
    if (
      this.blueprint.techStack.State?.includes("Zustand") &&
      REDUX_IMPORT_RE.test(content)
    ) {
      violations.push({
        rule: "Tech Stack: State",
        description: "Redux import detected; use Zustand per blueprint",
        severity: "warning",
        file: filePath,
        suggestion: "Replace Redux with Zustand store",
      });
    }

    // Check for package manager violations
    if (
      this.blueprint.techStack["Package Manager"]?.includes("pnpm") &&
      NPM_YARN_INSTALL_RE.test(content)
    ) {
      violations.push({
        rule: "Tech Stack: Package Manager",
        description:
          "Non-pnpm package command detected; use pnpm per blueprint",
        severity: "warning",
        file: filePath,
        suggestion: "Use 'pnpm add' instead",
      });
    }

    return violations;
  }

  private checkConventionViolations(
    content: string,
    filePath?: string
  ): BlueprintViolation[] {
    if (!this.blueprint) {
      return [];
    }
    const violations: BlueprintViolation[] = [];
    const ext = filePath?.split(".").pop()?.toLowerCase();
    const isCodeFile = ext && ["ts", "tsx", "js", "jsx"].includes(ext);

    for (const conv of this.blueprint.conventions) {
      const convLower = conv.toLowerCase();

      // Logger convention
      if (
        (convLower.includes("use logger") ||
          convLower.includes("no console.log")) &&
        CONSOLE_LOG_RE.test(content)
      ) {
        violations.push({
          rule: `Convention: ${conv}`,
          description:
            "console.log detected; use structured logger per conventions",
          severity: "warning",
          file: filePath,
          suggestion: "Import and use createLogger from @prometheus/logger",
        });
      }

      // Naming convention
      if (
        convLower.includes("camelcase") &&
        isCodeFile &&
        SNAKE_CASE_VAR_RE.test(content)
      ) {
        violations.push({
          rule: `Convention: ${conv}`,
          description:
            "snake_case variable detected; use camelCase per conventions",
          severity: "warning",
          file: filePath,
        });
      }

      // ID generation convention
      if (
        convLower.includes("generateid") &&
        isCodeFile &&
        UUID_OR_RANDOM_RE.test(content) &&
        !content.includes("generateId")
      ) {
        violations.push({
          rule: `Convention: ${conv}`,
          description:
            "Non-standard ID generation detected; use generateId() from @prometheus/utils",
          severity: "warning",
          file: filePath,
          suggestion: "Import generateId from @prometheus/utils",
        });
      }
    }

    return violations;
  }

  private checkArchitectureViolations(
    content: string,
    filePath?: string
  ): BlueprintViolation[] {
    if (!this.blueprint) {
      return [];
    }
    const violations: BlueprintViolation[] = [];

    for (const rule of this.blueprint.architectureRules) {
      const ruleLower = rule.toLowerCase();

      // RLS / tenant isolation
      if (
        (ruleLower.includes("rls") || ruleLower.includes("org_id")) &&
        filePath &&
        !filePath.includes("schema") &&
        !filePath.includes("migration") &&
        DB_SELECT_RE.test(content) &&
        !content.includes("orgId") &&
        !content.includes("org_id")
      ) {
        violations.push({
          rule: `Architecture: ${rule}`,
          description: "Database query may be missing org_id tenant filter",
          severity: "warning",
          file: filePath,
          suggestion: "Ensure all queries include org_id for RLS compliance",
        });
      }
    }

    return violations;
  }

  private checkCommandViolations(command: string): BlueprintViolation[] {
    const violations: BlueprintViolation[] = [];
    if (!this.blueprint) {
      return violations;
    }

    // Check package manager
    if (
      this.blueprint.techStack["Package Manager"]?.includes("pnpm") &&
      NPM_YARN_COMMAND_RE.test(command)
    ) {
      violations.push({
        rule: "Tech Stack: Package Manager",
        description:
          "Command uses wrong package manager; use pnpm per blueprint",
        severity: "warning",
        suggestion: command.replace(NPM_YARN_COMMAND_RE, "pnpm "),
      });
    }

    return violations;
  }

  // ─── Parsing ─────────────────────────────────────────────────────

  private parseTechStack(content: string): Record<string, string> {
    const techStack: Record<string, string> = {};
    const match = content.match(TECH_STACK_SECTION_RE);
    if (match?.[1]) {
      const lines = match[1].split("\n").filter((l) => l.startsWith("- "));
      for (const line of lines) {
        const [key, ...vals] = line.slice(2).split(":");
        if (key && vals.length > 0) {
          techStack[key.trim()] = vals.join(":").trim();
        }
      }
    }
    return techStack;
  }

  private parseListSection(content: string, sectionName: string): string[] {
    const regex = new RegExp(
      `## ${sectionName}.*?\\n([\\s\\S]*?)(?=\\n##|$)`,
      "i"
    );
    const match = content.match(regex);
    if (!match?.[1]) {
      return [];
    }

    return match[1]
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim());
  }
}
