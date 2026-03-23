import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:ci-loop:fuzz-testing");

const CRASH_SECTION_RE = /CRASHES:\s*([\s\S]*?)(?=500_ERRORS|TOTAL_INPUTS|$)/i;
const LIST_ITEM_PREFIX_RE = /^\s*[-*]\s*/;
const ERROR_SECTION_RE = /500_ERRORS:\s*([\s\S]*?)(?=TOTAL_INPUTS|$)/i;
const TOTAL_INPUTS_RE = /TOTAL_INPUTS:\s*(\d+)/i;

export interface FuzzResult {
  crashes: string[];
  endpointsTested: number;
  inputsGenerated: number;
  serverErrors: string[];
}

/**
 * FuzzTesting generates edge-case inputs from Zod schemas and tests
 * them against API endpoints in sandbox to find crashes and 500s.
 */
export class FuzzTesting {
  async fuzz(
    agentLoop: AgentLoop,
    targetEndpoints: string[]
  ): Promise<FuzzResult> {
    logger.info({ endpoints: targetEndpoints.length }, "Starting fuzz testing");

    const prompt = `Perform fuzz testing on the following API endpoints/validators:

${targetEndpoints.map((e) => `- ${e}`).join("\n")}

For each endpoint:
1. Read the Zod input schema
2. Generate edge-case inputs:
   - Boundary values (empty strings, max length strings, 0, -1, MAX_SAFE_INTEGER)
   - Null/undefined injection for optional fields
   - SQL injection payloads: ' OR 1=1 --, '; DROP TABLE users; --
   - XSS payloads: <script>alert(1)</script>, javascript:void(0)
   - Type confusion: numbers as strings, objects as arrays
   - Unicode edge cases: zero-width chars, RTL marks, emoji
   - Deeply nested objects (10+ levels)
   - Very large payloads (>1MB strings)
3. Send each input to the endpoint via terminal_exec (curl or fetch)
4. Record any crashes (process exits), 500 errors, or unexpected responses

Report format:
TESTED: <count>
CRASHES: <list of crash-causing inputs>
500_ERRORS: <list of 500-causing inputs>
TOTAL_INPUTS: <count>`;

    const result = await agentLoop.executeTask(prompt, "security_auditor");

    return this.parseResult(result.output, targetEndpoints.length);
  }

  private parseResult(output: string, endpointCount: number): FuzzResult {
    const crashes: string[] = [];
    const serverErrors: string[] = [];

    const crashSection = output.match(CRASH_SECTION_RE);
    if (crashSection?.[1]) {
      for (const line of crashSection[1].split("\n")) {
        const cleaned = line.replace(LIST_ITEM_PREFIX_RE, "").trim();
        if (cleaned.length > 0 && cleaned !== "none" && cleaned !== "None") {
          crashes.push(cleaned);
        }
      }
    }

    const errorSection = output.match(ERROR_SECTION_RE);
    if (errorSection?.[1]) {
      for (const line of errorSection[1].split("\n")) {
        const cleaned = line.replace(LIST_ITEM_PREFIX_RE, "").trim();
        if (cleaned.length > 0 && cleaned !== "none" && cleaned !== "None") {
          serverErrors.push(cleaned);
        }
      }
    }

    const totalMatch = output.match(TOTAL_INPUTS_RE);

    return {
      endpointsTested: endpointCount,
      crashes,
      serverErrors,
      inputsGenerated: totalMatch
        ? Number.parseInt(totalMatch[1] ?? "0", 10)
        : 0,
    };
  }
}
