import type { AgentAggressiveness, BlueprintEnforcement } from "./enums";

export interface Project {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  repoUrl: string | null;
  techStackPreset: string | null;
  status: "active" | "archived" | "setup";
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSettings {
  projectId: string;
  agentAggressiveness: AgentAggressiveness;
  ciLoopMaxIterations: number;
  parallelAgentCount: number;
  blueprintEnforcement: BlueprintEnforcement;
  testCoverageTarget: number;
  securityScanLevel: "basic" | "standard" | "thorough";
  deployTarget: "staging" | "production" | "manual";
  modelCostBudget: number | null;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: "owner" | "contributor" | "viewer";
}
