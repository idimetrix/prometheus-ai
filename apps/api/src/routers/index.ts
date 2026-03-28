import { router } from "../trpc";
import { activityRouter } from "./activity";
import { adminRouter } from "./admin";
import { analyticsRouter } from "./analytics";
import { analyticsDashboardRouter } from "./analytics-dashboard";
import { analyticsEnhancedRouter } from "./analytics-enhanced";
import { apiKeysRouter } from "./api-keys";
import { approvalPoliciesRouter } from "./approval-policies";
import { architectureRouter } from "./architecture";
// GAP-041-060 imports
import { architectureAnalysisRouter } from "./architecture-analysis";
import { auditRouter } from "./audit";
// GAP-070-072: Team collab, audit enhanced, data residency
import { auditEnhancedRouter } from "./audit-enhanced";
import { billingRouter } from "./billing";
import { blueprintsEnhancedRouter } from "./blueprints-enhanced";
import { brainRouter } from "./brain";
import { brainEnhancedRouter } from "./brain-enhanced";
import { brandingRouter } from "./branding";
import { browserRouter } from "./browser";
import { byoKeysRouter } from "./byo-keys";
import { chatRouter } from "./chat";
import { codeAnalysisRouter } from "./code-analysis";
import { codeReviewEnhancedRouter } from "./code-review-enhanced";
import { collaborationRouter } from "./collaboration";
import { costPredictionRouter } from "./cost-prediction";
import { customAgentsRouter } from "./custom-agents";
import { dataResidencyRouter } from "./data-residency";
import { deployPreviewRouter } from "./deploy-preview";
import { deploymentsRouter } from "./deployments";
import { designRouter } from "./design";
import { environmentsRouter } from "./environments";
import { experimentsRouter } from "./experiments";
import { exportsRouter } from "./exports";
import { feedbackRouter } from "./feedback";
import { feedbackLearningRouter } from "./feedback-learning";
import { filesRouter } from "./files";
import { fleetRouter } from "./fleet";
import { fleetEnhancedRouter } from "./fleet-enhanced";
import { gdprRouter } from "./gdpr";
import { generateRouter } from "./generate";
import { healthRouter } from "./health";
import { integrationsRouter } from "./integrations";
import { issueSyncRouter } from "./issue-sync";
import { marketplaceRouter } from "./marketplace";
import { mentionsRouter } from "./mentions";
import { notificationPreferencesRouter } from "./notification-preferences";
import { notificationsRouter } from "./notifications";
import { permissionsRouter } from "./permissions";
import { persistentEnvsRouter } from "./persistent-envs";
import { pipelinesRouter } from "./pipelines";
import { playbookEngineRouter } from "./playbook-engine";
import { playbooksRouter } from "./playbooks";
import { pluginMarketplaceRouter } from "./plugin-marketplace";
import { pluginsRouter } from "./plugins";
import { pmRouter } from "./pm";
import { previewRouter } from "./preview";
import { projectsRouter } from "./projects";
import { promptVersionsRouter } from "./prompt-versions";
import { queueRouter } from "./queue";
import { releasesRouter } from "./releases";
import { replayRouter } from "./replay";
import { rolesRouter } from "./roles";
import { scheduledTasksRouter } from "./scheduled-tasks";
import { searchRouter } from "./search";
import { secretsRouter } from "./secrets";
import { securityDashboardRouter } from "./security-dashboard";
import { sessionSharingRouter } from "./session-sharing";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { snippetsRouter } from "./snippets";
import { sprintPlanningRouter } from "./sprint-planning";
import { sshKeysRouter } from "./ssh-keys";
import { ssoRouter } from "./sso";
import { tasksRouter } from "./tasks";
import { teamRouter } from "./team";
import { teamCollabRouter } from "./team-collab";
import { teamDashboardRouter } from "./team-dashboard";
import { uploadsRouter } from "./uploads";
import { userRouter } from "./user";
import { webhooksOutboundRouter } from "./webhooks-outbound";
import { whiteLabelRouter } from "./white-label";
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
  design: designRouter,
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
  // Phase 2+ new routers
  fleetEnhanced: fleetEnhancedRouter,
  replay: replayRouter,
  feedbackLearning: feedbackLearningRouter,
  activity: activityRouter,
  analyticsDashboard: analyticsDashboardRouter,
  approvalPolicies: approvalPoliciesRouter,
  experiments: experimentsRouter,
  feedback: feedbackRouter,
  roles: rolesRouter,
  scheduledTasks: scheduledTasksRouter,
  securityDashboard: securityDashboardRouter,
  sessionSharing: sessionSharingRouter,
  sso: ssoRouter,
  pipelines: pipelinesRouter,
  preview: previewRouter,
  browser: browserRouter,
  teamDashboard: teamDashboardRouter,
  // GAP routers
  codeReview: codeReviewEnhancedRouter,
  deployPreview: deployPreviewRouter,
  mentions: mentionsRouter,
  playbookEngine: playbookEngineRouter,
  persistentEnvs: persistentEnvsRouter,
  // GAP-036: Enhanced brain context
  brainEnhanced: brainEnhancedRouter,
  // GAP-039: Notification preferences
  notificationPreferences: notificationPreferencesRouter,
  // GAP-089: Search infrastructure
  search: searchRouter,
  // GAP-050: Plugin marketplace
  pluginMarketplace: pluginMarketplaceRouter,
  // GAP-053: Sprint planning
  sprintPlanning: sprintPlanningRouter,
  // GAP-054: Architecture analysis
  architectureAnalysis: architectureAnalysisRouter,
  // GAP-055: BYO API keys
  byoKeys: byoKeysRouter,
  // GAP-056: Prompt versioning
  promptVersions: promptVersionsRouter,
  // GAP-069: White-label configuration
  whiteLabel: whiteLabelRouter,
  // GAP-070: Team collaboration
  teamCollab: teamCollabRouter,
  // GAP-071: Enhanced audit trail
  auditEnhanced: auditEnhancedRouter,
  // GAP-072: Data residency
  dataResidency: dataResidencyRouter,
});

export type AppRouter = typeof appRouter;
