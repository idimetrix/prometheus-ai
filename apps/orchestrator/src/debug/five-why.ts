import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:debug");

const JSON_OBJECT_RE = /\{[\s\S]*\}/;

export interface FiveWhyResult {
  error: string;
  minimalFix: string;
  rootCause: string;
  similarBugs: string[];
  testCases: string[];
  whyChain: string[];
}

export class FiveWhyDebugger {
  private readonly modelRouterUrl: string;

  constructor() {
    this.modelRouterUrl =
      process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
  }

  async analyze(error: string, codeContext: string): Promise<FiveWhyResult> {
    logger.info("Starting 5-Why analysis");

    try {
      const response = await fetch(`${this.modelRouterUrl}/route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          slot: "think",
          messages: [
            {
              role: "system",
              content: `You are a debugging expert performing 5-Why root cause analysis.
Given an error and code context, perform structured analysis.
Respond in this exact JSON format:
{
  "whyChain": ["Why 1 answer", "Why 2 answer", "Why 3 answer", "Why 4 answer", "Why 5 answer"],
  "rootCause": "The fundamental root cause",
  "minimalFix": "The smallest code change that fixes this",
  "testCases": ["Test case 1 description", "Test case 2 description"],
  "similarBugs": ["Description of similar bugs to watch for"]
}`,
            },
            {
              role: "user",
              content: `Error: ${error}\n\nCode Context:\n${codeContext}`,
            },
          ],
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { content: string };
        const content = data.content ?? "";
        const jsonMatch = content.match(JSON_OBJECT_RE);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            error,
            whyChain: parsed.whyChain ?? [],
            rootCause: parsed.rootCause ?? "Unable to determine",
            minimalFix: parsed.minimalFix ?? "",
            testCases: parsed.testCases ?? [],
            similarBugs: parsed.similarBugs ?? [],
          };
        }
      }
    } catch (err) {
      logger.warn(
        { error: err },
        "LLM-based 5-Why analysis failed, using heuristic"
      );
    }

    // Heuristic fallback
    return this.heuristicAnalysis(error, codeContext);
  }

  private heuristicAnalysis(
    error: string,
    _codeContext: string
  ): FiveWhyResult {
    const isTypeError = error.includes("TypeError") || error.includes("TS2");
    const isImportError =
      error.includes("Cannot find module") || error.includes("import");
    const isNullError = error.includes("null") || error.includes("undefined");

    let rootCause = "Unknown error pattern";
    let minimalFix = "Review the error and context";
    const testCases: string[] = [];

    if (isTypeError) {
      rootCause = "Type mismatch or missing type definition";
      minimalFix = "Add proper type annotations or fix the type mismatch";
      testCases.push("Add type-level test to verify interface conformance");
    } else if (isImportError) {
      rootCause = "Missing or incorrect module import path";
      minimalFix = "Fix the import path or install the missing dependency";
      testCases.push("Add module resolution test");
    } else if (isNullError) {
      rootCause = "Null/undefined value accessed without guard";
      minimalFix = "Add null check or optional chaining";
      testCases.push("Add test for null/undefined edge case");
    }

    return {
      error,
      whyChain: [
        `Why did the error occur? → ${error.slice(0, 100)}`,
        `Why was this state reached? → ${rootCause}`,
        "Why wasn't this caught earlier? → Missing test coverage for this path",
        "Why was the test missing? → Edge case not identified during planning",
        "Why wasn't the edge case identified? → Requirements did not specify this scenario",
      ],
      rootCause,
      minimalFix,
      testCases,
      similarBugs: [],
    };
  }
}
