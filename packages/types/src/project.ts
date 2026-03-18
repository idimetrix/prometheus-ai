import type { AgentAggressiveness, BlueprintEnforcement } from "./enums";

export interface Project {
  createdAt: Date;
  description: string | null;
  id: string;
  name: string;
  orgId: string;
  repoUrl: string | null;
  status: "active" | "archived" | "setup";
  techStackPreset: string | null;
  updatedAt: Date;
}

export interface ProjectSettings {
  agentAggressiveness: AgentAggressiveness;
  blueprintEnforcement: BlueprintEnforcement;
  ciLoopMaxIterations: number;
  deployTarget: "staging" | "production" | "manual";
  modelCostBudget: number | null;
  parallelAgentCount: number;
  projectId: string;
  securityScanLevel: "basic" | "standard" | "thorough";
  testCoverageTarget: number;
}

export interface ProjectMember {
  projectId: string;
  role: "owner" | "contributor" | "viewer";
  userId: string;
}
