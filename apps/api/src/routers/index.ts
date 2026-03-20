import { router } from "../trpc";
import { analyticsRouter } from "./analytics";
import { apiKeysRouter } from "./api-keys";
import { architectureRouter } from "./architecture";
import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { blueprintsEnhancedRouter } from "./blueprints-enhanced";
import { brainRouter } from "./brain";
import { codeAnalysisRouter } from "./code-analysis";
import { fleetRouter } from "./fleet";
import { gdprRouter } from "./gdpr";
import { healthRouter } from "./health";
import { integrationsRouter } from "./integrations";
import { pluginsRouter } from "./plugins";
import { projectsRouter } from "./projects";
import { queueRouter } from "./queue";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { tasksRouter } from "./tasks";
import { userRouter } from "./user";
import { webhooksOutboundRouter } from "./webhooks-outbound";

export const appRouter = router({
  health: healthRouter,
  sessions: sessionsRouter,
  tasks: tasksRouter,
  projects: projectsRouter,
  queue: queueRouter,
  billing: billingRouter,
  stats: analyticsRouter,
  settings: settingsRouter,
  brain: brainRouter,
  fleet: fleetRouter,
  user: userRouter,
  integrations: integrationsRouter,
  apiKeys: apiKeysRouter,
  plugins: pluginsRouter,
  architecture: architectureRouter,
  codeAnalysis: codeAnalysisRouter,
  audit: auditRouter,
  blueprintsEnhanced: blueprintsEnhancedRouter,
  gdpr: gdprRouter,
  webhooks: webhooksOutboundRouter,
});

export type AppRouter = typeof appRouter;
