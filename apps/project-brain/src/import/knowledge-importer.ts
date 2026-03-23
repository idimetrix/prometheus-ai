import { createLogger } from "@prometheus/logger";
import type { FileIndexer } from "../indexing/file-indexer";

const logger = createLogger("project-brain:knowledge-importer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarkdownFile {
  /** Markdown content */
  content: string;
  /** Virtual file path for indexing (e.g. "docs/architecture.md") */
  path: string;
}

export interface ImportResult {
  errors: Array<{ path: string; error: string }>;
  importedCount: number;
  skippedCount: number;
  totalCount: number;
}

interface ExternalCredentials {
  apiToken: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// KnowledgeImporter
// ---------------------------------------------------------------------------

/**
 * Imports external knowledge sources into Project Brain's indexing pipeline.
 *
 * Supports:
 * - Bulk markdown file import (primary path)
 * - Web page fetch and import
 * - Confluence page import
 * - Notion page import
 */
export class KnowledgeImporter {
  private readonly fileIndexer: FileIndexer;

  constructor(fileIndexer: FileIndexer) {
    this.fileIndexer = fileIndexer;
  }

  // -------------------------------------------------------------------------
  // Markdown bulk import (primary path)
  // -------------------------------------------------------------------------

  /**
   * Import an array of markdown files into the project's knowledge base.
   * Each file is indexed through the standard file indexing pipeline.
   */
  async importMarkdown(
    projectId: string,
    files: MarkdownFile[]
  ): Promise<ImportResult> {
    const result: ImportResult = {
      totalCount: files.length,
      importedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    for (const file of files) {
      try {
        if (!file.content.trim()) {
          result.skippedCount++;
          logger.debug({ path: file.path }, "Skipping empty file");
          continue;
        }

        const indexed = await this.fileIndexer.indexFile(
          projectId,
          file.path,
          file.content
        );

        if (indexed) {
          result.importedCount++;
        } else {
          result.skippedCount++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ path: file.path, error: message });
        logger.error({ err, path: file.path, projectId }, "Failed to import");
      }
    }

    logger.info(
      {
        projectId,
        imported: result.importedCount,
        skipped: result.skippedCount,
        errors: result.errors.length,
      },
      "Markdown import complete"
    );

    return result;
  }

  // -------------------------------------------------------------------------
  // URL import
  // -------------------------------------------------------------------------

  /**
   * Fetch a web page, extract its text content, and index it as markdown.
   */
  async importFromUrl(projectId: string, url: string): Promise<ImportResult> {
    logger.info({ projectId, url }, "Importing from URL");

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html, text/plain, text/markdown",
          "User-Agent": "Prometheus-KnowledgeImporter/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const rawText = await response.text();

      // Convert HTML to simplified markdown-like text
      const content = contentType.includes("text/html")
        ? stripHtmlToText(rawText)
        : rawText;

      const filePath = `imported/${urlToFilePath(url)}.md`;

      return this.importMarkdown(projectId, [{ path: filePath, content }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, projectId, url }, "URL import failed");
      return {
        totalCount: 1,
        importedCount: 0,
        skippedCount: 0,
        errors: [{ path: url, error: message }],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Confluence import
  // -------------------------------------------------------------------------

  /**
   * Import a Confluence page by its page ID.
   * Fetches the page content via the Confluence REST API and converts to markdown.
   */
  async importConfluencePage(
    projectId: string,
    pageId: string,
    credentials: ExternalCredentials
  ): Promise<ImportResult> {
    const baseUrl = credentials.baseUrl ?? "";
    const apiUrl = `${baseUrl}/rest/api/content/${pageId}?expand=body.storage,title`;

    logger.info({ projectId, pageId, baseUrl }, "Importing Confluence page");

    try {
      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(
          `Confluence API ${response.status}: ${response.statusText}`
        );
      }

      const data = (await response.json()) as {
        title?: string;
        body?: { storage?: { value?: string } };
      };

      const title = data.title ?? `confluence-${pageId}`;
      const htmlContent = data.body?.storage?.value ?? "";
      const content = `# ${title}\n\n${stripHtmlToText(htmlContent)}`;
      const filePath = `imported/confluence/${pageId}.md`;

      return this.importMarkdown(projectId, [{ path: filePath, content }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, pageId, projectId }, "Confluence import failed");
      return {
        totalCount: 1,
        importedCount: 0,
        skippedCount: 0,
        errors: [{ path: `confluence:${pageId}`, error: message }],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Notion import
  // -------------------------------------------------------------------------

  /**
   * Import a Notion page by its page ID.
   * Fetches block children via the Notion API and converts to markdown.
   */
  async importNotionPage(
    projectId: string,
    pageId: string,
    credentials: ExternalCredentials
  ): Promise<ImportResult> {
    const baseUrl = credentials.baseUrl ?? "https://api.notion.com";
    const blocksUrl = `${baseUrl}/v1/blocks/${pageId}/children?page_size=100`;
    const pageUrl = `${baseUrl}/v1/pages/${pageId}`;

    logger.info({ projectId, pageId }, "Importing Notion page");

    try {
      // Fetch page metadata for title
      const pageResponse = await fetch(pageUrl, {
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          "Notion-Version": "2022-06-28",
        },
        signal: AbortSignal.timeout(30_000),
      });

      let title = `notion-${pageId}`;
      if (pageResponse.ok) {
        const pageData = (await pageResponse.json()) as {
          properties?: {
            title?: { title?: Array<{ plain_text?: string }> };
            Name?: { title?: Array<{ plain_text?: string }> };
          };
        };
        const titleProp =
          pageData.properties?.title?.title ?? pageData.properties?.Name?.title;
        if (titleProp?.[0]?.plain_text) {
          title = titleProp[0].plain_text;
        }
      }

      // Fetch block children
      const blocksResponse = await fetch(blocksUrl, {
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          "Notion-Version": "2022-06-28",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!blocksResponse.ok) {
        throw new Error(
          `Notion API ${blocksResponse.status}: ${blocksResponse.statusText}`
        );
      }

      const blocksData = (await blocksResponse.json()) as {
        results?: Array<{
          type?: string;
          [key: string]: unknown;
        }>;
      };

      const content = `# ${title}\n\n${notionBlocksToMarkdown(blocksData.results ?? [])}`;
      const filePath = `imported/notion/${pageId}.md`;

      return this.importMarkdown(projectId, [{ path: filePath, content }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, pageId, projectId }, "Notion import failed");
      return {
        totalCount: 1,
        importedCount: 0,
        skippedCount: 0,
        errors: [{ path: `notion:${pageId}`, error: message }],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags and decode common entities to produce plain text.
 */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert a URL to a safe file path segment.
 */
function urlToFilePath(url: string): string {
  try {
    const parsed = new URL(url);
    const pathSegment = parsed.hostname + parsed.pathname;
    return pathSegment
      .replace(/[^a-zA-Z0-9-_/]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 200);
  } catch {
    return "unknown-url";
  }
}

/**
 * Convert Notion block objects into simplified markdown.
 */
function notionBlocksToMarkdown(
  blocks: Array<{ type?: string; [key: string]: unknown }>
): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const blockType = block.type ?? "unsupported";
    const blockData = block[blockType] as
      | {
          rich_text?: Array<{ plain_text?: string }>;
          text?: Array<{ plain_text?: string }>;
        }
      | undefined;

    const text = extractNotionText(blockData);

    switch (blockType) {
      case "paragraph":
        lines.push(text);
        break;
      case "heading_1":
        lines.push(`# ${text}`);
        break;
      case "heading_2":
        lines.push(`## ${text}`);
        break;
      case "heading_3":
        lines.push(`### ${text}`);
        break;
      case "bulleted_list_item":
        lines.push(`- ${text}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${text}`);
        break;
      case "code": {
        const lang =
          (blockData as { language?: string } | undefined)?.language ?? "";
        lines.push(`\`\`\`${lang}\n${text}\n\`\`\``);
        break;
      }
      case "quote":
        lines.push(`> ${text}`);
        break;
      case "divider":
        lines.push("---");
        break;
      case "to_do": {
        const checked = (blockData as { checked?: boolean } | undefined)
          ?.checked;
        lines.push(`- [${checked ? "x" : " "}] ${text}`);
        break;
      }
      default:
        if (text) {
          lines.push(text);
        }
    }
  }

  return lines.join("\n\n");
}

/**
 * Extract plain text from Notion rich_text or text arrays.
 */
function extractNotionText(
  data:
    | {
        rich_text?: Array<{ plain_text?: string }>;
        text?: Array<{ plain_text?: string }>;
      }
    | undefined
): string {
  if (!data) {
    return "";
  }
  const textArray = data.rich_text ?? data.text ?? [];
  return textArray.map((t) => t.plain_text ?? "").join("");
}
