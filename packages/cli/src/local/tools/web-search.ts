import type { LocalTool, ToolResult } from "./types";

export const webSearchTool: LocalTool = {
  name: "web_search",
  description:
    "Search the web for information. Returns search results as text. Requires internet access.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
    },
    required: ["query"],
  },
  requiresApproval: false,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query);

    // Use DuckDuckGo Instant Answer API (no key required)
    try {
      const encoded = encodeURIComponent(query);
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`
      );

      if (!response.ok) {
        return {
          success: false,
          output: `Search request failed: ${String(response.status)}`,
        };
      }

      const data = (await response.json()) as {
        Abstract?: string;
        AbstractSource?: string;
        AbstractURL?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const results: string[] = [];

      if (data.Abstract) {
        results.push(`Summary: ${data.Abstract}`);
        if (data.AbstractSource) {
          results.push(`Source: ${data.AbstractSource} (${data.AbstractURL})`);
        }
        results.push("");
      }

      if (data.RelatedTopics) {
        const topics = data.RelatedTopics.slice(0, 8);
        for (const topic of topics) {
          if (topic.Text) {
            results.push(`- ${topic.Text}`);
            if (topic.FirstURL) {
              results.push(`  ${topic.FirstURL}`);
            }
          }
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          output: `No results found for: "${query}". Try rephrasing the search query.`,
        };
      }

      return { success: true, output: results.join("\n") };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: `Search failed: ${msg}`,
      };
    }
  },
};
