import { z } from "zod";
import type {
  AgentToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./types";
import { defineTool } from "./types";

async function runInSandbox(
  ctx: ToolExecutionContext,
  command: string,
  timeout = 60_000
): Promise<ToolResult> {
  const baseUrl = process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";
  try {
    const res = await fetch(`${baseUrl}/sandbox/${ctx.sandboxId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command,
        workDir: ctx.workDir,
        timeout,
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

const semgrepScan = defineTool({
  name: "semgrep_scan",
  description:
    "Run Semgrep static analysis to find security vulnerabilities, bugs, and code quality issues. Returns findings with severity levels.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "File or directory path to scan. Defaults to current working directory.",
      },
      rules: {
        type: "string",
        description:
          'Semgrep rules to use. Examples: "auto" (recommended defaults), "p/security-audit", "p/owasp-top-ten", "p/typescript"',
      },
      severity: {
        type: "string",
        description:
          'Minimum severity to report: "INFO", "WARNING", "ERROR". Default: "WARNING"',
      },
    },
    required: [],
  },
  zodSchema: z.object({
    path: z.string().optional(),
    rules: z.string().optional(),
    severity: z.string().optional(),
  }) as unknown as z.ZodType<Record<string, unknown>>,
  permissionLevel: "read",
  creditCost: 1,
  riskLevel: "low",
  execute: async (input, ctx) => {
    const path = input.path ? ` ${input.path}` : " .";
    const rules = input.rules ? String(input.rules) : "auto";
    const severity = input.severity
      ? ` --severity ${input.severity}`
      : " --severity WARNING";
    const cmd = `semgrep --config ${rules} --json${severity}${path}`;
    return await runInSandbox(ctx, cmd, 120_000);
  },
});

export const semgrepTools: AgentToolDefinition[] = [semgrepScan];
