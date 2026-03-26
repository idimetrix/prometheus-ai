import { createLogger } from "@prometheus/logger";
import { z } from "zod";
import type { AgentToolDefinition, ToolResult } from "./types";
import { executeWebSearch } from "./web-search";

const logger = createLogger("agent-sdk:doc-search");

const FETCH_TIMEOUT_MS = 10_000;
const MAX_CONTENT_PER_RESULT = 3000;
const TOP_RESULTS_TO_FETCH = 3;
const MAIN_RE = /<main[^>]*>([\s\S]*?)<\/main>/i;
const ARTICLE_RE = /<article[^>]*>([\s\S]*?)<\/article>/i;
const CONTENT_DIV_RE =
  /<div[^>]+class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
const USER_AGENT =
  "Mozilla/5.0 (compatible; Prometheus/1.0; +https://prometheus.dev)";

// ---------------------------------------------------------------------------
// Zod Schema
// ---------------------------------------------------------------------------

export const searchDocsSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .describe("Documentation search query (e.g., 'React useEffect cleanup')"),
    source: z
      .string()
      .optional()
      .describe(
        "Documentation site domain to restrict search (e.g., 'react.dev', 'developer.mozilla.org')"
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
  let text = html;

  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");

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

  // Convert headers
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

  text = text.replace(/<\/(p|div|section|article)>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  text = text.replace(/<[^>]*>/g, "");

  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!response.ok) {
      return `[Failed to fetch: ${response.status}]`;
    }

    const html = await response.text();

    // Try to extract main content area
    const mainMatch =
      MAIN_RE.exec(html) || ARTICLE_RE.exec(html) || CONTENT_DIV_RE.exec(html);

    const content = mainMatch
      ? htmlToText(mainMatch[1] ?? "")
      : htmlToText(html);

    if (content.length > MAX_CONTENT_PER_RESULT) {
      return `${content.slice(0, MAX_CONTENT_PER_RESULT)}\n... (truncated)`;
    }

    return content;
  } catch (err) {
    logger.debug(
      { url, error: err instanceof Error ? err.message : String(err) },
      "Failed to fetch page for doc search"
    );
    return `[Failed to fetch: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const docSearchTools: AgentToolDefinition[] = [
  {
    name: "search_docs",
    description:
      "Search documentation websites and return relevant content. Combines web search with page fetching to extract documentation text. Optionally restrict to a specific documentation site (e.g., 'react.dev', 'developer.mozilla.org').",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Documentation search query (e.g., 'React useEffect cleanup')",
        },
        source: {
          type: "string",
          description:
            "Documentation site domain to restrict search (e.g., 'react.dev', 'developer.mozilla.org')",
        },
      },
      required: ["query"],
    },
    zodSchema: searchDocsSchema,
    permissionLevel: "read",
    creditCost: 5,
    execute: async (input): Promise<ToolResult> => {
      const parsed = searchDocsSchema.parse(input);

      try {
        // Build search query with optional site restriction
        const searchQuery = parsed.source
          ? `${parsed.query} site:${parsed.source}`
          : parsed.query;

        // Search the web
        const searchResults = await executeWebSearch(
          searchQuery,
          TOP_RESULTS_TO_FETCH
        );

        if (searchResults.length === 0) {
          return {
            success: true,
            output:
              "No documentation results found. Try different search terms or a different source.",
            metadata: { resultCount: 0 },
          };
        }

        // Fetch content from top results in parallel
        const fetchPromises = searchResults.map(async (result) => {
          const content = await fetchPageContent(result.url);
          return {
            title: result.title,
            url: result.url,
            content,
          };
        });

        const pages = await Promise.all(fetchPromises);

        const formatted = pages
          .map(
            (page) =>
              `--- ${page.title} ---\nSource: ${page.url}\n\n${page.content}`
          )
          .join("\n\n===\n\n");

        return {
          success: true,
          output: formatted,
          metadata: {
            resultCount: pages.length,
            sources: pages.map((p) => ({ title: p.title, url: p.url })),
          },
        };
      } catch (err) {
        logger.error({
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          success: false,
          output: "",
          error: `Documentation search failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
];
