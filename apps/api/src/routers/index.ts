import { router } from "../trpc";
import { analyticsRouter } from "./analytics";
import { apiKeysRouter } from "./api-keys";
import { billingRouter } from "./billing";
import { brainRouter } from "./brain";
import { fleetRouter } from "./fleet";
import { healthRouter } from "./health";
import { integrationsRouter } from "./integrations";
import { projectsRouter } from "./projects";
import { queueRouter } from "./queue";
import { sessionsRouter } from "./sessions";
import { settingsRouter } from "./settings";
import { tasksRouter } from "./tasks";
import { userRouter } from "./user";

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
});

export type AppRouter = typeof appRouter;
