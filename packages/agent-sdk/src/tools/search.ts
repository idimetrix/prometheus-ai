import type { AgentToolDefinition } from "./types";
import { execInSandbox } from "./sandbox";

export const searchTools: AgentToolDefinition[] = [
  {
    name: "search_files",
    description: "Search for files matching a glob pattern in the project. Returns matching file paths.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g., '**/*.ts', 'src/**/*.tsx')" },
        path: { type: "string", description: "Directory to search in (default: project root)" },
      },
      required: ["pattern"],
    },
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const pattern = input.pattern as string;
      const searchPath = input.path
        ? `${ctx.workDir}/${input.path}`
        : ctx.workDir;

      // Use find with glob matching, excluding common noise directories
      const command = `find "${searchPath}" -path "*/node_modules" -prune -o -path "*/.git" -prune -o -path "*/dist" -prune -o -name "${pattern}" -print 2>/dev/null | head -200 | sort`;
      return execInSandbox(command, ctx);
    },
  },
  {
    name: "search_content",
    description: "Search for a regex pattern in file contents across the codebase (like grep). Returns matching lines with file paths and line numbers.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory or file to search in (default: project root)" },
        filePattern: { type: "string", description: "Glob pattern to filter which files to search (e.g., '*.ts')" },
      },
      required: ["pattern"],
    },
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const pattern = input.pattern as string;
      const searchPath = input.path
        ? `${ctx.workDir}/${input.path}`
        : ctx.workDir;
      const filePattern = input.filePattern as string | undefined;

      // Prefer ripgrep if available, fall back to grep
      const parts = [
        "(",
        `command -v rg > /dev/null && rg --no-heading -n --max-count 5 --max-filesize 1M`,
        ...(filePattern ? [`--glob "${filePattern}"`] : []),
        `"${pattern.replace(/"/g, '\\"')}" "${searchPath}"`,
        "||",
        `grep -rn --include="${filePattern || '*'}" -m 5`,
        `"${pattern.replace(/"/g, '\\"')}" "${searchPath}"`,
        ")",
        "2>/dev/null | head -100",
      ];

      return execInSandbox(parts.join(" "), ctx);
    },
  },
  {
    name: "search_semantic",
    description: "Semantic search through the codebase using the Project Brain's vector embeddings. Finds code by meaning, not just text matching. Best for finding implementations of concepts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language query (e.g., 'user authentication logic', 'database connection setup')" },
        limit: { type: "number", description: "Max results to return (default: 10)" },
      },
      required: ["query"],
    },
    permissionLevel: "read",
    creditCost: 2,
    execute: async (input, ctx) => {
      const query = input.query as string;
      const limit = (input.limit as number) || 10;

      // Call the project-brain service for vector search
      const brainUrl = process.env.PROJECT_BRAIN_URL || "http://localhost:4006";
      try {
        const response = await fetch(`${brainUrl}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: ctx.projectId,
            query,
            limit,
          }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          // Fallback: use grep-based search if brain is unavailable
          return fallbackSearch(query, ctx);
        }

        const results = (await response.json()) as Array<{
          filePath: string;
          chunk: string;
          score: number;
        }>;

        if (results.length === 0) {
          return { success: true, output: "No semantic matches found. Try a different query or use search_content for text matching." };
        }

        const formatted = results
          .map((r, i) => `[${i + 1}] ${r.filePath} (score: ${r.score.toFixed(3)})\n${r.chunk}`)
          .join("\n\n");

        return {
          success: true,
          output: formatted,
          metadata: { resultCount: results.length },
        };
      } catch {
        return fallbackSearch(query, ctx);
      }
    },
  },
];

async function fallbackSearch(query: string, ctx: import("./types").ToolExecutionContext): Promise<import("./types").ToolResult> {
  // Extract key terms from the natural language query for grep fallback
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3 && !["the", "and", "for", "with", "that", "this", "from", "what", "where", "when", "how"].includes(t));

  if (terms.length === 0) {
    return { success: true, output: "Semantic search unavailable and no meaningful terms to grep for." };
  }

  const grepPattern = terms.slice(0, 3).join("\\|");
  const command = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" -l "${grepPattern}" "${ctx.workDir}" 2>/dev/null | head -20`;
  return execInSandbox(command, ctx);
}
