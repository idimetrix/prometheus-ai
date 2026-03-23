import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type { AgentToolDefinition } from "./types";

const WHITESPACE_RE = /\s+/;

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const searchFilesSchema = z
  .object({
    pattern: z
      .string()
      .describe("Glob pattern (e.g., '**/*.ts', 'src/**/*.tsx')"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in (default: project root)"),
  })
  .strict();

export const searchContentSchema = z
  .object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z
      .string()
      .optional()
      .describe("Directory or file to search in (default: project root)"),
    filePattern: z
      .string()
      .optional()
      .describe("Glob pattern to filter which files to search (e.g., '*.ts')"),
  })
  .strict();

export const searchSemanticSchema = z
  .object({
    query: z
      .string()
      .describe(
        "Natural language query (e.g., 'user authentication logic', 'database connection setup')"
      ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max results to return (default: 10)"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const searchTools: AgentToolDefinition[] = [
  {
    name: "search_files",
    description:
      "Search for files matching a glob pattern in the project. Returns matching file paths.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern (e.g., '**/*.ts', 'src/**/*.tsx')",
        },
        path: {
          type: "string",
          description: "Directory to search in (default: project root)",
        },
      },
      required: ["pattern"],
    },
    zodSchema: searchFilesSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = searchFilesSchema.parse(input);
      const searchPath = parsed.path
        ? `${ctx.workDir}/${parsed.path}`
        : ctx.workDir;

      // Use find with glob matching, excluding common noise directories
      const command = `find "${searchPath}" -path "*/node_modules" -prune -o -path "*/.git" -prune -o -path "*/dist" -prune -o -name "${parsed.pattern}" -print 2>/dev/null | head -200 | sort`;
      return await execInSandbox(command, ctx);
    },
  },
  {
    name: "search_content",
    description:
      "Search for a regex pattern in file contents across the codebase (like grep). Returns matching lines with file paths and line numbers.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: {
          type: "string",
          description: "Directory or file to search in (default: project root)",
        },
        filePattern: {
          type: "string",
          description:
            "Glob pattern to filter which files to search (e.g., '*.ts')",
        },
      },
      required: ["pattern"],
    },
    zodSchema: searchContentSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = searchContentSchema.parse(input);
      const searchPath = parsed.path
        ? `${ctx.workDir}/${parsed.path}`
        : ctx.workDir;

      // Prefer ripgrep if available, fall back to grep
      const escapedPattern = parsed.pattern.replace(/"/g, '\\"');
      const parts = [
        "(",
        "command -v rg > /dev/null && rg --no-heading -n --max-count 5 --max-filesize 1M",
        ...(parsed.filePattern ? [`--glob "${parsed.filePattern}"`] : []),
        `"${escapedPattern}" "${searchPath}"`,
        "||",
        `grep -rn --include="${parsed.filePattern || "*"}" -m 5`,
        `"${escapedPattern}" "${searchPath}"`,
        ")",
        "2>/dev/null | head -100",
      ];

      return await execInSandbox(parts.join(" "), ctx);
    },
  },
  {
    name: "search_semantic",
    description:
      "Semantic search through the codebase using the Project Brain's vector embeddings. Finds code by meaning, not just text matching. Best for finding implementations of concepts.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language query (e.g., 'user authentication logic', 'database connection setup')",
        },
        limit: {
          type: "number",
          description: "Max results to return (default: 10)",
        },
      },
      required: ["query"],
    },
    zodSchema: searchSemanticSchema,
    permissionLevel: "read",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = searchSemanticSchema.parse(input);
      const limit = parsed.limit || 10;

      // Call the project-brain service for vector search
      const brainUrl = process.env.PROJECT_BRAIN_URL || "http://localhost:4006";
      try {
        const response = await fetch(`${brainUrl}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: ctx.projectId,
            query: parsed.query,
            limit,
          }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          // Fallback: use grep-based search if brain is unavailable
          return fallbackSearch(parsed.query, ctx);
        }

        const results = (await response.json()) as Array<{
          filePath: string;
          chunk: string;
          score: number;
        }>;

        if (results.length === 0) {
          return {
            success: true,
            output:
              "No semantic matches found. Try a different query or use search_content for text matching.",
          };
        }

        const formatted = results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.filePath} (score: ${r.score.toFixed(3)})\n${r.chunk}`
          )
          .join("\n\n");

        return {
          success: true,
          output: formatted,
          metadata: { resultCount: results.length },
        };
      } catch {
        return fallbackSearch(parsed.query, ctx);
      }
    },
  },
];

async function fallbackSearch(
  query: string,
  ctx: import("./types").ToolExecutionContext
): Promise<import("./types").ToolResult> {
  // Extract key terms from the natural language query for grep fallback
  const terms = query
    .toLowerCase()
    .split(WHITESPACE_RE)
    .filter(
      (t) =>
        t.length > 3 &&
        ![
          "the",
          "and",
          "for",
          "with",
          "that",
          "this",
          "from",
          "what",
          "where",
          "when",
          "how",
        ].includes(t)
    );

  if (terms.length === 0) {
    return {
      success: true,
      output:
        "Semantic search unavailable and no meaningful terms to grep for.",
    };
  }

  const grepPattern = terms.slice(0, 3).join("\\|");
  const command = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" -l "${grepPattern}" "${ctx.workDir}" 2>/dev/null | head -20`;
  return await execInSandbox(command, ctx);
}
