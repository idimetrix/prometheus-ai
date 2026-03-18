"use client";
import { use } from "react";
import { useSessionSocket } from "@/hooks/useSessionSocket";
import { useSessionStore } from "@/stores/session.store";
import {
  Terminal,
  Plan,
  FileTree,
  PromptInput,
  QueuePosition,
} from "@prometheus/ui";

export default function SessionPage({
  params,
}: {
  params: Promise<{ projectId: string; sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { isConnected } = useSessionSocket(sessionId);
  const { terminalLines, planSteps, fileTree, queuePosition } = useSessionStore();

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] gap-4">
      {/* Left Panel: File Tree + Plan */}
      <div className="w-64 shrink-0 space-y-4 overflow-auto">
        <div>
          <h3 className="text-sm font-medium mb-2">Files</h3>
          <FileTree
            files={fileTree as Parameters<typeof FileTree>[0]["files"]}
            className="max-h-[40vh]"
          />
        </div>
        <div>
          <h3 className="text-sm font-medium mb-2">Plan</h3>
          <Plan
            steps={planSteps as Parameters<typeof Plan>[0]["steps"]}
          />
        </div>
      </div>

      {/* Center Panel: Terminal + Input */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-sm text-muted-foreground">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <span className="text-xs text-muted-foreground font-mono">{sessionId}</span>
        </div>

        {queuePosition > 0 && (
          <QueuePosition
            position={queuePosition}
            estimatedWaitSeconds={queuePosition * 120}
            totalInQueue={queuePosition + 2}
            className="mb-2"
          />
        )}

        <Terminal
          lines={terminalLines}
          className="flex-1 min-h-0"
        />

        <PromptInput
          onSubmit={(value) => {
            // TODO: Send message to agent via socket
            console.log("Submit:", value);
          }}
          placeholder="Send a message to the agent..."
          className="mt-2"
        />
      </div>
    </div>
  );
}
