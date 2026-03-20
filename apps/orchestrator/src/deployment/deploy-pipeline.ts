/**
 * Deployment Pipeline (P4.3).
 *
 * Orchestrates the full deployment lifecycle: PR creation, preview deployment,
 * smoke testing, canary rollout, promotion, and rollback -- all via MCP adapters.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:deploy-pipeline");

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";
const MCP_GATEWAY_URL = process.env.MCP_GATEWAY_URL ?? "http://localhost:4005";

/** Timeout for individual deploy steps in milliseconds. */
const STEP_TIMEOUT_MS = 120_000;

/** Timeout for smoke tests in milliseconds. */
const SMOKE_TEST_TIMEOUT_MS = 180_000;

export interface DeploymentPlan {
  branch: string;
  createdAt: string;
  id: string;
  previewUrl?: string;
  projectId: string;
  prUrl?: string;
  status: "pending" | "running" | "success" | "failed" | "rolled_back";
  steps: DeployStep[];
}

export interface DeployStep {
  durationMs?: number;
  id: string;
  name: string;
  output?: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  type:
    | "create_pr"
    | "preview"
    | "smoke_test"
    | "canary"
    | "promote"
    | "rollback"
    | "notify";
}

type DeploymentPlanInput = Omit<DeploymentPlan, "id" | "status" | "createdAt">;

export class DeployPipeline {
  private readonly orchestratorUrl: string;
  private readonly mcpGatewayUrl: string;

  constructor(opts?: { orchestratorUrl?: string; mcpGatewayUrl?: string }) {
    this.orchestratorUrl = opts?.orchestratorUrl ?? ORCHESTRATOR_URL;
    this.mcpGatewayUrl = opts?.mcpGatewayUrl ?? MCP_GATEWAY_URL;
  }

  /**
   * Execute the full deployment pipeline.
   * Steps are executed in order. If a step fails, subsequent steps are skipped
   * and a rollback is attempted if a preview was deployed.
   */
  async execute(input: DeploymentPlanInput): Promise<DeploymentPlan> {
    const plan: DeploymentPlan = {
      ...input,
      id: generateId(),
      status: "running",
      createdAt: new Date().toISOString(),
    };

    logger.info(
      {
        deploymentId: plan.id,
        projectId: plan.projectId,
        branch: plan.branch,
        stepCount: plan.steps.length,
      },
      "Starting deployment pipeline"
    );

    let hasDeployedPreview = false;

    for (const step of plan.steps) {
      const stepStart = performance.now();
      step.status = "running";

      try {
        const result = await this.executeStep(plan, step);
        step.status = "success";
        step.output = result.output;
        step.durationMs = Math.round(performance.now() - stepStart);

        // Track state for rollback decisions
        if (step.type === "preview") {
          hasDeployedPreview = true;
          plan.previewUrl = result.previewUrl;
        }

        if (step.type === "create_pr") {
          plan.prUrl = result.prUrl;
        }

        logger.info(
          {
            deploymentId: plan.id,
            stepId: step.id,
            stepType: step.type,
            durationMs: step.durationMs,
          },
          `Step "${step.name}" completed successfully`
        );
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        step.status = "failed";
        step.output = msg;
        step.durationMs = Math.round(performance.now() - stepStart);

        logger.error(
          {
            deploymentId: plan.id,
            stepId: step.id,
            stepType: step.type,
            error: msg,
          },
          `Step "${step.name}" failed`
        );

        // Skip remaining steps
        this.skipRemainingSteps(plan, step);

        // Attempt rollback if we deployed a preview
        if (hasDeployedPreview) {
          await this.attemptRollback(plan);
        } else {
          plan.status = "failed";
        }

        // Send failure notification
        await this.notifySlack(
          plan.projectId,
          `Deployment ${plan.id} failed at step "${step.name}": ${msg}`
        ).catch(() => {
          // Notification failure should not mask the deploy failure
        });

        return plan;
      }
    }

    plan.status = "success";

    logger.info(
      {
        deploymentId: plan.id,
        projectId: plan.projectId,
        branch: plan.branch,
        prUrl: plan.prUrl,
        previewUrl: plan.previewUrl,
      },
      "Deployment pipeline completed successfully"
    );

    return plan;
  }

  /**
   * Create a PR via the MCP GitHub adapter.
   */
  private async createPR(
    projectId: string,
    branch: string,
    title: string,
    body: string
  ): Promise<{ url: string; number: number }> {
    const response = await fetch(
      `${this.mcpGatewayUrl}/api/adapters/github/pr`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, branch, title, body }),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `GitHub PR creation failed (${response.status}): ${errorBody.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as { url: string; number: number };

    logger.info(
      { projectId, branch, prUrl: data.url, prNumber: data.number },
      "Created pull request"
    );

    return data;
  }

  /**
   * Deploy a preview environment via the MCP Vercel adapter.
   */
  private async deployPreview(
    projectId: string,
    branch: string
  ): Promise<{ url: string }> {
    const response = await fetch(
      `${this.mcpGatewayUrl}/api/adapters/vercel/deploy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, branch, type: "preview" }),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Preview deployment failed (${response.status}): ${errorBody.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as {
      url: string;
      deploymentId: string;
    };

    logger.info(
      { projectId, branch, previewUrl: data.url },
      "Preview environment deployed"
    );

    return { url: data.url };
  }

  /**
   * Run smoke tests against a preview URL in a sandboxed environment.
   */
  private async runSmokeTests(
    projectId: string,
    previewUrl: string
  ): Promise<{ passed: boolean; output: string }> {
    const response = await fetch(
      `${this.orchestratorUrl}/api/sandbox/smoke-test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, targetUrl: previewUrl }),
        signal: AbortSignal.timeout(SMOKE_TEST_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        passed: false,
        output: `Smoke test request failed (${response.status}): ${errorBody.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as {
      passed: boolean;
      output: string;
      testCount: number;
      failedCount: number;
    };

    logger.info(
      {
        projectId,
        previewUrl,
        passed: data.passed,
        testCount: data.testCount,
        failedCount: data.failedCount,
      },
      "Smoke tests completed"
    );

    return { passed: data.passed, output: data.output };
  }

  /**
   * Send a notification via the MCP Slack adapter.
   */
  private async notifySlack(projectId: string, message: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.mcpGatewayUrl}/api/adapters/slack/notify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, message }),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!response.ok) {
        logger.warn(
          { projectId, status: response.status },
          "Slack notification failed"
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { projectId, error: msg },
        "Could not send Slack notification"
      );
    }
  }

  /**
   * Roll back a deployment by removing the preview environment.
   */
  private async rollback(
    projectId: string,
    deploymentId: string
  ): Promise<void> {
    logger.info({ projectId, deploymentId }, "Rolling back deployment");

    try {
      const response = await fetch(
        `${this.mcpGatewayUrl}/api/adapters/vercel/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, deploymentId }),
          signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        }
      );

      if (response.ok) {
        logger.info(
          { projectId, deploymentId },
          "Rollback completed successfully"
        );
      } else {
        logger.error(
          { projectId, deploymentId, status: response.status },
          "Rollback request failed"
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ projectId, deploymentId, error: msg }, "Rollback failed");
    }
  }

  // ── Private helpers ──

  private async executeStep(
    plan: DeploymentPlan,
    step: DeployStep
  ): Promise<{
    output: string;
    prUrl?: string;
    previewUrl?: string;
  }> {
    switch (step.type) {
      case "create_pr": {
        const prTitle = `Deploy: ${plan.branch}`;
        const prBody = `Automated deployment from branch \`${plan.branch}\`.\n\nDeployment ID: ${plan.id}`;
        const pr = await this.createPR(
          plan.projectId,
          plan.branch,
          prTitle,
          prBody
        );
        return {
          output: `PR #${pr.number} created: ${pr.url}`,
          prUrl: pr.url,
        };
      }

      case "preview": {
        const preview = await this.deployPreview(plan.projectId, plan.branch);
        return {
          output: `Preview deployed: ${preview.url}`,
          previewUrl: preview.url,
        };
      }

      case "smoke_test": {
        const targetUrl = plan.previewUrl ?? "";
        if (!targetUrl) {
          throw new Error("No preview URL available for smoke tests");
        }
        const testResult = await this.runSmokeTests(plan.projectId, targetUrl);
        if (!testResult.passed) {
          throw new Error(`Smoke tests failed: ${testResult.output}`);
        }
        return { output: testResult.output };
      }

      case "canary": {
        // Canary promotion is handled via the Vercel adapter
        const response = await fetch(
          `${this.mcpGatewayUrl}/api/adapters/vercel/canary`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: plan.projectId,
              branch: plan.branch,
              percentage: 10,
            }),
            signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
          }
        );
        if (!response.ok) {
          throw new Error(`Canary deployment failed (${response.status})`);
        }
        return { output: "Canary deployment at 10% traffic" };
      }

      case "promote": {
        const response = await fetch(
          `${this.mcpGatewayUrl}/api/adapters/vercel/promote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: plan.projectId,
              branch: plan.branch,
            }),
            signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
          }
        );
        if (!response.ok) {
          throw new Error(`Promotion failed (${response.status})`);
        }
        return { output: "Promoted to production" };
      }

      case "rollback": {
        await this.rollback(plan.projectId, plan.id);
        return { output: "Rolled back deployment" };
      }

      case "notify": {
        const message =
          plan.status === "success"
            ? `Deployment ${plan.id} for branch \`${plan.branch}\` succeeded. Preview: ${plan.previewUrl ?? "N/A"}`
            : `Deployment ${plan.id} for branch \`${plan.branch}\` status: ${plan.status}`;
        await this.notifySlack(plan.projectId, message);
        return { output: "Notification sent" };
      }

      default: {
        const exhaustiveCheck: never = step.type;
        throw new Error(`Unknown step type: ${exhaustiveCheck}`);
      }
    }
  }

  private skipRemainingSteps(
    plan: DeploymentPlan,
    failedStep: DeployStep
  ): void {
    let foundFailed = false;
    for (const step of plan.steps) {
      if (step.id === failedStep.id) {
        foundFailed = true;
        continue;
      }
      if (foundFailed && step.status === "pending") {
        step.status = "skipped";
      }
    }
  }

  private async attemptRollback(plan: DeploymentPlan): Promise<void> {
    logger.info(
      { deploymentId: plan.id },
      "Attempting automatic rollback after failure"
    );

    try {
      await this.rollback(plan.projectId, plan.id);
      plan.status = "rolled_back";
      logger.info({ deploymentId: plan.id }, "Automatic rollback succeeded");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      plan.status = "failed";
      logger.error(
        { deploymentId: plan.id, error: msg },
        "Automatic rollback failed"
      );
    }
  }
}
