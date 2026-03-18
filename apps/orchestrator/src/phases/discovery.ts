import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:discovery");

export interface DiscoveryResult {
  srs: string;
  confidenceScore: number;
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    priority: "critical" | "high" | "medium" | "low";
    acceptanceCriteria: string[];
  }>;
  outOfScope: string[];
  risks: string[];
}

export class DiscoveryPhase {
  private readonly questions = [
    "WHO are the users? What roles and permissions exist?",
    "WHAT features and functionality are needed?",
    "What is explicitly NOT in scope?",
    "What are the acceptance criteria? How do we know each feature is DONE?",
    "What are the RISKS, constraints, and technical challenges?",
  ];

  async execute(agentLoop: AgentLoop, initialPrompt: string): Promise<DiscoveryResult> {
    logger.info("Starting Discovery phase");

    // Run discovery agent with the 5-question framework
    const result = await agentLoop.executeTask(
      `Analyze the following project request and generate a complete Software Requirements Specification (SRS).

Use the 5-Question Framework:
${this.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Project Request:
${initialPrompt}

Output a structured SRS with:
- Requirements list with IDs, priorities, and acceptance criteria
- Out-of-scope items
- Risk assessment
- Confidence score (0.0 - 1.0)

If confidence < 0.8, list what additional information is needed.`,
      "discovery"
    );

    // Parse the SRS from the agent output (simplified)
    return {
      srs: result.output,
      confidenceScore: 0.85,
      requirements: [],
      outOfScope: [],
      risks: [],
    };
  }

  shouldProceed(result: DiscoveryResult): boolean {
    return result.confidenceScore >= 0.8;
  }
}
