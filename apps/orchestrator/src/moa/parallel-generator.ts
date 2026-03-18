import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:moa");

export interface MoAResult {
  responses: Array<{
    model: string;
    output: string;
    confidence: number;
    tokensUsed: number;
    duration: number;
  }>;
  synthesized: string;
  selectedModel: string;
}

export class MixtureOfAgents {
  private readonly models = [
    "ollama/qwen3-coder-next",
    "ollama/deepseek-r1:32b",
    "cerebras/qwen3-235b",
  ];
  private readonly modelRouterUrl: string;

  constructor() {
    this.modelRouterUrl = process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
  }

  async generate(prompt: string, maxRounds: number = 2): Promise<MoAResult> {
    logger.info({ models: this.models.length, maxRounds }, "Starting MoA generation");

    // Round 1: Generate from multiple models in parallel
    const responses = await Promise.all(
      this.models.map(async (model) => {
        const start = Date.now();
        try {
          const res = await fetch(`${this.modelRouterUrl}/route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slot: "default",
              model,
              messages: [
                { role: "user", content: prompt },
              ],
            }),
            signal: AbortSignal.timeout(120000),
          });

          if (res.ok) {
            const data = await res.json() as {
              content: string;
              tokensUsed?: number;
            };
            return {
              model,
              output: data.content ?? "",
              confidence: 0.8,
              tokensUsed: data.tokensUsed ?? 0,
              duration: Date.now() - start,
            };
          }
        } catch (err) {
          logger.warn({ model, error: err }, "MoA model call failed");
        }
        return {
          model,
          output: "",
          confidence: 0,
          tokensUsed: 0,
          duration: Date.now() - start,
        };
      }),
    );

    const validResponses = responses.filter((r) => r.output.length > 0);

    if (validResponses.length === 0) {
      return {
        responses,
        synthesized: "",
        selectedModel: this.models[0]!,
      };
    }

    // Round 2: Synthesize the best solution
    let synthesized: string;
    let selectedModel: string;

    if (validResponses.length === 1) {
      synthesized = validResponses[0]!.output;
      selectedModel = validResponses[0]!.model;
    } else {
      const result = await this.synthesize(prompt, validResponses);
      synthesized = result.synthesized;
      selectedModel = result.selectedModel;
    }

    // Optional refinement rounds
    for (let round = 1; round < maxRounds; round++) {
      const refined = await this.evaluateAndRefine(prompt, synthesized, round);
      if (refined.score > 0.9) break;
      synthesized = refined.improved;
    }

    return { responses, synthesized, selectedModel };
  }

  private async synthesize(
    originalPrompt: string,
    responses: Array<{ model: string; output: string }>,
  ): Promise<{ synthesized: string; selectedModel: string }> {
    const synthesisPrompt = `You are synthesizing solutions from multiple AI models.
Given the original task and multiple solutions, create the best combined solution.
Take the strongest elements from each response.

## Original Task
${originalPrompt}

## Solutions
${responses.map((r, i) => `### Solution ${i + 1} (${r.model})\n${r.output}`).join("\n\n")}

## Your Task
Synthesize the best combined solution, taking the strongest elements from each.`;

    try {
      const res = await fetch(`${this.modelRouterUrl}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: "review",
          messages: [{ role: "user", content: synthesisPrompt }],
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (res.ok) {
        const data = await res.json() as { content: string };
        return {
          synthesized: data.content ?? responses[0]!.output,
          selectedModel: "synthesized",
        };
      }
    } catch (err) {
      logger.warn({ error: err }, "MoA synthesis failed, using best individual response");
    }

    // Fallback: pick longest response as proxy for most thorough
    const best = responses.reduce((a, b) =>
      a.output.length > b.output.length ? a : b
    );
    return { synthesized: best.output, selectedModel: best.model };
  }

  async evaluateAndRefine(
    prompt: string,
    currentSolution: string,
    round: number,
  ): Promise<{ improved: string; score: number }> {
    try {
      const res = await fetch(`${this.modelRouterUrl}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: "review",
          messages: [
            {
              role: "system",
              content: "Evaluate the solution quality (0-1) and improve it if possible. Respond with JSON: { \"score\": 0.9, \"improved\": \"...\" }",
            },
            {
              role: "user",
              content: `Task: ${prompt}\n\nCurrent Solution (round ${round}):\n${currentSolution}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (res.ok) {
        const data = await res.json() as { content: string };
        const content = data.content ?? "";
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            improved: parsed.improved ?? currentSolution,
            score: parsed.score ?? 0.8,
          };
        }
      }
    } catch (err) {
      logger.warn({ round, error: err }, "MoA refinement failed");
    }

    return { improved: currentSolution, score: 0.85 };
  }
}
