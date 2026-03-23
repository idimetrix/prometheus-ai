import { router } from "../trpc";
import { analyticsRouter } from "./analytics";
import { analyticsEnhancedRouter } from "./analytics-enhanced";
import { apiKeysRouter } from "./api-keys";
import { architectureRouter } from "./architecture";
import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { blueprintsEnhancedRouter } from "./blueprints-enhanced";
import { brainRouter } from "./brain";
import { brandingRouter } from "./branding";
import { codeAnalysisRouter } from "./code-analysis";
import { costPredictionRouter } from "./cost-prediction";
import { deploymentsRouter } from "./deployments";
import { fleetRouter } from "./fleet";
import { gdprRouter } from "./gdpr";
import { healthRouter } from "./health";
import { integrationsRouter } from "./integrations";
import { pluginsRouter } from "./plugins";
import { pmRouter } from "./pm";
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
  teamAnalytics: analyticsEnhancedRouter,
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
  pm: pmRouter,
  webhooks: webhooksOutboundRouter,
  branding: brandingRouter,
  costPrediction: costPredictionRouter,
  deployments: deploymentsRouter,
});

export type AppRouter = typeof appRouter;
