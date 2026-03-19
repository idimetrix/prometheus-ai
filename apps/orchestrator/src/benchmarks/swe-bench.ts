/**
 * Phase 16.2: SWE-bench Adapter.
 * Loads SWE-bench tasks from JSONL and converts them to BenchmarkTask format.
 */
import { readFile } from "node:fs/promises";
import { createLogger } from "@prometheus/logger";
import type { BenchmarkTask } from "./runner";

const logger = createLogger("orchestrator:benchmarks:swe-bench");

export interface SWEBenchTask {
  base_commit: string;
  instance_id: string;
  patch: string;
  problem_statement: string;
  repo: string;
  test_patch: string;
}

/**
 * Load SWE-bench tasks from a JSONL file.
 * Each line is a JSON object representing a single task instance.
 */
export async function loadFromFile(path: string): Promise<SWEBenchTask[]> {
  logger.info({ path }, "Loading SWE-bench tasks from file");

  const content = await readFile(path, "utf-8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const tasks: SWEBenchTask[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as SWEBenchTask;

      if (!(parsed.instance_id && parsed.repo && parsed.problem_statement)) {
        logger.warn({ line: line.slice(0, 80) }, "Skipping invalid task entry");
        continue;
      }

      tasks.push(parsed);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: msg, line: line.slice(0, 80) },
        "Failed to parse JSONL line"
      );
    }
  }

  logger.info(
    { totalLoaded: tasks.length, totalLines: lines.length },
    "SWE-bench tasks loaded"
  );

  return tasks;
}

/**
 * Convert SWE-bench tasks to the internal BenchmarkTask format
 * used by the BenchmarkRunner.
 */
export function adaptToTasks(sweTasks: SWEBenchTask[]): BenchmarkTask[] {
  return sweTasks.map((task) => ({
    id: task.instance_id,
    title: `SWE-bench: ${task.repo}#${task.instance_id}`,
    description: buildDescription(task),
    mode: "task" as const,
    expectedFiles: extractExpectedFiles(task.patch),
    validationCommand: task.test_patch
      ? `git apply --check <<'PATCH'\n${task.test_patch}\nPATCH`
      : undefined,
  }));
}

/**
 * Build a detailed problem description from SWE-bench task fields.
 */
function buildDescription(task: SWEBenchTask): string {
  const parts = [
    `Repository: ${task.repo}`,
    `Base commit: ${task.base_commit}`,
    "",
    "Problem Statement:",
    task.problem_statement,
  ];

  return parts.join("\n");
}

/**
 * Extract file paths from a unified diff patch string.
 */
function extractExpectedFiles(patch: string): string[] {
  const files = new Set<string>();
  const diffRegex = /^diff --git a\/(.+?) b\/(.+?)$/gm;

  let match = diffRegex.exec(patch);
  while (match !== null) {
    const filePath = match[2];
    if (filePath) {
      files.add(filePath);
    }
    match = diffRegex.exec(patch);
  }

  return Array.from(files);
}
