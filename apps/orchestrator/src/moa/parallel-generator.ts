import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:moa");

const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const HEURISTIC_CODE_BLOCK_RE = /```[\s\S]+```/;
const HEURISTIC_HEADER_RE = /^#{1,3}\s/m;

export interface MoAResult {
  /** Reasoning for why a branch was selected or synthesis was used */
  branchSelectionReasoning: string;
  responses: Array<{
    model: string;
    output: string;
    confidence: number;
    tokensUsed: number;
    duration: number;
    qualityScore?: number;
  }>;
  selectedModel: string;
  synthesized: string;
}

/** Threshold above which a single response is used instead of synthesis */
const SINGLE_RESPONSE_QUALITY_THRESHOLD = 0.85;

export class MixtureOfAgents {
  private readonly models = [
    "ollama/qwen3-coder-next",
    "ollama/deepseek-r1:32b",
    "cerebras/qwen3-235b",
  ];
  private readonly modelRouterUrl: string;

  constructor() {
    this.modelRouterUrl =
      process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
  }

  async generate(prompt: string, maxRounds = 2): Promise<MoAResult> {
    logger.info(
      { models: this.models.length, maxRounds },
      "Starting MoA generation"
    );

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
              messages: [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(120_000),
          });

          if (res.ok) {
            const data = (await res.json()) as {
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
      })
    );

    const validResponses = responses.filter((r) => r.output.length > 0);

    if (validResponses.length === 0) {
      return {
        responses,
        synthesized: "",
        selectedModel: this.models[0] ?? "",
        branchSelectionReasoning: "No valid responses received",
      };
    }

    // Evaluate each response independently for quality
    const scoredResponses = await Promise.all(
      validResponses.map(async (r) => {
        const qualityScore = await this.evaluateResponse(r.output, prompt);
        return { ...r, qualityScore };
      })
    );

    // Update quality scores in the responses array
    const responsesWithScores = responses.map((r) => {
      const scored = scoredResponses.find((s) => s.model === r.model);
      return { ...r, qualityScore: scored?.qualityScore ?? 0 };
    });

    // Sort by quality score descending
    const ranked = [...scoredResponses].sort(
      (a, b) => b.qualityScore - a.qualityScore
    );

    let synthesized: string;
    let selectedModel: string;
    let branchSelectionReasoning: string;

    const bestResponse = ranked[0];

    if (validResponses.length === 1) {
      synthesized = validResponses[0]?.output ?? "";
      selectedModel = validResponses[0]?.model ?? "";
      branchSelectionReasoning = "Only one valid response available";
    } else if (
      bestResponse &&
      bestResponse.qualityScore >= SINGLE_RESPONSE_QUALITY_THRESHOLD
    ) {
      // Best individual response is good enough - no need to synthesize
      synthesized = bestResponse.output;
      selectedModel = bestResponse.model;
      branchSelectionReasoning = `Selected ${bestResponse.model} directly (quality: ${bestResponse.qualityScore.toFixed(2)}) - above ${SINGLE_RESPONSE_QUALITY_THRESHOLD} threshold, no synthesis needed`;
      logger.info(
        {
          selectedModel,
          qualityScore: bestResponse.qualityScore.toFixed(2),
          allScores: ranked.map((r) => ({
            model: r.model,
            score: r.qualityScore.toFixed(2),
          })),
        },
        "Selected best individual response (above quality threshold)"
      );
    } else {
      // No single response is good enough - synthesize
      const result = await this.synthesize(prompt, validResponses);
      synthesized = result.synthesized;
      selectedModel = result.selectedModel;
      branchSelectionReasoning = `Synthesized from ${validResponses.length} responses - best individual score was ${bestResponse?.qualityScore.toFixed(2) ?? "N/A"} (below ${SINGLE_RESPONSE_QUALITY_THRESHOLD} threshold)`;
    }

    // Optional refinement rounds
    for (let round = 1; round < maxRounds; round++) {
      const refined = await this.evaluateAndRefine(prompt, synthesized, round);
      if (refined.score > 0.9) {
        break;
      }
      synthesized = refined.improved;
    }

    return {
      responses: responsesWithScores,
      synthesized,
      selectedModel,
      branchSelectionReasoning,
    };
  }

  /**
   * Evaluate a single response against the original criteria/prompt.
   * Returns a quality score between 0 and 1.
   */
  async evaluateResponse(response: string, criteria: string): Promise<number> {
    try {
      const res = await fetch(`${this.modelRouterUrl}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: "review",
          messages: [
            {
              role: "system",
              content:
                'You are a response quality evaluator. Score the response quality from 0 to 1 based on correctness, completeness, and relevance to the task. Respond with ONLY a JSON object: { "score": 0.85, "reasoning": "..." }',
            },
            {
              role: "user",
              content: `## Task\n${criteria}\n\n## Response to Evaluate\n${response}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const data = (await res.json()) as { content: string };
        const content = data.content ?? "";
        const jsonMatch = content.match(JSON_OBJECT_RE);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const score = Number(parsed.score);
          if (!Number.isNaN(score) && score >= 0 && score <= 1) {
            return score;
          }
        }
      }
    } catch (err) {
      logger.warn(
        { error: err },
        "Response evaluation failed, using heuristic"
      );
    }

    // Fallback heuristic scoring
    return this.heuristicScore(response);
  }

  private heuristicScore(response: string): number {
    let score = 0.5;

    // Length-based scoring
    if (response.length > 200) {
      score += 0.1;
    }
    if (response.length > 500) {
      score += 0.1;
    }

    // Structure bonus
    if (HEURISTIC_CODE_BLOCK_RE.test(response)) {
      score += 0.1;
    }
    if (HEURISTIC_HEADER_RE.test(response)) {
      score += 0.05;
    }

    return Math.min(score, 1);
  }

  private async synthesize(
    originalPrompt: string,
    responses: Array<{ model: string; output: string }>
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
        signal: AbortSignal.timeout(120_000),
      });

      if (res.ok) {
        const data = (await res.json()) as { content: string };
        return {
          synthesized: data.content ?? responses[0]?.output,
          selectedModel: "synthesized",
        };
      }
    } catch (err) {
      logger.warn(
        { error: err },
        "MoA synthesis failed, using best individual response"
      );
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
    round: number
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
              content:
                'Evaluate the solution quality (0-1) and improve it if possible. Respond with JSON: { "score": 0.9, "improved": "..." }',
            },
            {
              role: "user",
              content: `Task: ${prompt}\n\nCurrent Solution (round ${round}):\n${currentSolution}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (res.ok) {
        const data = (await res.json()) as { content: string };
        const content = data.content ?? "";
        const jsonMatch = content.match(JSON_OBJECT_RE);
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
