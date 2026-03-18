import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:semantic");

export interface SearchResult {
  filePath: string;
  content: string;
  score: number;
  chunkIndex: number;
}

export class SemanticLayer {
  async indexFile(projectId: string, filePath: string, content: string): Promise<void> {
    // Split content into chunks
    const chunks = this.chunkContent(content, filePath);

    for (let i = 0; i < chunks.length; i++) {
      // TODO: Generate embedding via Ollama nomic-embed-text
      // TODO: Store in code_embeddings table with pgvector
      logger.debug({ projectId, filePath, chunk: i }, "Indexed chunk");
    }

    logger.info({ projectId, filePath, chunks: chunks.length }, "File indexed");
  }

  async search(projectId: string, query: string, limit: number = 10): Promise<SearchResult[]> {
    // TODO: Generate query embedding
    // TODO: Cosine similarity search in pgvector
    logger.debug({ projectId, query, limit }, "Semantic search");
    return [];
  }

  async removeFile(projectId: string, filePath: string): Promise<void> {
    // TODO: Delete embeddings for this file
    logger.info({ projectId, filePath }, "File removed from index");
  }

  private chunkContent(content: string, filePath: string): string[] {
    const ext = filePath.split(".").pop() ?? "";
    const isCode = ["ts", "tsx", "js", "jsx", "py", "go", "rs", "rb", "java"].includes(ext);

    if (isCode) {
      return this.chunkByFunction(content);
    }
    return this.chunkByParagraph(content);
  }

  private chunkByFunction(content: string): string[] {
    const chunks: string[] = [];
    const lines = content.split("\n");
    let currentChunk: string[] = [];
    let braceCount = 0;

    for (const line of lines) {
      currentChunk.push(line);
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;

      if (braceCount === 0 && currentChunk.length > 3) {
        chunks.push(currentChunk.join("\n"));
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join("\n"));
    }

    return chunks.length > 0 ? chunks : [content];
  }

  private chunkByParagraph(content: string, maxChunkSize: number = 1000): string[] {
    const paragraphs = content.split(/\n\n+/);
    const chunks: string[] = [];
    let current = "";

    for (const para of paragraphs) {
      if (current.length + para.length > maxChunkSize && current.length > 0) {
        chunks.push(current.trim());
        current = "";
      }
      current += para + "\n\n";
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [content];
  }
}
