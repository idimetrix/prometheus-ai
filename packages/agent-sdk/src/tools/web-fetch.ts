import { createLogger } from "@prometheus/logger";
import { z } from "zod";
import type { AgentToolDefinition, ToolResult } from "./types";

const logger = createLogger("agent-sdk:web-fetch");

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_LENGTH = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; Prometheus/1.0; +https://prometheus.dev)";
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const ID_SELECTOR_RE = /^#([\w-]+)$/;
const CLASS_SELECTOR_RE = /^\.([\w-]+)$/;
const TAG_SELECTOR_RE = /^([\w-]+)$/;

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const webFetchSchema = z
  .object({
    url: z.string().url().describe("URL to fetch content from"),
    selector: z
      .string()
      .optional()
      .describe(
        "CSS selector to extract specific content (optional). Uses a simple tag-based extraction when a full DOM parser is unavailable."
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// HTML processing utilities
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags but preserve text content, code blocks, and basic structure.
 */
function htmlToText(html: string): string {
  let text = html;

  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Preserve code blocks
  text = text.replace(
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_match, code: string) => {
      const cleaned = code.replace(/<[^>]*>/g, "");
      return `\n\`\`\`\n${cleaned}\n\`\`\`\n`;
    }
  );

  text = text.replace(
    /<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_match, code: string) => {
      const cleaned = code.replace(/<[^>]*>/g, "");
      return `\`${cleaned}\``;
    }
  );

  // Convert headers to text with formatting
  text = text.replace(
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
    (_match, content: string) => {
      const cleaned = content.replace(/<[^>]*>/g, "").trim();
      return `\n\n## ${cleaned}\n\n`;
    }
  );

  // Convert list items
  text = text.replace(
    /<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_match, content: string) => {
      const cleaned = content.replace(/<[^>]*>/g, "").trim();
      return `\n- ${cleaned}`;
    }
  );

  // Convert paragraphs and divs to newlines
  text = text.replace(/<\/(p|div|section|article)>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      String.fromCharCode(Number(dec))
    );

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

/**
 * Extract the page title from HTML.
 */
function extractTitle(html: string): string {
  const titleMatch = TITLE_RE.exec(html);
  if (titleMatch) {
    return (titleMatch[1] ?? "").replace(/<[^>]*>/g, "").trim();
  }
  return "";
}

/**
 * Extract content matching a simple CSS selector.
 * Supports tag names, #id, and .class selectors.
 * This is a lightweight approach that does not require a full DOM parser.
 */
function extractBySelector(html: string, selector: string): string | null {
  // Handle ID selector: #some-id
  const idMatch = ID_SELECTOR_RE.exec(selector);
  if (idMatch) {
    const pattern = new RegExp(
      `<[^>]+id=["']${idMatch[1]}["'][^>]*>([\\s\\S]*?)(?=<\\/[^>]+>\\s*(?:<[^>]+id=|$))`,
      "i"
    );
    const match = pattern.exec(html);
    return match ? match[0] : null;
  }

  // Handle class selector: .some-class
  const classMatch = CLASS_SELECTOR_RE.exec(selector);
  if (classMatch) {
    const pattern = new RegExp(
      `<[^>]+class="[^"]*\\b${classMatch[1]}\\b[^"]*"[^>]*>[\\s\\S]*?<\\/`,
      "i"
    );
    const match = pattern.exec(html);
    return match ? match[0] : null;
  }

  // Handle tag selector: main, article, etc.
  const tagMatch = TAG_SELECTOR_RE.exec(selector);
  if (tagMatch) {
    const pattern = new RegExp(
      `<${tagMatch[1]}[^>]*>([\\s\\S]*?)<\\/${tagMatch[1]}>`,
      "i"
    );
    const match = pattern.exec(html);
    return match ? match[0] : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const webFetchTools: AgentToolDefinition[] = [
  {
    name: "web_fetch",
    description:
      "Fetch a web page and return its text content. Strips HTML tags, preserves code blocks and text structure. Useful for reading documentation pages, API references, and web content. Optionally extract content from a specific CSS selector.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch content from",
        },
        selector: {
          type: "string",
          description:
            "CSS selector to extract specific content (optional, supports tag, #id, .class)",
        },
      },
      required: ["url"],
    },
    zodSchema: webFetchSchema,
    permissionLevel: "read",
    creditCost: 3,
    execute: async (input): Promise<ToolResult> => {
      const parsed = webFetchSchema.parse(input);

      try {
        const response = await fetch(parsed.url, {
          method: "GET",
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,text/plain,*/*",
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "follow",
        });

        if (!response.ok) {
          return {
            success: false,
            output: "",
            error: `Failed to fetch URL (${response.status}): ${response.statusText}`,
          };
        }

        const contentType = response.headers.get("content-type") || "";
        const rawBody = await response.text();

        const title = extractTitle(rawBody);

        let content: string;

        // If it's plain text or JSON, return as-is
        if (
          contentType.includes("text/plain") ||
          contentType.includes("application/json")
        ) {
          content = rawBody;
        } else {
          // Process as HTML
          let htmlToProcess = rawBody;

          if (parsed.selector) {
            const extracted = extractBySelector(rawBody, parsed.selector);
            if (extracted) {
              htmlToProcess = extracted;
            } else {
              logger.debug(
                { selector: parsed.selector },
                "Selector not found, using full page"
              );
            }
          }

          content = htmlToText(htmlToProcess);
        }

        // Truncate to limit
        if (content.length > MAX_CONTENT_LENGTH) {
          content = `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n... (truncated at ${MAX_CONTENT_LENGTH} characters)`;
        }

        const output = title ? `# ${title}\n\n${content}` : content;

        return {
          success: true,
          output,
          metadata: {
            url: parsed.url,
            title,
            contentLength: content.length,
            truncated: content.length > MAX_CONTENT_LENGTH,
          },
        };
      } catch (err) {
        logger.error(
          {
            url: parsed.url,
            error: err instanceof Error ? err.message : String(err),
          },
          "Web fetch failed"
        );
        return {
          success: false,
          output: "",
          error: `Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
];
