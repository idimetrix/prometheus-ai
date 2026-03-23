import { z } from "zod";
import type {
  AgentToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./types";
import { defineTool } from "./types";

async function runInSandbox(
  ctx: ToolExecutionContext,
  command: string
): Promise<ToolResult> {
  const baseUrl = process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";
  try {
    const res = await fetch(`${baseUrl}/sandbox/${ctx.sandboxId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command,
        workDir: ctx.workDir,
        timeout: 30_000,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, output: "", error: text };
    }
    const data = (await res.json()) as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };
    return {
      success: data.exitCode === 0,
      output: data.stdout || data.stderr,
      error: data.exitCode === 0 ? undefined : data.stderr,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: msg };
  }
}

const astGrepSearch = defineTool({
  name: "ast_grep_search",
  description:
    "Search code using structural patterns via ast-grep. Finds code that matches an AST pattern, not just text. Example pattern: 'console.log($$$ARGS)' finds all console.log calls.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "ast-grep pattern to search for. Use $NAME for single nodes, $$$NAME for variadic. Example: 'if ($COND) { $$$BODY }'",
      },
      language: {
        type: "string",
        description:
          "Language to search in (e.g., typescript, python, go, rust)",
      },
      path: {
        type: "string",
        description: "Optional: directory or file path to search within",
      },
    },
    required: ["pattern", "language"],
  },
  zodSchema: z.object({
    pattern: z.string(),
    language: z.string(),
    path: z.string().optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "read",
  creditCost: 0.2,
  riskLevel: "low",
  execute: async (input, ctx) => {
    const pathArg = input.path ? ` ${input.path}` : "";
    const cmd = `sg --pattern '${String(input.pattern).replace(/'/g, "'\\''")}' --lang ${input.language} --json${pathArg}`;
    return await runInSandbox(ctx, cmd);
  },
});

const astGrepReplace = defineTool({
  name: "ast_grep_replace",
  description:
    "Replace code matching a structural AST pattern. Performs structural find-and-replace across files. Returns a preview of changes (dry-run).",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "ast-grep pattern to match",
      },
      replacement: {
        type: "string",
        description:
          "Replacement pattern. Reference captured nodes with $NAME.",
      },
      language: {
        type: "string",
        description: "Language (e.g., typescript, python, go)",
      },
      path: {
        type: "string",
        description: "Directory or file path to apply replacement in",
      },
    },
    required: ["pattern", "replacement", "language"],
  },
  zodSchema: z.object({
    pattern: z.string(),
    replacement: z.string(),
    language: z.string(),
    path: z.string().optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "write",
  creditCost: 0.5,
  riskLevel: "medium",
  execute: async (input, ctx) => {
    const pathArg = input.path ? ` ${input.path}` : "";
    const escPattern = String(input.pattern).replace(/'/g, "'\\''");
    const escReplacement = String(input.replacement).replace(/'/g, "'\\''");
    const cmd = `sg --pattern '${escPattern}' --rewrite '${escReplacement}' --lang ${input.language} --json${pathArg}`;
    return await runInSandbox(ctx, cmd);
  },
});

export const astGrepTools: AgentToolDefinition[] = [
  astGrepSearch,
  astGrepReplace,
];
