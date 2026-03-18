import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("agent-sdk:protocol:discovery");

export interface SoftwareRequirementsSpec {
  id: string;
  projectId: string;
  who: {
    personas: string[];
    jobsToBeDone: string[];
  };
  what: {
    coreFeatures: string[];
    description: string;
  };
  notInScope: string[];
  acceptanceCriteria: Array<{
    criterion: string;
    testable: boolean;
  }>;
  risks: Array<{
    risk: string;
    severity: "low" | "medium" | "high";
    mitigation: string;
  }>;
  confidenceScore: number;
  requiresClarification: string[];
}

export interface DiscoveryQuestion {
  id: string;
  category: "who" | "what" | "not" | "done" | "risk";
  question: string;
  required: boolean;
}

const DISCOVERY_QUESTIONS: DiscoveryQuestion[] = [
  {
    id: "who_1",
    category: "who",
    question: "Who are the primary users of this feature? What are their roles and goals?",
    required: true,
  },
  {
    id: "what_1",
    category: "what",
    question: "What are the 3 most important capabilities this feature must have?",
    required: true,
  },
  {
    id: "not_1",
    category: "not",
    question: "What is explicitly out of scope for this version? What should we NOT build?",
    required: true,
  },
  {
    id: "done_1",
    category: "done",
    question: "How will we know this is done? What are the testable acceptance criteria?",
    required: true,
  },
  {
    id: "risk_1",
    category: "risk",
    question: "What are the top 3 risks or failure modes? What could go wrong?",
    required: true,
  },
];

export class DiscoveryProtocol {
  private spec: Partial<SoftwareRequirementsSpec> = {};

  constructor(private projectId: string) {
    this.spec = {
      id: generateId("srs"),
      projectId,
      who: { personas: [], jobsToBeDone: [] },
      what: { coreFeatures: [], description: "" },
      notInScope: [],
      acceptanceCriteria: [],
      risks: [],
      confidenceScore: 0,
      requiresClarification: [],
    };
  }

  getQuestions(): DiscoveryQuestion[] {
    return DISCOVERY_QUESTIONS;
  }

  getNextUnansweredQuestion(): DiscoveryQuestion | null {
    const answered = new Set<string>();
    if (this.spec.who?.personas.length) answered.add("who");
    if (this.spec.what?.coreFeatures.length) answered.add("what");
    if (this.spec.notInScope?.length) answered.add("not");
    if (this.spec.acceptanceCriteria?.length) answered.add("done");
    if (this.spec.risks?.length) answered.add("risk");

    return DISCOVERY_QUESTIONS.find((q) => !answered.has(q.category)) ?? null;
  }

  processAnswer(category: string, answer: string): void {
    switch (category) {
      case "who":
        this.spec.who = {
          personas: this.extractList(answer),
          jobsToBeDone: this.extractList(answer),
        };
        break;
      case "what":
        this.spec.what = {
          coreFeatures: this.extractList(answer),
          description: answer,
        };
        break;
      case "not":
        this.spec.notInScope = this.extractList(answer);
        break;
      case "done":
        this.spec.acceptanceCriteria = this.extractList(answer).map((c) => ({
          criterion: c,
          testable: true,
        }));
        break;
      case "risk":
        this.spec.risks = this.extractList(answer).map((r) => ({
          risk: r,
          severity: "medium" as const,
          mitigation: "",
        }));
        break;
    }

    this.spec.confidenceScore = this.calculateConfidence();
  }

  calculateConfidence(): number {
    let score = 0;
    const weights = { who: 0.15, what: 0.30, not: 0.15, done: 0.25, risk: 0.15 };

    if (this.spec.who?.personas.length) score += weights.who;
    if (this.spec.what?.coreFeatures.length) score += weights.what;
    if (this.spec.notInScope?.length) score += weights.not;
    if (this.spec.acceptanceCriteria?.length) score += weights.done;
    if (this.spec.risks?.length) score += weights.risk;

    return Math.round(score * 100) / 100;
  }

  isReadyToProceed(): boolean {
    return this.calculateConfidence() >= 0.8;
  }

  getSpec(): SoftwareRequirementsSpec {
    return this.spec as SoftwareRequirementsSpec;
  }

  generateSystemPromptContext(): string {
    const spec = this.spec;
    return `
## Software Requirements Specification
**Confidence Score:** ${spec.confidenceScore}

### Users & Personas
${spec.who?.personas.join("\n- ") || "Not yet defined"}

### Core Features
${spec.what?.coreFeatures.join("\n- ") || "Not yet defined"}

### Out of Scope
${spec.notInScope?.join("\n- ") || "Not yet defined"}

### Acceptance Criteria
${spec.acceptanceCriteria?.map((c) => `- [${c.testable ? "x" : " "}] ${c.criterion}`).join("\n") || "Not yet defined"}

### Risks
${spec.risks?.map((r) => `- [${r.severity}] ${r.risk}`).join("\n") || "Not yet defined"}
    `.trim();
  }

  private extractList(text: string): string[] {
    // Split by newlines, numbered lists, or bullet points
    return text
      .split(/[\n\r]+/)
      .map((line) => line.replace(/^[\s\-\*\d.]+/, "").trim())
      .filter((line) => line.length > 0);
  }
}
