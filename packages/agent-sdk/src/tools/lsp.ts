import { z } from "zod";
import type {
  AgentToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./types";
import { defineTool } from "./types";

async function callLsp(
  ctx: ToolExecutionContext,
  method: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  const baseUrl = process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";
  try {
    const res = await fetch(
      `${baseUrl}/sandbox/${ctx.sandboxId}/lsp/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { success: false, output: "", error: `LSP error: ${text}` };
    }
    const data = await res.json();
    return {
      success: true,
      output: JSON.stringify(data, null, 2),
      metadata: { method },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: `LSP request failed: ${msg}` };
  }
}

const lspGotoDefinition = defineTool({
  name: "lsp_goto_definition",
  description:
    "Go to the definition of a symbol at the given file position. Returns the file path and position of the definition.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Path to the file containing the symbol",
      },
      line: { type: "number", description: "Line number (0-indexed)" },
      character: {
        type: "number",
        description: "Character offset (0-indexed)",
      },
    },
    required: ["filePath", "line", "character"],
  },
  zodSchema: z.object({
    filePath: z.string(),
    line: z.number(),
    character: z.number(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "read",
  creditCost: 0.1,
  riskLevel: "low",
  execute: async (input, ctx) =>
    callLsp(ctx, "goto-definition", {
      filePath: input.filePath,
      line: input.line,
      character: input.character,
    }),
});

const lspFindReferences = defineTool({
  name: "lsp_find_references",
  description:
    "Find all references to a symbol at the given file position across the codebase.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Path to the file containing the symbol",
      },
      line: { type: "number", description: "Line number (0-indexed)" },
      character: {
        type: "number",
        description: "Character offset (0-indexed)",
      },
    },
    required: ["filePath", "line", "character"],
  },
  zodSchema: z.object({
    filePath: z.string(),
    line: z.number(),
    character: z.number(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "read",
  creditCost: 0.1,
  riskLevel: "low",
  execute: async (input, ctx) =>
    callLsp(ctx, "find-references", {
      filePath: input.filePath,
      line: input.line,
      character: input.character,
    }),
});

const lspHover = defineTool({
  name: "lsp_hover",
  description:
    "Get type information and documentation for a symbol at the given position.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Path to the file containing the symbol",
      },
      line: { type: "number", description: "Line number (0-indexed)" },
      character: {
        type: "number",
        description: "Character offset (0-indexed)",
      },
    },
    required: ["filePath", "line", "character"],
  },
  zodSchema: z.object({
    filePath: z.string(),
    line: z.number(),
    character: z.number(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "read",
  creditCost: 0.05,
  riskLevel: "low",
  execute: async (input, ctx) =>
    callLsp(ctx, "hover", {
      filePath: input.filePath,
      line: input.line,
      character: input.character,
    }),
});

const lspDiagnostics = defineTool({
  name: "lsp_diagnostics",
  description:
    "Get all diagnostics (errors, warnings) for a file from the language server.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Path to the file to check",
      },
    },
    required: ["filePath"],
  },
  zodSchema: z.object({
    filePath: z.string(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "read",
  creditCost: 0.05,
  riskLevel: "low",
  execute: async (input, ctx) =>
    callLsp(ctx, "diagnostics", { filePath: input.filePath }),
});

const lspCompletions = defineTool({
  name: "lsp_completions",
  description: "Get code completions at a given position in a file.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Path to the file",
      },
      line: { type: "number", description: "Line number (0-indexed)" },
      character: {
        type: "number",
        description: "Character offset (0-indexed)",
      },
    },
    required: ["filePath", "line", "character"],
  },
  zodSchema: z.object({
    filePath: z.string(),
    line: z.number(),
    character: z.number(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "read",
  creditCost: 0.05,
  riskLevel: "low",
  execute: async (input, ctx) =>
    callLsp(ctx, "completions", {
      filePath: input.filePath,
      line: input.line,
      character: input.character,
    }),
});

export const lspTools: AgentToolDefinition[] = [
  lspGotoDefinition,
  lspFindReferences,
  lspHover,
  lspDiagnostics,
  lspCompletions,
];
