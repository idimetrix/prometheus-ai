import { createLogger } from "@prometheus/logger";
import type { SemanticLayer } from "../layers/semantic";
import type { KnowledgeGraphLayer } from "../layers/knowledge-graph";

const logger = createLogger("project-brain:indexer");

export interface FileChange {
  path: string;
  content: string;
  hash: string;
  action: "added" | "modified" | "deleted";
}

export class FileIndexer {
  private indexedHashes = new Map<string, string>();

  constructor(
    private readonly semantic: SemanticLayer,
    private readonly knowledgeGraph: KnowledgeGraphLayer,
  ) {}

  async indexChanges(projectId: string, changes: FileChange[]): Promise<{
    indexed: number;
    skipped: number;
    removed: number;
  }> {
    let indexed = 0;
    let skipped = 0;
    let removed = 0;

    for (const change of changes) {
      const key = `${projectId}:${change.path}`;

      if (change.action === "deleted") {
        await this.semantic.removeFile(projectId, change.path);
        this.indexedHashes.delete(key);
        removed++;
        continue;
      }

      // Skip if hash hasn't changed
      if (this.indexedHashes.get(key) === change.hash) {
        skipped++;
        continue;
      }

      // Index the file
      await this.semantic.indexFile(projectId, change.path, change.content);
      await this.knowledgeGraph.analyzeFile(projectId, change.path, change.content);
      this.indexedHashes.set(key, change.hash);
      indexed++;
    }

    logger.info({ projectId, indexed, skipped, removed }, "Index update complete");
    return { indexed, skipped, removed };
  }

  async fullReindex(projectId: string, files: Array<{ path: string; content: string; hash: string }>): Promise<void> {
    logger.info({ projectId, fileCount: files.length }, "Starting full reindex");

    const changes: FileChange[] = files.map((f) => ({
      ...f,
      action: "added" as const,
    }));

    // Clear existing hashes for this project
    for (const key of this.indexedHashes.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        this.indexedHashes.delete(key);
      }
    }

    await this.indexChanges(projectId, changes);
    logger.info({ projectId, fileCount: files.length }, "Full reindex complete");
  }
}
