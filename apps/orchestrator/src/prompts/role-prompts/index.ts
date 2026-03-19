export { getArchitectPrompt } from "./architect";
export { getBackendCoderPrompt } from "./backend-coder";
export { getCILoopPrompt } from "./ci-loop";
export { getCriticPrompt } from "./critic";
export { getDeployEngineerPrompt } from "./deploy-engineer";
export { getDiscoveryPrompt } from "./discovery";
export { getFrontendCoderPrompt } from "./frontend-coder";
export { getIntegrationCoderPrompt } from "./integration-coder";
export { getPlannerPrompt } from "./planner";
export { getReviewerPrompt } from "./reviewer";
export { getSecurityAuditorPrompt } from "./security-auditor";
export { getTestEngineerPrompt } from "./test-engineer";

import { getArchitectPrompt } from "./architect";
import { getBackendCoderPrompt } from "./backend-coder";
import { getCILoopPrompt } from "./ci-loop";
import { getCriticPrompt } from "./critic";
import { getDeployEngineerPrompt } from "./deploy-engineer";
import { getDiscoveryPrompt } from "./discovery";
import { getFrontendCoderPrompt } from "./frontend-coder";
import { getIntegrationCoderPrompt } from "./integration-coder";
import { getPlannerPrompt } from "./planner";
import { getReviewerPrompt } from "./reviewer";
import { getSecurityAuditorPrompt } from "./security-auditor";
import { getTestEngineerPrompt } from "./test-engineer";

export const ROLE_PROMPTS: Record<
  string,
  (context?: { blueprint?: string; conventions?: string }) => string
> = {
  architect: getArchitectPrompt,
  "backend-coder": getBackendCoderPrompt,
  "ci-loop": getCILoopPrompt,
  critic: getCriticPrompt,
  "deploy-engineer": getDeployEngineerPrompt,
  discovery: getDiscoveryPrompt,
  "frontend-coder": getFrontendCoderPrompt,
  "integration-coder": getIntegrationCoderPrompt,
  planner: getPlannerPrompt,
  reviewer: getReviewerPrompt,
  "security-auditor": getSecurityAuditorPrompt,
  "test-engineer": getTestEngineerPrompt,
};
