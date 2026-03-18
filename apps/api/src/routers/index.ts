import { router } from "../trpc";
import { healthRouter } from "./health";
import { sessionsRouter } from "./sessions";
import { tasksRouter } from "./tasks";
import { projectsRouter } from "./projects";
import { queueRouter } from "./queue";
import { billingRouter } from "./billing";
import { analyticsRouter } from "./analytics";
import { settingsRouter } from "./settings";

export const appRouter = router({
  health: healthRouter,
  sessions: sessionsRouter,
  tasks: tasksRouter,
  projects: projectsRouter,
  queue: queueRouter,
  billing: billingRouter,
  analytics: analyticsRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
