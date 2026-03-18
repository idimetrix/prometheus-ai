import type { AgentToolDefinition } from "./types";

export const searchTools: AgentToolDefinition[] = [
  {
    name: "search_files",
    description: "Search for files matching a glob pattern in the project",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g., '**/*.ts')" },
        path: { type: "string", description: "Directory to search in" },
      },
      required: ["pattern"],
    },
    permissionLevel: "read",
    execute: async (input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] find ${input.pattern}` };
    },
  },
  {
    name: "search_content",
    description: "Search for a regex pattern in file contents (like grep)",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory or file to search in" },
        filePattern: { type: "string", description: "Glob pattern to filter files" },
      },
      required: ["pattern"],
    },
    permissionLevel: "read",
    execute: async (input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] grep "${input.pattern}"` };
    },
  },
  {
    name: "search_semantic",
    description: "Semantic search through the codebase using embeddings (Project Brain)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language query" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
    permissionLevel: "read",
    execute: async (input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] semantic search: ${input.query}` };
    },
  },
];
