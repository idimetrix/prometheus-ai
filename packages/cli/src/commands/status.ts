import { Command } from "commander";
import { APIClient } from "../api-client";

export const statusCommand = new Command("status")
  .description("View running agents, queue depth, and service health")
  .action(async () => {
    const client = new APIClient();

    try {
      const status = await client.getStatus();

      console.log("Prometheus Platform Status\n");
      console.log(`Active Agents:  ${status.activeAgents}`);
      console.log(`Queue Depth:    ${status.queueDepth}`);
      console.log("\nServices:");

      for (const [service, healthy] of Object.entries(status.services)) {
        const icon = healthy ? "OK" : "DOWN";
        console.log(`  ${service}: ${icon}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error connecting to Prometheus: ${msg}`);
      console.error("Is the API server running?");
      process.exit(1);
    }
  });
