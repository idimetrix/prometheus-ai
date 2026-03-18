import { router } from "../trpc";
import { healthRouter } from "./health";
import { sessionsRouter } from "./sessions";
import { tasksRouter } from "./tasks";
import { projectsRouter } from "./projects";
import { queueRouter } from "./queue";
import { billingRouter } from "./billing";
import { analyticsRouter } from "./analytics";
import { settingsRouter } from "./settings";
import { brainRouter } from "./brain";
import { fleetRouter } from "./fleet";
import { userRouter } from "./user";
import { integrationsRouter } from "./integrations";

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
});

export type AppRouter = typeof appRouter;
