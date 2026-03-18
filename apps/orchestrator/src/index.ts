import { createLogger } from "@prometheus/logger";
import { SessionManager } from "./session-manager";
import { TaskRouter } from "./task-router";

const logger = createLogger("orchestrator");

const sessionManager = new SessionManager();
const taskRouter = new TaskRouter(sessionManager);

logger.info("Agent Orchestrator initialized");

export { sessionManager, taskRouter };
export { SessionManager } from "./session-manager";
export { TaskRouter } from "./task-router";
export { AgentLoop } from "./agent-loop";
