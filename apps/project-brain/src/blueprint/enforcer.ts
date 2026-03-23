import { blueprints, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq } from "drizzle-orm";

const logger = createLogger("project-brain:blueprint");

// ─── Top-level regex constants ──────────────────────────────────────────
const RAW_SQL_RE =
  /\bquery\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i;
const REDUX_IMPORT_RE = /from\s+['"]redux['"]/;
const CSS_BLOCK_RE = /[{][\s\S]*?[}]/g;
const SNAKE_CASE_VAR_RE = /(?:const|let|var)\s+([a-z]+_[a-z_]+)/g;
const CONSOLE_LOG_RE = /console\.(log|warn|error|info)\s*\(/;
const DB_IMPORT_RE = /from\s+['"].*db['"]/;
const TECH_STACK_SECTION_RE = /## Tech Stack.*?\n([\s\S]*?)(?=\n##|$)/;
const NEVER_DO_SECTION_RE = /## Never-Do.*?\n([\s\S]*?)(?=\n##|$)/i;
const CONVENTIONS_SECTION_RE = /## Conventions.*?\n([\s\S]*?)(?=\n##|$)/i;
const ARCHITECTURE_SECTION_RE = /## Architecture.*?\n([\s\S]*?)(?=\n##|$)/i;

export interface BlueprintViolation {
  description: string;
  file?: string;
  line?: number;
  severity: "error" | "warning";
  type: "tech_stack" | "convention" | "never_do" | "architecture";
}

export interface ProposedChange {
  content: string;
  filePath: string;
}

interface ParsedBlueprint {
  architectureRules: string[];
  content: string;
  conventions: string[];
  neverDoList: string[];
  techStack: Record<string, string>;
}

export class BlueprintEnforcer {
  private parsedBlueprint: ParsedBlueprint | null = null;

  /**
   * Load the active blueprint for a project from the database.
   */
  async loadBlueprintFromDb(projectId: string): Promise<boolean> {
    try {
      const result = await db
        .select()
        .from(blueprints)
        .where(
          and(
            eq(blueprints.projectId, projectId),
            eq(blueprints.isActive, true)
          )
        )
        .limit(1);

      if (result.length === 0) {
        logger.warn({ projectId }, "No active blueprint found");
        return false;
      }

      this.loadBlueprint(result[0]?.content ?? "");
      return true;
    } catch (err) {
      logger.error({ projectId, err }, "Failed to load blueprint from DB");
      return false;
    }
  }

  /**
   * Load and parse a blueprint from raw content.
   */
  loadBlueprint(content: string): void {
    this.parsedBlueprint = this.parseSections(content);
    logger.info("Blueprint loaded and parsed");
  }

  /**
   * Enforce the blueprint against a set of proposed changes.
   * Returns all violations found.
   */
  async enforceBlueprint(
    projectId: string,
    proposedChanges: ProposedChange[]
  ): Promise<BlueprintViolation[]> {
    // Load blueprint if not already loaded
    if (!this.parsedBlueprint) {
      const loaded = await this.loadBlueprintFromDb(projectId);
      if (!loaded) {
        return [];
      }
    }

    const violations: BlueprintViolation[] = [];

    for (const change of proposedChanges) {
      violations.push(...this.checkNeverDo(change));
      violations.push(...this.checkTechStack(change));
      violations.push(...this.checkConventions(change));
      violations.push(...this.checkArchitecture(change));
    }

    logger.info(
      {
        projectId,
        filesChecked: proposedChanges.length,
        violations: violations.length,
        errors: violations.filter((v) => v.severity === "error").length,
        warnings: violations.filter((v) => v.severity === "warning").length,
      },
      "Blueprint enforcement complete"
    );

    return violations;
  }

  /**
   * Simple single-file check (backward-compatible API).
   */
  checkViolations(filePath: string, content: string): BlueprintViolation[] {
    if (!this.parsedBlueprint) {
      return [];
    }
    const change: ProposedChange = { filePath, content };
    return [
      ...this.checkNeverDo(change),
      ...this.checkTechStack(change),
      ...this.checkConventions(change),
      ...this.checkArchitecture(change),
    ];
  }

  getBlueprintContent(): string | null {
    return this.parsedBlueprint?.content ?? null;
  }

  getTechStack(): Record<string, string> {
    return { ...(this.parsedBlueprint?.techStack ?? {}) };
  }

  // --- Private enforcement checks ---

  private checkNeverDo(change: ProposedChange): BlueprintViolation[] {
    if (!this.parsedBlueprint) {
      return [];
    }
    const violations: BlueprintViolation[] = [];
    const lines = change.content.split("\n");

    for (const rule of this.parsedBlueprint.neverDoList) {
      const ruleLower = rule.toLowerCase();

      // Check each line for the violation
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]?.toLowerCase().includes(ruleLower)) {
          violations.push({
            type: "never_do",
            description: `Blueprint violation: "${rule}" found in code`,
            file: change.filePath,
            line: i + 1,
            severity: "error",
          });
          break; // One violation per rule per file
        }
      }
    }

    return violations;
  }

  private checkTechStack(change: ProposedChange): BlueprintViolation[] {
    if (!this.parsedBlueprint) {
      return [];
    }
    const violations: BlueprintViolation[] = [];
    const content = change.content;
    const ext = change.filePath.split(".").pop()?.toLowerCase();

    // Check for forbidden tech patterns based on the blueprint's tech stack
    const forbiddenPatterns: Array<{
      pattern: RegExp;
      category: string;
      message: string;
    }> = [];

    // If blueprint specifies ORM, check for raw SQL
    if (this.parsedBlueprint.techStack.ORM?.includes("Drizzle")) {
      forbiddenPatterns.push({
        pattern: RAW_SQL_RE,
        category: "ORM",
        message: "Raw SQL detected; use Drizzle ORM instead per blueprint",
      });
    }

    // If blueprint specifies a specific state manager, check for alternatives
    if (this.parsedBlueprint.techStack.State?.includes("Zustand")) {
      forbiddenPatterns.push({
        pattern: REDUX_IMPORT_RE,
        category: "State",
        message: "Redux import detected; use Zustand per blueprint",
      });
    }

    // If blueprint specifies a CSS framework
    if (
      this.parsedBlueprint.techStack.CSS?.includes("Tailwind") &&
      ext === "css" &&
      !change.filePath.includes("globals")
    ) {
      // Warn on new CSS files that aren't the global file
      const hasSignificantCSS = content.match(CSS_BLOCK_RE);
      if (hasSignificantCSS && hasSignificantCSS.length > 3) {
        violations.push({
          type: "tech_stack",
          description:
            "Custom CSS file detected; prefer Tailwind utility classes per blueprint",
          file: change.filePath,
          severity: "warning",
        });
      }
    }

    for (const fp of forbiddenPatterns) {
      if (fp.pattern.test(content)) {
        violations.push({
          type: "tech_stack",
          description: fp.message,
          file: change.filePath,
          severity: "warning",
        });
      }
    }

    return violations;
  }

  private checkConventions(change: ProposedChange): BlueprintViolation[] {
    if (!this.parsedBlueprint) {
      return [];
    }
    const violations: BlueprintViolation[] = [];

    for (const convention of this.parsedBlueprint.conventions) {
      const convLower = convention.toLowerCase();

      // Check for naming conventions
      if (convLower.includes("camelcase") || convLower.includes("camel case")) {
        // Check for snake_case in variable declarations in JS/TS files
        const ext = change.filePath.split(".").pop()?.toLowerCase();
        if (ext && ["ts", "tsx", "js", "jsx"].includes(ext)) {
          const snakeCaseVars = change.content.match(SNAKE_CASE_VAR_RE);
          if (snakeCaseVars && snakeCaseVars.length > 0) {
            violations.push({
              type: "convention",
              description:
                "snake_case variable names detected; use camelCase per conventions",
              file: change.filePath,
              severity: "warning",
            });
          }
        }
      }

      // Check for console.log if conventions forbid it
      if (
        convLower.includes("no console.log") ||
        convLower.includes("use logger")
      ) {
        const hasConsoleLog = CONSOLE_LOG_RE.test(change.content);
        if (hasConsoleLog) {
          violations.push({
            type: "convention",
            description:
              "console.log detected; use structured logger per conventions",
            file: change.filePath,
            severity: "warning",
          });
        }
      }
    }

    return violations;
  }

  private checkArchitecture(change: ProposedChange): BlueprintViolation[] {
    if (!this.parsedBlueprint) {
      return [];
    }
    const violations: BlueprintViolation[] = [];

    for (const rule of this.parsedBlueprint.architectureRules) {
      const ruleLower = rule.toLowerCase();

      // Check for direct DB access outside of allowed locations
      if (
        ruleLower.includes("data access") &&
        ruleLower.includes("repository") &&
        !(
          change.filePath.includes("repository") ||
          change.filePath.includes("repo") ||
          change.filePath.includes("dal") ||
          change.filePath.includes("schema")
        )
      ) {
        const hasDbImport = DB_IMPORT_RE.test(change.content);
        if (hasDbImport) {
          violations.push({
            type: "architecture",
            description:
              "Direct DB import detected outside repository layer; per architecture rules, use repository pattern",
            file: change.filePath,
            severity: "warning",
          });
        }
      }
    }

    return violations;
  }

  // --- Parsing ---

  private parseSections(content: string): ParsedBlueprint {
    const techStack: Record<string, string> = {};
    const neverDoList: string[] = [];
    const conventions: string[] = [];
    const architectureRules: string[] = [];

    // Parse tech stack section
    const techMatch = content.match(TECH_STACK_SECTION_RE);
    if (techMatch?.[1]) {
      const lines = techMatch[1].split("\n").filter((l) => l.startsWith("- "));
      for (const line of lines) {
        const [key, ...vals] = line.slice(2).split(":");
        if (key && vals.length > 0) {
          techStack[key.trim()] = vals.join(":").trim();
        }
      }
    }

    // Parse never-do list
    const neverMatch = content.match(NEVER_DO_SECTION_RE);
    if (neverMatch?.[1]) {
      neverDoList.push(
        ...neverMatch[1]
          .split("\n")
          .filter((l) => l.startsWith("- "))
          .map((l) => l.slice(2).trim())
      );
    }

    // Parse conventions section
    const convMatch = content.match(CONVENTIONS_SECTION_RE);
    if (convMatch?.[1]) {
      conventions.push(
        ...convMatch[1]
          .split("\n")
          .filter((l) => l.startsWith("- "))
          .map((l) => l.slice(2).trim())
      );
    }

    // Parse architecture section
    const archMatch = content.match(ARCHITECTURE_SECTION_RE);
    if (archMatch?.[1]) {
      architectureRules.push(
        ...archMatch[1]
          .split("\n")
          .filter((l) => l.startsWith("- "))
          .map((l) => l.slice(2).trim())
      );
    }

    return { content, techStack, neverDoList, conventions, architectureRules };
  }
}
