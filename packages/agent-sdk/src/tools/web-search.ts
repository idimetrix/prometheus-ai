import { createLogger } from "@prometheus/logger";
import { z } from "zod";
import type { AgentToolDefinition, ToolResult } from "./types";

const logger = createLogger("agent-sdk:web-search");

const MAX_RESULTS_DEFAULT = 5;
const FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const webSearchSchema = z
  .object({
    query: z.string().min(1).describe("Search query string"),
    maxResults: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of results to return (default: 5)"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Search result type
// ---------------------------------------------------------------------------

interface SearchResult {
  snippet: string;
  title: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Search backends
// ---------------------------------------------------------------------------

async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string
): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };

  return (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

async function searchSearXNG(
  query: string,
  maxResults: number,
  baseUrl: string
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
  });

  const response = await fetch(`${baseUrl}/search?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`SearXNG error: ${response.status}`);
  }

  const data = (await response.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };

  return (data.results || []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

async function searchDuckDuckGo(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(
    `https://lite.duckduckgo.com/lite/?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Prometheus/1.0; +https://prometheus.dev)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    throw new Error(`DuckDuckGo error: ${response.status}`);
  }

  const html = await response.text();
  return parseDuckDuckGoResults(html, maxResults);
}

/**
 * Parse DuckDuckGo Lite HTML results.
 * The lite page uses a table layout with result links and snippets.
 */
function parseDuckDuckGoResults(
  html: string,
  maxResults: number
): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result links: <a rel="nofollow" href="URL" class="result-link">TITLE</a>
  const linkRegex =
    /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  // Match snippets: <td class="result-snippet">SNIPPET</td>
  const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let linkMatch = linkRegex.exec(html);
  while (linkMatch) {
    links.push({
      url: linkMatch[1] ?? "",
      title: stripHtmlTags(linkMatch[2] ?? "").trim(),
    });
    linkMatch = linkRegex.exec(html);
  }

  const snippets: string[] = [];
  let snippetMatch = snippetRegex.exec(html);
  while (snippetMatch) {
    snippets.push(stripHtmlTags(snippetMatch[1] ?? "").trim());
    snippetMatch = snippetRegex.exec(html);
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    const link = links[i];
    if (!link) {
      continue;
    }
    results.push({
      title: link.title || "Untitled",
      url: link.url,
      snippet: snippets[i] || "",
    });
  }

  // Fallback: parse generic anchor tags if the class-based approach found nothing
  if (results.length === 0) {
    const genericLinkRegex =
      /<a[^>]+rel="nofollow"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let genericMatch = genericLinkRegex.exec(html);
    while (genericMatch && results.length < maxResults) {
      const url = genericMatch[1] ?? "";
      const title = stripHtmlTags(genericMatch[2] ?? "").trim();
      if (title && url && !url.includes("duckduckgo.com")) {
        results.push({ title, url, snippet: "" });
      }
      genericMatch = genericLinkRegex.exec(html);
    }
  }

  return results;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------------------------------------------------------------------------
// Main search function with fallback chain
// ---------------------------------------------------------------------------

async function executeWebSearch(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      logger.debug({ query }, "Searching with Tavily");
      return await searchTavily(query, maxResults, tavilyKey);
    } catch (err) {
      logger.warn({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const searxngUrl = process.env.SEARXNG_URL;
  if (searxngUrl) {
    try {
      logger.debug({ query }, "Searching with SearXNG");
      return await searchSearXNG(query, maxResults, searxngUrl);
    } catch (err) {
      logger.warn({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    logger.debug({ query }, "Searching with DuckDuckGo Lite");
    return await searchDuckDuckGo(query, maxResults);
  } catch (err) {
    logger.warn({
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const webSearchTools: AgentToolDefinition[] = [
  {
    name: "web_search",
    description:
      "Search the web for information, documentation, error solutions, and API references. Uses Tavily, SearXNG, or DuckDuckGo as search backends with automatic fallback.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
    zodSchema: webSearchSchema,
    permissionLevel: "read",
    creditCost: 2,
    execute: async (input): Promise<ToolResult> => {
      const parsed = webSearchSchema.parse(input);
      const maxResults = parsed.maxResults || MAX_RESULTS_DEFAULT;

      try {
        const results = await executeWebSearch(parsed.query, maxResults);

        if (results.length === 0) {
          return {
            success: true,
            output:
              "No search results found. Try rephrasing your query or using different keywords.",
            metadata: { resultCount: 0 },
          };
        }

        const formatted = results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`
          )
          .join("\n\n");

        return {
          success: true,
          output: formatted,
          metadata: {
            resultCount: results.length,
            results,
          },
        };
      } catch (err) {
        logger.error({
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          success: false,
          output: "",
          error: `Web search failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
];

export { executeWebSearch };
