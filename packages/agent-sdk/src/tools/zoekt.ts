import { z } from "zod";
import type { AgentToolDefinition } from "./types";
import { defineTool } from "./types";

const zoektSearch = defineTool({
  name: "zoekt_search",
  description:
    "Search indexed code using Zoekt trigram index. Much faster than grep for large codebases (100K+ LOC). Supports regex and literal queries.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query. Supports regex, file filters (file:*.ts), symbol queries (sym:functionName), case-sensitive (case:yes)",
      },
      maxMatches: {
        type: "number",
        description: "Maximum number of matches to return (default: 50)",
      },
    },
    required: ["query"],
  },
  zodSchema: z.object({
    query: z.string(),
    maxMatches: z.number().optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "read",
  creditCost: 0.1,
  riskLevel: "low",
  execute: async (input, ctx) => {
    const zoektUrl = process.env.ZOEKT_URL ?? "http://localhost:6070";
    try {
      const params = new URLSearchParams({
        q: String(input.query),
        num: String(input.maxMatches ?? 50),
        format: "json",
      });
      const res = await fetch(`${zoektUrl}/api/search?${params}`);
      if (!res.ok) {
        const text = await res.text();
        return { success: false, output: "", error: `Zoekt error: ${text}` };
      }
      const data = await res.json();
      return {
        success: true,
        output: JSON.stringify(data, null, 2),
        metadata: { sandboxId: ctx.sandboxId },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: "",
        error: `Zoekt search failed: ${msg}`,
      };
    }
  },
});

export const zoektTools: AgentToolDefinition[] = [zoektSearch];
