/**
 * Context Isolator — Maintains separate contexts per sub-agent
 * in the compound pipeline. Prevents context pollution between
 * planner, coder, critic, and reviewer agents.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:context-isolator");

export interface IsolatedContext {
  agentRole: string;
  messages: Array<{ role: string; content: string }>;
  sharedFacts: string[];
  tokenBudget: number;
}

export class ContextIsolator {
  private readonly contexts = new Map<string, IsolatedContext>();
  private readonly sharedFacts: string[] = [];

  /**
   * Create an isolated context for an agent role.
   */
  createContext(agentRole: string, tokenBudget: number): IsolatedContext {
    const ctx: IsolatedContext = {
      agentRole,
      messages: [],
      sharedFacts: [...this.sharedFacts],
      tokenBudget,
    };
    this.contexts.set(agentRole, ctx);
    return ctx;
  }

  /**
   * Get an agent's isolated context.
   */
  getContext(agentRole: string): IsolatedContext | undefined {
    return this.contexts.get(agentRole);
  }

  /**
   * Add a fact that should be shared across all agent contexts.
   * Facts are propagated to all existing and future contexts.
   */
  addSharedFact(fact: string): void {
    this.sharedFacts.push(fact);
    for (const ctx of this.contexts.values()) {
      ctx.sharedFacts.push(fact);
    }
    logger.debug(
      { fact: fact.slice(0, 80), totalFacts: this.sharedFacts.length },
      "Shared fact added"
    );
  }

  /**
   * Transfer specific outputs from one agent's context to another's.
   * Only transfers the specified content, not the full message history.
   */
  transfer(
    fromRole: string,
    toRole: string,
    content: string,
    label?: string
  ): void {
    const targetCtx = this.contexts.get(toRole);
    if (!targetCtx) {
      logger.warn({ fromRole, toRole }, "Transfer target context not found");
      return;
    }

    const transferLabel = label ?? `Output from ${fromRole}`;
    targetCtx.messages.push({
      role: "system",
      content: `[${transferLabel}]\n${content}`,
    });

    logger.debug(
      { fromRole, toRole, contentLength: content.length },
      "Context transferred between agents"
    );
  }

  /**
   * Build the final message array for an agent, including shared facts.
   */
  buildMessages(agentRole: string): Array<{ role: string; content: string }> {
    const ctx = this.contexts.get(agentRole);
    if (!ctx) {
      return [];
    }

    const messages: Array<{ role: string; content: string }> = [];

    // Inject shared facts as system context
    if (ctx.sharedFacts.length > 0) {
      messages.push({
        role: "system",
        content: `[Shared context]\n${ctx.sharedFacts.join("\n")}`,
      });
    }

    messages.push(...ctx.messages);

    return messages;
  }

  /**
   * Reset all isolated contexts.
   */
  reset(): void {
    this.contexts.clear();
    this.sharedFacts.length = 0;
  }
}
