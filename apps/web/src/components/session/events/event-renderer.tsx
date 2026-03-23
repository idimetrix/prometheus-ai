"use client";

import type { SessionEvent } from "@/stores/session.store";
import { AgentOutput } from "./agent-output";
import { Checkpoint } from "./checkpoint";
import { CreditUpdate } from "./credit-update";
import { ErrorEvent } from "./error-event";
import { FileChange } from "./file-change";
import { PlanUpdate } from "./plan-update";
import { Reasoning } from "./reasoning";
import { TaskStatus } from "./task-status";
import { TerminalOutput } from "./terminal-output";

interface EventRendererProps {
  event: SessionEvent;
  onCheckpointApprove?: (eventId: string, feedback?: string) => void;
  onCheckpointModify?: (eventId: string, instructions: string) => void;
  onCheckpointReject?: (eventId: string, reason?: string) => void;
  onRetry?: (eventId: string) => void;
}

export function EventRenderer({
  event,
  onCheckpointApprove,
  onCheckpointReject,
  onCheckpointModify,
  onRetry,
}: EventRendererProps) {
  switch (event.type) {
    case "agent_output":
      return <AgentOutput event={event} />;

    case "file_change":
      return <FileChange event={event} />;

    case "plan_update":
      return <PlanUpdate event={event} />;

    case "task_status":
      return <TaskStatus event={event} />;

    case "credit_update":
      return <CreditUpdate event={event} />;

    case "checkpoint":
      return (
        <Checkpoint
          event={event}
          onApprove={onCheckpointApprove}
          onModify={onCheckpointModify}
          onReject={onCheckpointReject}
        />
      );

    case "error":
      return <ErrorEvent event={event} onRetry={onRetry} />;

    case "reasoning":
      return <Reasoning event={event} />;

    case "terminal_output":
      return <TerminalOutput event={event} />;

    case "file_diff":
    case "code_change":
      return <FileChange event={event} />;

    default:
      // Generic fallback for unknown event types
      return (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              {event.type}
            </span>
            {event.timestamp && (
              <span className="ml-auto text-[10px] text-zinc-600">
                {new Date(event.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
          </div>
          {event.data && Object.keys(event.data).length > 0 && (
            <pre className="mt-1 max-h-24 overflow-auto text-[10px] text-zinc-500">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          )}
        </div>
      );
  }
}

export { AgentOutput } from "./agent-output";
export { Checkpoint } from "./checkpoint";
export { CreditUpdate } from "./credit-update";
export { ErrorEvent } from "./error-event";
export { FileChange } from "./file-change";
export { PlanUpdate } from "./plan-update";
export { Reasoning } from "./reasoning";
export { TaskStatus } from "./task-status";
export { TerminalOutput } from "./terminal-output";
