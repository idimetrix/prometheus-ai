import type { AgentMode } from "@prometheus/types";
import { AskModeHandler } from "./ask";
import { FleetModeHandler } from "./fleet";
import { PlanModeHandler } from "./plan";
import { TaskModeHandler } from "./task";
import type { ModeHandler } from "./types";
import { WatchModeHandler } from "./watch";

export type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const MODE_HANDLERS: Record<string, ModeHandler> = {
  ask: new AskModeHandler(),
  task: new TaskModeHandler(),
  plan: new PlanModeHandler(),
  watch: new WatchModeHandler(),
  fleet: new FleetModeHandler(),
};

export function getModeHandler(mode: AgentMode): ModeHandler {
  const handler = MODE_HANDLERS[mode];
  if (!handler) {
    throw new Error(
      `Unknown mode: ${mode}. Available: ${Object.keys(MODE_HANDLERS).join(", ")}`
    );
  }
  return handler;
}

export { AskModeHandler } from "./ask";
export { FleetModeHandler } from "./fleet";
export { PlanModeHandler } from "./plan";
export { TaskModeHandler } from "./task";
export { WatchModeHandler } from "./watch";
