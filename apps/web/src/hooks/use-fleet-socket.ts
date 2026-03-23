"use client";

import { useCallback, useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";
import {
  type FleetAgent,
  type FleetConflict,
  useFleetStore,
} from "@/stores/fleet.store";

export function useFleetSocket(sessionId: string | null) {
  const addAgent = useFleetStore((s) => s.addAgent);
  const updateAgent = useFleetStore((s) => s.updateAgent);
  const addConflict = useFleetStore((s) => s.addConflict);
  const clearFleet = useFleetStore((s) => s.clearFleet);
  const connectedRef = useRef(false);

  const handleAgentUpdate = useCallback(
    (data: FleetAgent & Partial<FleetAgent>) => {
      const store = useFleetStore.getState();
      if (store.agents.has(data.id)) {
        updateAgent(data.id, data);
      } else {
        addAgent({
          id: data.id,
          role: data.role,
          status: data.status ?? "idle",
          taskId: data.taskId,
          progress: data.progress ?? 0,
          filesChanged: data.filesChanged ?? [],
        });
      }
    },
    [addAgent, updateAgent]
  );

  const handleConflict = useCallback(
    (data: FleetConflict) => {
      addConflict(data);
    },
    [addConflict]
  );

  const handleComplete = useCallback(
    (data: { agentId: string }) => {
      updateAgent(data.agentId, { status: "completed", progress: 100 });
    },
    [updateAgent]
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    socket.emit("join", { room: `fleet:${sessionId}` });
    connectedRef.current = true;

    socket.on("fleet:agent_update", handleAgentUpdate);
    socket.on("fleet:conflict", handleConflict);
    socket.on("fleet:complete", handleComplete);

    return () => {
      socket.off("fleet:agent_update", handleAgentUpdate);
      socket.off("fleet:conflict", handleConflict);
      socket.off("fleet:complete", handleComplete);
      socket.emit("leave", { room: `fleet:${sessionId}` });
      connectedRef.current = false;
      clearFleet();
    };
  }, [
    sessionId,
    handleAgentUpdate,
    handleConflict,
    handleComplete,
    clearFleet,
  ]);

  return { isConnected: connectedRef.current };
}
