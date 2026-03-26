import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import type { IndexProjectData } from "@prometheus/queue";
import { EventPublisher } from "@prometheus/queue";

const logger = createLogger("queue-worker:index-project");
const publisher = new EventPublisher();

const BRAIN_URL = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

export async function processIndexProject(
  data: IndexProjectData,
  onProgress?: (progress: Record<string, unknown>) => void
): Promise<{ indexed: number; skipped: number; errors: number }> {
  const { projectId, orgId, filePaths, fullReindex, triggeredBy } = data;

  logger.info(
    { projectId, fullReindex, triggeredBy, fileCount: filePaths.length },
    "Starting project indexing"
  );

  const result = fullReindex
    ? await runFullReindex(projectId, filePaths)
    : await runIncrementalIndex(projectId, filePaths, onProgress);

  await extractConventions(projectId, filePaths);

  // ---- Auto-detect tech stack after indexing ----
  const stackInfo = await detectAndStoreStack(projectId, orgId, filePaths);

  await publishCompletion(orgId, projectId, result, triggeredBy, stackInfo);

  logger.info({ projectId, ...result }, "Project indexing complete");
  return result;
}

async function runFullReindex(
  projectId: string,
  filePaths: string[]
): Promise<{ indexed: number; skipped: number; errors: number }> {
  try {
    const response = await fetch(`${BRAIN_URL}/index/directory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({ projectId, dirPath: filePaths[0] ?? "." }),
      signal: AbortSignal.timeout(600_000),
    });

    if (response.ok) {
      return (await response.json()) as {
        indexed: number;
        skipped: number;
        errors: number;
      };
    }
    logger.error({ projectId, status: response.status }, "Full reindex failed");
  } catch (err) {
    logger.error({ projectId, err }, "Full reindex request failed");
  }
  return { indexed: 0, skipped: 0, errors: filePaths.length };
}

async function runIncrementalIndex(
  projectId: string,
  filePaths: string[],
  onProgress?: (progress: Record<string, unknown>) => void
): Promise<{ indexed: number; skipped: number; errors: number }> {
  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i] as string;
    const fileResult = await indexSingleFile(projectId, filePath);
    indexed += fileResult.indexed;
    skipped += fileResult.skipped;
    errors += fileResult.errors;

    if (onProgress && (i % 5 === 0 || i === filePaths.length - 1)) {
      onProgress({
        projectId,
        total: filePaths.length,
        processed: i + 1,
        indexed,
        skipped,
        errors,
        percent: Math.round(((i + 1) / filePaths.length) * 100),
      });
    }
  }

  return { indexed, skipped, errors };
}

async function indexSingleFile(
  projectId: string,
  filePath: string
): Promise<{ indexed: number; skipped: number; errors: number }> {
  try {
    const response = await fetch(`${BRAIN_URL}/index/file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({ projectId, filePath }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return { indexed: 0, skipped: 0, errors: 1 };
    }
    const result = (await response.json()) as {
      success: boolean;
      indexed: boolean;
    };
    return result.indexed
      ? { indexed: 1, skipped: 0, errors: 0 }
      : { indexed: 0, skipped: 1, errors: 0 };
  } catch (err) {
    logger.warn({ projectId, filePath, err }, "Failed to index file");
    return { indexed: 0, skipped: 0, errors: 1 };
  }
}

async function detectAndStoreStack(
  projectId: string,
  orgId: string,
  filePaths: string[]
): Promise<Record<string, unknown> | null> {
  try {
    const { detectTechStack } = (await import(
      "@prometheus/config-stacks"
    )) as typeof import("@prometheus/config-stacks");

    const stack = await detectTechStack(filePaths);

    logger.info(
      {
        projectId,
        languages: stack.languages,
        frameworks: stack.frameworks,
        preset: stack.suggestedPreset,
      },
      "Tech stack auto-detected during indexing"
    );

    // Publish stack detection event so downstream consumers (e.g. the web UI)
    // can update project metadata.
    try {
      await publisher.publishFleetEvent(orgId, {
        type: "stack_detected",
        data: { projectId, ...stack },
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Non-critical
    }

    return stack as unknown as Record<string, unknown>;
  } catch (err) {
    logger.warn(
      { projectId, err },
      "Stack detection during indexing failed, continuing"
    );
    return null;
  }
}

async function extractConventions(
  projectId: string,
  filePaths: string[]
): Promise<void> {
  try {
    const conventionResponse = await fetch(`${BRAIN_URL}/conventions/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({ projectId, files: filePaths.slice(0, 50) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (conventionResponse.ok) {
      logger.info({ projectId }, "Conventions extracted from indexed files");
    }
  } catch (err) {
    logger.warn({ projectId, err }, "Convention extraction failed, continuing");
  }
}

async function publishCompletion(
  orgId: string,
  projectId: string,
  result: { indexed: number; skipped: number; errors: number },
  triggeredBy: string,
  stackInfo?: Record<string, unknown> | null
): Promise<void> {
  try {
    await publisher.publishFleetEvent(orgId, {
      type: "indexing_complete",
      data: {
        projectId,
        ...result,
        triggeredBy,
        ...(stackInfo ? { techStack: stackInfo } : {}),
      },
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Non-critical
  }
}
