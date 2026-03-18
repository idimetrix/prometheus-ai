import type { ContainerManager } from "./container";
import type { SandboxPool } from "./pool";

export function createHealthCheck(containerManager: ContainerManager, pool: SandboxPool) {
  return () => {
    const stats = pool.getStats();
    return {
      status: "ok",
      pool: stats,
      docker: {
        connected: true,
        activeContainers: containerManager.getActiveCount(),
      },
      timestamp: new Date().toISOString(),
    };
  };
}
