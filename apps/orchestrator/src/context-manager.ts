import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:context");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

/** Target budget for assembled context (in approximate tokens). */
const DEFAULT_TOKEN_BUDGET = 14_000;

/** Approximate tokens per character (for estimation). */
const CHARS_PER_TOKEN = 4;

interface ContextLayer {
  content: string;
  name: string;
  priority: number; // higher = more important, kept when trimming
  tokenEstimate: number;
}

interface AssembledContext {
  layers: ContextLayer[];
  systemPrompt: string;
  totalTokens: number;
  truncated: boolean;
}

/**
 * ContextManager assembles the optimal context for an agent iteration.
 * It combines system prompt, project context, recent conversation,
 * and retrieval-augmented context from Project Brain, fitting within
 * the token budget.
 */
export class ContextManager {
  private readonly projectId: string;
  private readonly sessionId: string;
  private readonly tokenBudget: number;

  constructor(
    projectId: string,
    sessionId: string,
    tokenBudget = DEFAULT_TOKEN_BUDGET
  ) {
    this.projectId = projectId;
    this.sessionId = sessionId;
    this.tokenBudget = tokenBudget;
  }

  /**
   * Assemble context from all available layers.
   */
  async assembleContext(params: {
    systemPrompt: string;
    recentMessages: Array<{ role: string; content: string }>;
    taskDescription: string;
    agentRole: string;
  }): Promise<AssembledContext> {
    const layers: ContextLayer[] = [];

    // Layer 1: System prompt (highest priority, always included)
    layers.push({
      name: "system_prompt",
      content: params.systemPrompt,
      priority: 100,
      tokenEstimate: this.estimateTokens(params.systemPrompt),
    });

    // Layer 2: Task description (high priority)
    layers.push({
      name: "task_description",
      content: params.taskDescription,
      priority: 90,
      tokenEstimate: this.estimateTokens(params.taskDescription),
    });

    // Layer 3: Recent conversation (high priority, recent turns)
    const recentContent = params.recentMessages
      .slice(-10) // keep last 10 messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");
    if (recentContent) {
      layers.push({
        name: "recent_conversation",
        content: recentContent,
        priority: 80,
        tokenEstimate: this.estimateTokens(recentContent),
      });
    }

    // Layer 4-8: Fetch from Project Brain (async, with timeout)
    const brainLayers = await this.fetchBrainLayers(
      params.taskDescription,
      params.agentRole
    );
    layers.push(...brainLayers);

    // Assemble within budget
    return this.fitToBudget(layers, params.systemPrompt);
  }

  /**
   * Fetch contextual layers from Project Brain service.
   */
  private async fetchBrainLayers(
    query: string,
    agentRole: string
  ): Promise<ContextLayer[]> {
    const layers: ContextLayer[] = [];

    try {
      const response = await fetch(
        `${PROJECT_BRAIN_URL}/api/projects/${this.projectId}/context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, agentRole, sessionId: this.sessionId }),
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Project Brain context fetch failed"
        );
        return layers;
      }

      const data = (await response.json()) as {
        blueprint?: string;
        semanticResults?: string;
        episodicMemory?: string;
        proceduralMemory?: string;
        conventions?: string;
      };

      // Blueprint (medium-high priority)
      if (data.blueprint) {
        layers.push({
          name: "blueprint",
          content: data.blueprint,
          priority: 70,
          tokenEstimate: this.estimateTokens(data.blueprint),
        });
      }

      // Semantic search results (relevant code snippets)
      if (data.semanticResults) {
        layers.push({
          name: "semantic_search",
          content: data.semanticResults,
          priority: 65,
          tokenEstimate: this.estimateTokens(data.semanticResults),
        });
      }

      // Episodic memory (past decisions)
      if (data.episodicMemory) {
        layers.push({
          name: "episodic_memory",
          content: data.episodicMemory,
          priority: 50,
          tokenEstimate: this.estimateTokens(data.episodicMemory),
        });
      }

      // Procedural memory (learned patterns)
      if (data.proceduralMemory) {
        layers.push({
          name: "procedural_memory",
          content: data.proceduralMemory,
          priority: 45,
          tokenEstimate: this.estimateTokens(data.proceduralMemory),
        });
      }

      // Code conventions
      if (data.conventions) {
        layers.push({
          name: "conventions",
          content: data.conventions,
          priority: 60,
          tokenEstimate: this.estimateTokens(data.conventions),
        });
      }
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to fetch brain layers");
    }

    return layers;
  }

  /**
   * Fit layers within token budget, keeping highest priority layers.
   */
  private fitToBudget(
    layers: ContextLayer[],
    systemPrompt: string
  ): AssembledContext {
    // Sort by priority descending
    const sorted = [...layers].sort((a, b) => b.priority - a.priority);

    const included: ContextLayer[] = [];
    let totalTokens = 0;
    let truncated = false;

    for (const layer of sorted) {
      if (totalTokens + layer.tokenEstimate <= this.tokenBudget) {
        included.push(layer);
        totalTokens += layer.tokenEstimate;
      } else {
        // Try to include a truncated version
        const remainingBudget = this.tokenBudget - totalTokens;
        if (remainingBudget > 200) {
          const truncatedContent = this.truncateToTokens(
            layer.content,
            remainingBudget
          );
          included.push({
            ...layer,
            content: truncatedContent,
            tokenEstimate: remainingBudget,
          });
          totalTokens += remainingBudget;
          truncated = true;
        } else {
          truncated = true;
        }
        break;
      }
    }

    if (truncated) {
      logger.info(
        {
          totalTokens,
          budget: this.tokenBudget,
          includedLayers: included.length,
          totalLayers: layers.length,
        },
        "Context truncated to fit budget"
      );
    }

    return {
      systemPrompt,
      layers: included,
      totalTokens,
      truncated,
    };
  }

  /**
   * Estimate token count from text.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Truncate text to approximately fit within token limit.
   */
  private truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars - 20)}\n... [truncated]`;
  }

  /**
   * Assemble full 5-layer context via Project Brain's ContextAssembler.
   * Scales token budget by model context window.
   */
  async assembleFullContext(params: {
    taskDescription: string;
    agentRole: string;
    modelSlot?: string;
  }): Promise<{
    global: string;
    taskSpecific: string;
    session: string;
    tools: string;
    totalTokensEstimate: number;
  } | null> {
    // Scale token budget by slot
    const slotBudgets: Record<string, number> = {
      longContext: 32_000,
      default: 14_000,
      fastLoop: 8000,
      think: 14_000,
      review: 14_000,
      premium: 24_000,
      background: 6000,
      vision: 10_000,
    };
    const maxTokens =
      slotBudgets[params.modelSlot ?? "default"] ?? this.tokenBudget;

    try {
      const response = await fetch(`${PROJECT_BRAIN_URL}/context/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: this.projectId,
          sessionId: this.sessionId,
          taskDescription: params.taskDescription,
          agentRole: params.agentRole,
          maxTokens,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Full context assembly failed, falling back to basic context"
        );
        return null;
      }

      return (await response.json()) as {
        global: string;
        taskSpecific: string;
        session: string;
        tools: string;
        totalTokensEstimate: number;
      };
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "Project Brain context assembly unavailable"
      );
      return null;
    }
  }

  /**
   * Summarize conversation history to compress context.
   * Called when approaching context window limits.
   */
  async compressHistory(
    messages: Array<{ role: string; content: string }>,
    modelRouterUrl: string
  ): Promise<string> {
    if (messages.length < 6) {
      return messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    }

    try {
      const response = await fetch(`${modelRouterUrl}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: "fastLoop",
          messages: [
            {
              role: "system",
              content:
                "Summarize the following conversation into key decisions, actions taken, and current state. Be concise.",
            },
            {
              role: "user",
              content: messages
                .map((m) => `${m.role}: ${m.content}`)
                .join("\n\n"),
            },
          ],
          options: { maxTokens: 1024, temperature: 0 },
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        return data.choices[0]?.message.content ?? "";
      }
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "Failed to compress history via LLM"
      );
    }

    // Fallback: keep only last 4 messages
    return messages
      .slice(-4)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");
  }
}
