import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import { KnowledgeImporter } from "../import/knowledge-importer";
import type { FileIndexer } from "../indexing/file-indexer";

const logger = createLogger("project-brain:import-routes");

/**
 * Create Hono routes for knowledge base import endpoints.
 */
export function createImportRoutes(fileIndexer: FileIndexer): Hono {
  const app = new Hono();
  const importer = new KnowledgeImporter(fileIndexer);

  // ---- Health ----

  app.get("/health", (c) => {
    return c.json({ status: "ok", service: "knowledge-import" });
  });

  // ---- Markdown Import ----

  app.post("/markdown", async (c) => {
    const body = await c.req.json();
    const { projectId, files } = body as {
      projectId?: string;
      files?: Array<{ path: string; content: string }>;
    };

    if (!projectId) {
      return c.json({ error: "projectId is required" }, 400);
    }

    if (!Array.isArray(files) || files.length === 0) {
      return c.json(
        { error: "files array is required and must not be empty" },
        400
      );
    }

    // Validate each file has path and content
    for (const file of files) {
      if (
        !(typeof file.path === "string" && typeof file.content === "string")
      ) {
        return c.json(
          { error: "Each file must have a string 'path' and 'content'" },
          400
        );
      }
    }

    logger.info(
      { projectId, fileCount: files.length },
      "Starting markdown import"
    );

    const result = await importer.importMarkdown(projectId, files);
    return c.json({ success: result.errors.length === 0, ...result });
  });

  // ---- URL Import ----

  app.post("/url", async (c) => {
    const body = await c.req.json();
    const { projectId, url } = body as {
      projectId?: string;
      url?: string;
    };

    if (!projectId) {
      return c.json({ error: "projectId is required" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "url is required and must be a string" }, 400);
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return c.json({ error: "Invalid URL format" }, 400);
    }

    logger.info({ projectId, url }, "Starting URL import");

    const result = await importer.importFromUrl(projectId, url);
    return c.json({ success: result.errors.length === 0, ...result });
  });

  return app;
}
