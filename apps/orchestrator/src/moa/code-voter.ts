import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:moa:code-voter");

const VOTE_RE = /VOTE:\s*(\d+)/;
const REASONING_RE = /REASONING:\s*(.+)/s;
const CODE_BLOCK_RE = /```[\w]*\n([\s\S]*?)```/;
const REASONING_BLOCK_RE = /REASONING:\s*([\s\S]*?)(?=CODE:|```|$)/i;

export interface CodeSolution {
  code: string;
  model: string;
  reasoning: string;
}

export interface VoteResult {
  consensus: number;
  votes: Array<{
    voter: string;
    votedFor: string;
    reasoning: string;
  }>;
  winningSolution: CodeSolution;
}

interface ChatCompletionMessage {
  content: string;
  role: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class CodeVoter {
  private readonly modelRouterUrl: string;

  constructor(modelRouterUrl: string) {
    this.modelRouterUrl = modelRouterUrl;
  }

  async generateSolutions(
    prompt: string,
    models: string[],
    count?: number
  ): Promise<CodeSolution[]> {
    const targetCount = count ?? models.length;
    const selectedModels = models.slice(0, targetCount);

    logger.info(
      { models: selectedModels, prompt: prompt.slice(0, 100) },
      "Generating solutions from multiple models"
    );

    const promises = selectedModels.map(async (model) => {
      try {
        const response = await this.chatCompletion(model, [
          {
            role: "system",
            content:
              "You are an expert software engineer. Provide a code solution with clear reasoning. Format your response as:\nREASONING: <your reasoning>\nCODE:\n```\n<your code>\n```",
          },
          {
            role: "user",
            content: prompt,
          },
        ]);

        const { code, reasoning } = this.parseSolutionResponse(response);

        return {
          model,
          code,
          reasoning,
        };
      } catch (error) {
        logger.error(
          {
            model,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to generate solution"
        );
        return {
          model,
          code: "",
          reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });

    const solutions = await Promise.all(promises);

    logger.info({ solutionCount: solutions.length }, "Solutions generated");

    return solutions;
  }

  async vote(prompt: string, solutions: CodeSolution[]): Promise<VoteResult> {
    if (solutions.length === 0) {
      throw new Error("No solutions to vote on");
    }

    if (solutions.length === 1 && solutions[0]) {
      return {
        winningSolution: solutions[0],
        votes: [],
        consensus: 1.0,
      };
    }

    logger.info({ solutionCount: solutions.length }, "Starting voting process");

    const solutionDescriptions = solutions
      .map(
        (s, i) =>
          `Solution ${i + 1} (by ${s.model}):\nReasoning: ${s.reasoning}\nCode:\n${s.code}`
      )
      .join("\n\n---\n\n");

    const votePromises = solutions.map(async (voterSolution) => {
      const otherSolutions = solutions.filter(
        (s) => s.model !== voterSolution.model
      );

      if (otherSolutions.length === 0) {
        return {
          voter: voterSolution.model,
          votedFor: voterSolution.model,
          reasoning: "No other solutions to compare",
        };
      }

      try {
        const response = await this.chatCompletion(voterSolution.model, [
          {
            role: "system",
            content:
              "You are reviewing code solutions from multiple models. You must vote for the BEST solution (you cannot vote for your own). Respond with exactly:\nVOTE: <solution number>\nREASONING: <brief explanation>",
          },
          {
            role: "user",
            content: `Original prompt: ${prompt}\n\nHere are the solutions to evaluate:\n\n${solutionDescriptions}\n\nYour model is: ${voterSolution.model}. Vote for the best solution (not your own).`,
          },
        ]);

        const voteMatch = response.match(VOTE_RE);
        const reasoningMatch = response.match(REASONING_RE);

        const votedIndex = voteMatch
          ? Number.parseInt(voteMatch[1] ?? "1", 10) - 1
          : 0;
        const clampedIndex = Math.max(
          0,
          Math.min(votedIndex, solutions.length - 1)
        );
        const votedSolution = solutions[clampedIndex];

        return {
          voter: voterSolution.model,
          votedFor: votedSolution?.model ?? solutions[0]?.model ?? "unknown",
          reasoning: reasoningMatch?.[1]?.trim() ?? "No reasoning provided",
        };
      } catch (error) {
        logger.error(
          {
            voter: voterSolution.model,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to collect vote"
        );

        // Default to first other solution on error
        const fallback = otherSolutions[0];
        return {
          voter: voterSolution.model,
          votedFor: fallback?.model ?? "unknown",
          reasoning: `Voting failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    });

    const votes = await Promise.all(votePromises);

    // Tally votes
    const voteCounts = new Map<string, number>();
    for (const vote of votes) {
      const current = voteCounts.get(vote.votedFor) ?? 0;
      voteCounts.set(vote.votedFor, current + 1);
    }

    // Find winner
    let maxVotes = 0;
    let winnerModel = solutions[0]?.model ?? "";
    for (const [model, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        winnerModel = model;
      }
    }

    const winningSolution =
      solutions.find((s) => s.model === winnerModel) ?? solutions[0];

    if (!winningSolution) {
      throw new Error("No winning solution could be determined");
    }

    // Calculate consensus: proportion of votes for the winner
    const totalVotes = votes.length;
    const consensus = totalVotes > 0 ? maxVotes / totalVotes : 0;

    logger.info(
      {
        winner: winnerModel,
        consensus,
        voteBreakdown: Object.fromEntries(voteCounts),
      },
      "Voting complete"
    );

    return {
      winningSolution,
      votes,
      consensus,
    };
  }

  async generateAndVote(prompt: string, models: string[]): Promise<VoteResult> {
    const solutions = await this.generateSolutions(prompt, models);
    return this.vote(prompt, solutions);
  }

  private async chatCompletion(
    model: string,
    messages: ChatCompletionMessage[]
  ): Promise<string> {
    const response = await fetch(`${this.modelRouterUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Model router request failed: ${response.status} ${errorText}`
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices[0]?.message.content;
    if (!content) {
      throw new Error("Empty response from model");
    }
    return content;
  }

  private parseSolutionResponse(response: string): {
    code: string;
    reasoning: string;
  } {
    const codeMatch = response.match(CODE_BLOCK_RE);
    const code = codeMatch?.[1]?.trim() ?? response.trim();

    const reasoningMatch = response.match(REASONING_BLOCK_RE);
    const reasoning = reasoningMatch?.[1]?.trim() ?? "";

    return { code, reasoning };
  }
}
