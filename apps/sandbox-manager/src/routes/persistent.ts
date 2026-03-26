import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import type { PersistentSandboxProvider } from "../providers/persistent";

const logger = createLogger("sandbox:persistent-route");

/**
 * Create Hono routes for persistent sandbox management.
 *
 * Routes:
 *   POST   /sandboxes/persistent              - Create or resume a persistent sandbox
 *   GET    /sandboxes/persistent/:projectId    - Get status for a project's sandbox
 *   POST   /sandboxes/persistent/:sandboxId/pause   - Pause a sandbox
 *   DELETE /sandboxes/persistent/:sandboxId    - Destroy a sandbox
 *   GET    /sandboxes/persistent/org/:orgId    - List all active sandboxes for an org
 */
export function createPersistentRoutes(
  provider: PersistentSandboxProvider
): Hono {
  const app = new Hono();

  /**
   * POST /sandboxes/persistent
   * Body: { projectId: string, orgId: string }
   *
   * Creates a new persistent sandbox or resumes an existing one for the project.
   */
  app.post("/sandboxes/persistent", async (c) => {
    try {
      const body = await c.req.json<{
        projectId: string;
        orgId: string;
      }>();

      if (!body.projectId) {
        return c.json({ error: "projectId is required" }, 400);
      }
      if (!body.orgId) {
        return c.json({ error: "orgId is required" }, 400);
      }

      const sandbox = await provider.getOrCreate(body.projectId, body.orgId);

      logger.info(
        { sandboxId: sandbox.id, projectId: body.projectId },
        "Persistent sandbox getOrCreate completed"
      );

      return c.json(sandbox, 201);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: msg },
        "Failed to create/resume persistent sandbox"
      );
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * GET /sandboxes/persistent/:projectId
   *
   * Get the status of the persistent sandbox for a given project.
   */
  app.get("/sandboxes/persistent/:projectId", (c) => {
    const projectId = c.req.param("projectId");
    const sandbox = provider.getByProject(projectId);

    if (!sandbox) {
      return c.json(
        { error: "No persistent sandbox found for this project" },
        404
      );
    }

    return c.json(sandbox);
  });

  /**
   * POST /sandboxes/persistent/:sandboxId/pause
   *
   * Pause (stop) a running persistent sandbox. The container is preserved.
   */
  app.post("/sandboxes/persistent/:sandboxId/pause", async (c) => {
    const sandboxId = c.req.param("sandboxId");

    try {
      await provider.pause(sandboxId);
      return c.json({ success: true, sandboxId, status: "paused" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes("not found")) {
        return c.json({ error: msg }, 404);
      }

      logger.error(
        { sandboxId, error: msg },
        "Failed to pause persistent sandbox"
      );
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * DELETE /sandboxes/persistent/:sandboxId
   *
   * Fully destroy a persistent sandbox — removes the container and all data.
   */
  app.delete("/sandboxes/persistent/:sandboxId", async (c) => {
    const sandboxId = c.req.param("sandboxId");

    try {
      await provider.destroy(sandboxId);
      return c.json({ success: true, sandboxId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sandboxId, error: msg },
        "Failed to destroy persistent sandbox"
      );
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * GET /sandboxes/persistent/org/:orgId
   *
   * List all active persistent sandboxes for an organization.
   */
  app.get("/sandboxes/persistent/org/:orgId", (c) => {
    const orgId = c.req.param("orgId");
    const sandboxes = provider.listActive(orgId);
    return c.json({ sandboxes });
  });

  return app;
}
