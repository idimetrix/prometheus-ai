import { router } from "../trpc";
import { adminRouter } from "./admin";
import { analyticsRouter } from "./analytics";
import { analyticsEnhancedRouter } from "./analytics-enhanced";
import { apiKeysRouter } from "./api-keys";
import { architectureRouter } from "./architecture";
import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { blueprintsEnhancedRouter } from "./blueprints-enhanced";
import { brainRouter } from "./brain";
import { brandingRouter } from "./branding";
import { chatRouter } from "./chat";
import { codeAnalysisRouter } from "./code-analysis";
import { collaborationRouter } from "./collaboration";
import { costPredictionRouter } from "./cost-prediction";
import { customAgentsRouter } from "./custom-agents";
import { deploymentsRouter } from "./deployments";
import { environmentsRouter } from "./environments";
import { exportsRouter } from "./exports";
import { filesRouter } from "./files";
import { fleetRouter } from "./fleet";
import { gdprRouter } from "./gdpr";
import { generateRouter } from "./generate";
import { healthRouter } from "./health";
import { integrationsRouter } from "./integrations";
import { issueSyncRouter } from "./issue-sync";
import { marketplaceRouter } from "./marketplace";
import { notificationsRouter } from "./notifications";
import { permissionsRouter } from "./permissions";
import { playbooksRouter } from "./playbooks";
import { pluginsRouter } from "./plugins";
import { pmRouter } from "./pm";
import { projectsRouter } from "./projects";
import { queueRouter } from "./queue";
import { releasesRouter } from "./releases";
import { secretsRouter } from "./secrets";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { snippetsRouter } from "./snippets";
import { sshKeysRouter } from "./ssh-keys";
import { tasksRouter } from "./tasks";
import { teamRouter } from "./team";
import { uploadsRouter } from "./uploads";
import { userRouter } from "./user";
import { webhooksOutboundRouter } from "./webhooks-outbound";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
  admin: adminRouter,
  health: healthRouter,
  sessions: sessionsRouter,
  tasks: tasksRouter,
  projects: projectsRouter,
  queue: queueRouter,
  secrets: secretsRouter,
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
  customAgents: customAgentsRouter,
  deployments: deploymentsRouter,
  environments: environmentsRouter,
  exports: exportsRouter,
  marketplace: marketplaceRouter,
  playbooks: playbooksRouter,
  issueSync: issueSyncRouter,
  chat: chatRouter,
  collaboration: collaborationRouter,
  files: filesRouter,
  generate: generateRouter,
  notifications: notificationsRouter,
  permissions: permissionsRouter,
  snippets: snippetsRouter,
  team: teamRouter,
  uploads: uploadsRouter,
  workspaces: workspacesRouter,
  releases: releasesRouter,
  sshKeys: sshKeysRouter,
});

export type AppRouter = typeof appRouter;
