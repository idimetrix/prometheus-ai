import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { SoftwareRequirementsSpec } from "./discovery";

const logger = createLogger("agent-sdk:protocol:architect");

export interface Blueprint {
  adrs: ArchitectureDecisionRecord[];
  apiContracts: APIContract[];
  componentTree: ComponentNode[];
  content: string; // Full markdown content
  databaseSchema: SchemaDefinition[];
  id: string;
  parallelWorkstreams: Workstream[];
  projectId: string;
  techStack: TechStackDecision;
  version: string;
}

export interface TechStackDecision {
  auth: string;
  backend: string[];
  database: string;
  deployment: string[];
  frontend: string[];
  reasoning: string;
}

export interface SchemaDefinition {
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    references?: string;
  }>;
  indexes: string[];
  tableName: string;
}

export interface APIContract {
  auth: boolean;
  description: string;
  inputType: string;
  method: string;
  outputType: string;
  path: string;
}

export interface ComponentNode {
  children: ComponentNode[];
  dependencies: string[];
  name: string;
  type: "page" | "layout" | "component" | "hook" | "store" | "util";
}

export interface ArchitectureDecisionRecord {
  consequences: string[];
  context: string;
  date: string;
  decision: string;
  id: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  title: string;
}

export interface Workstream {
  dependencies: string[];
  estimatedCredits: number;
  id: string;
  name: string;
  parallelizable: boolean;
  tasks: string[];
}

export class ArchitectProtocol {
  private readonly blueprint: Partial<Blueprint> = {};
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.blueprint = {
      id: generateId("bp"),
      projectId,
      version: "1.0.0",
      adrs: [],
      parallelWorkstreams: [],
    };
  }

  analyzeSRS(_srs: SoftwareRequirementsSpec): void {
    logger.info(
      { projectId: this.projectId },
      "Analyzing SRS for architecture"
    );
    // The LLM agent will use SRS to make decisions
    // This method sets up the context
  }

  setTechStack(decision: TechStackDecision): void {
    this.blueprint.techStack = decision;
    this.addADR({
      title: "Tech Stack Selection",
      context: "Initial technology selection for the project",
      decision: `Frontend: ${decision.frontend.join(", ")}. Backend: ${decision.backend.join(", ")}. Database: ${decision.database}. Auth: ${decision.auth}.`,
      consequences: [
        `Team must have expertise in ${decision.frontend[0]} and ${decision.backend[0]}`,
        `Deployment will use ${decision.deployment.join(", ")}`,
      ],
    });
  }

  setDatabaseSchema(schema: SchemaDefinition[]): void {
    this.blueprint.databaseSchema = schema;
  }

  setAPIContracts(contracts: APIContract[]): void {
    this.blueprint.apiContracts = contracts;
  }

  setComponentTree(tree: ComponentNode[]): void {
    this.blueprint.componentTree = tree;
  }

  addADR(
    adr: Omit<ArchitectureDecisionRecord, "id" | "status" | "date">
  ): void {
    this.blueprint.adrs ??= [];
    this.blueprint.adrs.push({
      id: generateId("adr"),
      status: "accepted",
      date: new Date().toISOString(),
      ...adr,
    });
  }

  identifyWorkstreams(): Workstream[] {
    const workstreams: Workstream[] = [];

    // Database & backend can proceed in parallel with frontend scaffolding
    if (this.blueprint.databaseSchema?.length) {
      workstreams.push({
        id: generateId("ws"),
        name: "Database & Schema",
        tasks: ["Create migrations", "Set up ORM models", "Add seed data"],
        dependencies: [],
        parallelizable: true,
        estimatedCredits: 15,
      });
    }

    if (this.blueprint.apiContracts?.length) {
      workstreams.push({
        id: generateId("ws"),
        name: "API Implementation",
        tasks: this.blueprint.apiContracts.map(
          (c) => `Implement ${c.method} ${c.path}`
        ),
        dependencies: ["Database & Schema"],
        parallelizable: true,
        estimatedCredits: 25,
      });
    }

    if (this.blueprint.componentTree?.length) {
      workstreams.push({
        id: generateId("ws"),
        name: "Frontend Implementation",
        tasks: [
          "Create layouts",
          "Build page components",
          "Wire up API client",
        ],
        dependencies: [],
        parallelizable: true,
        estimatedCredits: 25,
      });

      workstreams.push({
        id: generateId("ws"),
        name: "Integration",
        tasks: ["Connect frontend to API", "Add auth flow", "E2E testing"],
        dependencies: ["API Implementation", "Frontend Implementation"],
        parallelizable: false,
        estimatedCredits: 20,
      });
    }

    workstreams.push({
      id: generateId("ws"),
      name: "Testing & Security",
      tasks: ["Unit tests", "Integration tests", "Security audit"],
      dependencies: ["Integration"],
      parallelizable: true,
      estimatedCredits: 15,
    });

    this.blueprint.parallelWorkstreams = workstreams;
    return workstreams;
  }

  private renderTechStack(sections: string[]): void {
    const ts = this.blueprint.techStack;
    if (!ts) {
      return;
    }
    sections.push("## Tech Stack\n");
    sections.push(`- **Frontend:** ${ts.frontend.join(", ")}`);
    sections.push(`- **Backend:** ${ts.backend.join(", ")}`);
    sections.push(`- **Database:** ${ts.database}`);
    sections.push(`- **Auth:** ${ts.auth}`);
    sections.push(`- **Deployment:** ${ts.deployment.join(", ")}`);
    sections.push(`\n> ${ts.reasoning}\n`);
  }

  private renderDatabaseSchema(sections: string[]): void {
    if (!this.blueprint.databaseSchema?.length) {
      return;
    }
    sections.push("## Database Schema\n");
    for (const table of this.blueprint.databaseSchema) {
      sections.push(`### ${table.tableName}`);
      sections.push("| Column | Type | Nullable |");
      sections.push("|--------|------|----------|");
      for (const col of table.columns) {
        sections.push(
          `| ${col.name} | ${col.type} | ${col.nullable ? "Yes" : "No"} |`
        );
      }
      sections.push("");
    }
  }

  private renderApiContracts(sections: string[]): void {
    if (!this.blueprint.apiContracts?.length) {
      return;
    }
    sections.push("## API Contracts\n");
    for (const api of this.blueprint.apiContracts) {
      sections.push(`### ${api.method} ${api.path}`);
      sections.push(`${api.description}`);
      sections.push(`- Input: \`${api.inputType}\``);
      sections.push(`- Output: \`${api.outputType}\``);
      sections.push(`- Auth: ${api.auth ? "Required" : "Public"}\n`);
    }
  }

  private renderAdrs(sections: string[]): void {
    if (!this.blueprint.adrs?.length) {
      return;
    }
    sections.push("## Architecture Decision Records\n");
    for (const adr of this.blueprint.adrs) {
      sections.push(`### ADR-${adr.id}: ${adr.title}`);
      sections.push(`**Status:** ${adr.status} | **Date:** ${adr.date}`);
      sections.push(`**Context:** ${adr.context}`);
      sections.push(`**Decision:** ${adr.decision}`);
      sections.push("**Consequences:**");
      for (const c of adr.consequences) {
        sections.push(`- ${c}`);
      }
      sections.push("");
    }
  }

  generateBlueprintMarkdown(): string {
    const sections: string[] = [];

    sections.push("# Project Blueprint\n");
    sections.push(`Version: ${this.blueprint.version}`);
    sections.push(`Generated: ${new Date().toISOString()}\n`);

    this.renderTechStack(sections);
    this.renderDatabaseSchema(sections);
    this.renderApiContracts(sections);
    this.renderAdrs(sections);

    const content = sections.join("\n");
    this.blueprint.content = content;
    return content;
  }

  getBlueprint(): Blueprint {
    if (!this.blueprint.content) {
      this.generateBlueprintMarkdown();
    }
    return this.blueprint as Blueprint;
  }
}
