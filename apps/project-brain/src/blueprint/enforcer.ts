import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:blueprint");

export interface BlueprintViolation {
  type: "tech_stack" | "convention" | "never_do" | "architecture";
  description: string;
  file?: string;
  line?: number;
  severity: "error" | "warning";
}

export class BlueprintEnforcer {
  private blueprint: string | null = null;
  private techStack: Record<string, string> = {};
  private neverDoList: string[] = [];
  private conventions: string[] = [];

  loadBlueprint(content: string): void {
    this.blueprint = content;
    this.parseSections(content);
    logger.info("Blueprint loaded");
  }

  checkViolations(filePath: string, content: string): BlueprintViolation[] {
    const violations: BlueprintViolation[] = [];

    // Check never-do list
    for (const rule of this.neverDoList) {
      if (content.toLowerCase().includes(rule.toLowerCase())) {
        violations.push({
          type: "never_do",
          description: `Blueprint violation: "${rule}" found in code`,
          file: filePath,
          severity: "error",
        });
      }
    }

    return violations;
  }

  getBlueprintContent(): string | null {
    return this.blueprint;
  }

  getTechStack(): Record<string, string> {
    return { ...this.techStack };
  }

  private parseSections(content: string): void {
    // Parse tech stack section
    const techMatch = content.match(/## Tech Stack.*?\n([\s\S]*?)(?=\n##|$)/);
    if (techMatch?.[1]) {
      const lines = techMatch[1].split("\n").filter((l) => l.startsWith("- "));
      for (const line of lines) {
        const [key, ...vals] = line.slice(2).split(":");
        if (key && vals.length > 0) {
          this.techStack[key.trim()] = vals.join(":").trim();
        }
      }
    }

    // Parse never-do list
    const neverMatch = content.match(/## Never-Do.*?\n([\s\S]*?)(?=\n##|$)/);
    if (neverMatch?.[1]) {
      this.neverDoList = neverMatch[1]
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2).trim());
    }
  }
}
