"use client";

import { Button } from "@prometheus/ui";
import { CheckCircle, Pause, Play, Square, XCircle } from "lucide-react";
import { useState } from "react";

interface SessionControlsProps {
  onCancel: (sessionId: string) => Promise<void>;
  onPause: (sessionId: string) => Promise<void>;
  onResume: (sessionId: string) => Promise<void>;
  sessionId: string;
  status: string;
}

export function SessionControls({
  sessionId,
  status,
  onPause,
  onResume,
  onCancel,
}: SessionControlsProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (
    action: string,
    fn: (id: string) => Promise<void>
  ) => {
    setLoading(action);
    try {
      await fn(sessionId);
    } finally {
      setLoading(null);
    }
  };

  const isActive = status === "active" || status === "running";
  const isPaused = status === "paused";
  const isEnded =
    status === "completed" || status === "cancelled" || status === "failed";

  if (isEnded) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {isActive && (
        <Button
          disabled={loading !== null}
          onClick={() => handleAction("pause", onPause)}
          size="sm"
          variant="outline"
        >
          <Pause className="mr-1 h-4 w-4" />
          {loading === "pause" ? "Pausing..." : "Pause"}
        </Button>
      )}
      {isPaused && (
        <Button
          disabled={loading !== null}
          onClick={() => handleAction("resume", onResume)}
          size="sm"
          variant="outline"
        >
          <Play className="mr-1 h-4 w-4" />
          {loading === "resume" ? "Resuming..." : "Resume"}
        </Button>
      )}
      <Button
        disabled={loading !== null}
        onClick={() => handleAction("cancel", onCancel)}
        size="sm"
        variant="destructive"
      >
        <Square className="mr-1 h-4 w-4" />
        {loading === "cancel" ? "Cancelling..." : "Cancel"}
      </Button>
    </div>
  );
}

interface ApprovalPromptProps {
  checkpointId: string;
  message: string;
  onApprove: (checkpointId: string) => Promise<void>;
  onReject: (checkpointId: string, reason?: string) => Promise<void>;
}

export function ApprovalPrompt({
  checkpointId,
  message,
  onApprove,
  onReject,
}: ApprovalPromptProps) {
  const [loading, setLoading] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="text-foreground text-sm">{message}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          disabled={loading !== null}
          onClick={async () => {
            setLoading("approve");
            try {
              await onApprove(checkpointId);
            } finally {
              setLoading(null);
            }
          }}
          size="sm"
        >
          <CheckCircle className="mr-1 h-4 w-4" />
          {loading === "approve" ? "Approving..." : "Approve"}
        </Button>
        <Button
          disabled={loading !== null}
          onClick={async () => {
            setLoading("reject");
            try {
              await onReject(checkpointId);
            } finally {
              setLoading(null);
            }
          }}
          size="sm"
          variant="destructive"
        >
          <XCircle className="mr-1 h-4 w-4" />
          {loading === "reject" ? "Rejecting..." : "Reject"}
        </Button>
      </div>
    </div>
  );
}
