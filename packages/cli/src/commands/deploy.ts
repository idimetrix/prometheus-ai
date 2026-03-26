import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";

interface DeploymentStatus {
  deploymentId: string;
  error?: string;
  status: "queued" | "building" | "deploying" | "live" | "failed";
  url?: string;
}

function displayProgress(status: DeploymentStatus): void {
  const icons: Record<string, string> = {
    queued: "[WAIT]",
    building: "[BUILD]",
    deploying: "[DEPLOY]",
    live: "[LIVE]",
    failed: "[FAIL]",
  };
  const icon = icons[status.status] ?? "[...]";
  console.log(`${icon} ${status.status}`);
  if (status.url) {
    console.log(`  URL: ${status.url}`);
  }
  if (status.error) {
    console.log(`  Error: ${status.error}`);
  }
}

interface DeployOpts {
  apiKey?: string;
  apiUrl?: string;
  env: string;
  project?: string;
  provider: string;
}

export const deployCommand = new Command("deploy")
  .description("Deploy project to production or staging")
  .option("-p, --project <id>", "Project ID")
  .option(
    "-e, --env <environment>",
    "Deployment environment (production|staging)",
    "production"
  )
  .option(
    "--provider <provider>",
    "Deployment provider (vercel|netlify|docker)",
    "docker"
  )
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (opts: DeployOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = config.projectId;

    if (!projectId) {
      console.error(
        "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
      );
      process.exit(1);
    }

    try {
      console.log(
        `Deploying project ${projectId} to ${opts.env} via ${opts.provider}...\n`
      );

      const result = await client.triggerDeployment({
        projectId,
        environment: opts.env,
        provider: opts.provider,
      });

      console.log(`Deployment created: ${result.deploymentId}`);
      console.log("Waiting for deployment to complete...\n");

      // Poll for deployment status
      let complete = false;
      while (!complete) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const status = await client.getDeploymentStatus(result.deploymentId);
        displayProgress(status);

        if (status.status === "live") {
          complete = true;
          console.log("\nDeployment successful!");
          if (status.url) {
            console.log(`Live at: ${status.url}`);
          }
        } else if (status.status === "failed") {
          complete = true;
          console.error("\nDeployment failed.");
          if (status.error) {
            console.error(`Error: ${status.error}`);
          }
          process.exit(1);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
