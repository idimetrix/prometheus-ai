import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { SoftwareRequirementsSpec } from "./discovery";

const logger = createLogger("agent-sdk:protocol:architect");

export interface Blueprint {
  id: string;
  projectId: string;
  version: string;
  techStack: TechStackDecision;
  databaseSchema: SchemaDefinition[];
  apiContracts: APIContract[];
  componentTree: ComponentNode[];
  adrs: ArchitectureDecisionRecord[];
  parallelWorkstreams: Workstream[];
  content: string; // Full markdown content
}

export interface TechStackDecision {
  frontend: string[];
  backend: string[];
  database: string;
  auth: string;
  deployment: string[];
  reasoning: string;
}

export interface SchemaDefinition {
  tableName: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    references?: string;
  }>;
  indexes: string[];
}

export interface APIContract {
  path: string;
  method: string;
  description: string;
  inputType: string;
  outputType: string;
  auth: boolean;
}

export interface ComponentNode {
  name: string;
  type: "page" | "layout" | "component" | "hook" | "store" | "util";
  children: ComponentNode[];
  dependencies: string[];
}

export interface ArchitectureDecisionRecord {
  id: string;
  title: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  context: string;
  decision: string;
  consequences: string[];
  date: string;
}

export interface Workstream {
  id: string;
  name: string;
  tasks: string[];
  dependencies: string[];
  parallelizable: boolean;
  estimatedCredits: number;
}

export class ArchitectProtocol {
  private blueprint: Partial<Blueprint> = {};

  constructor(private projectId: string) {
    this.blueprint = {
      id: generateId("bp"),
      projectId,
      version: "1.0.0",
      adrs: [],
      parallelWorkstreams: [],
    };
  }

  analyzeSRS(srs: SoftwareRequirementsSpec): void {
    logger.info({ projectId: this.projectId }, "Analyzing SRS for architecture");
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

  addADR(adr: Omit<ArchitectureDecisionRecord, "id" | "status" | "date">): void {
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
        tasks: this.blueprint.apiContracts.map((c) => `Implement ${c.method} ${c.path}`),
        dependencies: ["Database & Schema"],
        parallelizable: true,
        estimatedCredits: 25,
      });
    }

    if (this.blueprint.componentTree?.length) {
      workstreams.push({
        id: generateId("ws"),
        name: "Frontend Implementation",
        tasks: ["Create layouts", "Build page components", "Wire up API client"],
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

  generateBlueprintMarkdown(): string {
    const bp = this.blueprint;
    const sections: string[] = [];

    sections.push("# Project Blueprint\n");
    sections.push(`Version: ${bp.version}`);
    sections.push(`Generated: ${new Date().toISOString()}\n`);

    if (bp.techStack) {
      sections.push("## Tech Stack\n");
      sections.push(`- **Frontend:** ${bp.techStack.frontend.join(", ")}`);
      sections.push(`- **Backend:** ${bp.techStack.backend.join(", ")}`);
      sections.push(`- **Database:** ${bp.techStack.database}`);
      sections.push(`- **Auth:** ${bp.techStack.auth}`);
      sections.push(`- **Deployment:** ${bp.techStack.deployment.join(", ")}`);
      sections.push(`\n> ${bp.techStack.reasoning}\n`);
    }

    if (bp.databaseSchema?.length) {
      sections.push("## Database Schema\n");
      for (const table of bp.databaseSchema) {
        sections.push(`### ${table.tableName}`);
        sections.push("| Column | Type | Nullable |");
        sections.push("|--------|------|----------|");
        for (const col of table.columns) {
          sections.push(`| ${col.name} | ${col.type} | ${col.nullable ? "Yes" : "No"} |`);
        }
        sections.push("");
      }
    }

    if (bp.apiContracts?.length) {
      sections.push("## API Contracts\n");
      for (const api of bp.apiContracts) {
        sections.push(`### ${api.method} ${api.path}`);
        sections.push(`${api.description}`);
        sections.push(`- Input: \`${api.inputType}\``);
        sections.push(`- Output: \`${api.outputType}\``);
        sections.push(`- Auth: ${api.auth ? "Required" : "Public"}\n`);
      }
    }

    if (bp.adrs?.length) {
      sections.push("## Architecture Decision Records\n");
      for (const adr of bp.adrs) {
        sections.push(`### ADR-${adr.id}: ${adr.title}`);
        sections.push(`**Status:** ${adr.status} | **Date:** ${adr.date}`);
        sections.push(`**Context:** ${adr.context}`);
        sections.push(`**Decision:** ${adr.decision}`);
        sections.push(`**Consequences:**`);
        for (const c of adr.consequences) {
          sections.push(`- ${c}`);
        }
        sections.push("");
      }
    }

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
