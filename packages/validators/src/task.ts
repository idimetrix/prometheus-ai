import { z } from "zod";

export const submitTaskSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
});

export const fleetDispatchSchema = z.object({
  sessionId: z.string().min(1),
  tasks: z.array(z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    agentRole: z.enum([
      "orchestrator", "discovery", "architect", "planner",
      "frontend_coder", "backend_coder", "integration_coder",
      "test_engineer", "ci_loop", "security_auditor", "deploy_engineer",
      "project_brain",
    ]).optional(),
  })).min(1).max(10),
});

export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;
export type FleetDispatchInput = z.infer<typeof fleetDispatchSchema>;
