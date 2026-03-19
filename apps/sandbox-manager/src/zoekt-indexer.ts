import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:zoekt-indexer");

const ZOEKT_INDEX_DIR = process.env.ZOEKT_INDEX_DIR ?? "/tmp/zoekt-index";

function runCommand(
  command: string,
  args: string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

export class ZoektIndexer {
  private readonly indexDir: string;

  constructor(indexDir?: string) {
    this.indexDir = indexDir ?? ZOEKT_INDEX_DIR;
  }

  async indexRepository(repoPath: string, repoName: string): Promise<void> {
    logger.info({ repoPath, repoName }, "Indexing repository");

    const result = await runCommand("zoekt-index", [
      "-index",
      this.indexDir,
      "-name",
      repoName,
      repoPath,
    ]);

    if (result.exitCode !== 0) {
      logger.error(
        { repoName, stderr: result.stderr, exitCode: result.exitCode },
        "zoekt-index failed"
      );
      throw new Error(`zoekt-index failed for ${repoName}: ${result.stderr}`);
    }

    logger.info({ repoName }, "Repository indexed successfully");
  }

  async isIndexed(repoName: string): Promise<boolean> {
    const shardPath = join(this.indexDir, `${repoName}.zoekt`);
    try {
      await access(shardPath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async reindex(repoPath: string, repoName: string): Promise<void> {
    logger.info({ repoPath, repoName }, "Force re-indexing repository");
    await this.indexRepository(repoPath, repoName);
  }
}
