/**
 * Phase 7.18: Context Pre-fetching.
 *
 * Pre-assembles likely context during queue wait time.
 * Enhanced with task-type-aware prefetching and priority content.
 */
import { createLogger } from "@prometheus/logger";
import { BudgetOptimizer, type TaskType } from "./budget-optimizer";

const logger = createLogger("project-brain:context-prefetcher");

const CACHE_TTL_SECONDS = 300;
const PREFETCH_PREFIX = "prefetch:";

interface RedisLike {
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
}

export interface PrefetchedContext {
  assembledAt: string;
  context: string;
  priorityContent?: PrefetchedPriorityContent;
  projectId: string;
  taskDescription: string;
  taskType?: TaskType;
  tokenEstimate: number;
}

export interface PrefetchedPriorityContent {
  conventions?: string;
  dependencyGraph?: string;
  errorLogs?: string;
  stackTraces?: string;
  testFiles?: string;
}

export class ContextPrefetcher {
  private readonly redis: RedisLike | null;
  private readonly contextAssembler: ContextAssemblerLike | null;
  private readonly budgetOptimizer: BudgetOptimizer;

  constructor(redis?: RedisLike, contextAssembler?: ContextAssemblerLike) {
    this.redis = redis ?? null;
    this.contextAssembler = contextAssembler ?? null;
    this.budgetOptimizer = new BudgetOptimizer();
  }

  async prefetch(
    taskDescription: string,
    projectId: string,
    sessionId?: string
  ): Promise<void> {
    if (!(this.redis && this.contextAssembler)) {
      logger.debug(
        "Redis or context assembler not available, skipping prefetch"
      );
      return;
    }

    try {
      const startTime = Date.now();
      const taskType = this.budgetOptimizer.detectTaskType(taskDescription);
      const allocation = this.budgetOptimizer.allocateDetailed(
        taskType,
        14_000
      );

      const [assembled, priorityContent] = await Promise.all([
        this.contextAssembler.assemble({
          projectId,
          taskDescription,
          agentRole: "coder",
          maxTokens: 14_000,
          sessionId,
        }),
        this.prefetchPriorityContent(
          projectId,
          taskType,
          taskDescription,
          allocation.priorityContent
        ),
      ]);

      const contextParts = [
        assembled.global,
        assembled.taskSpecific,
        assembled.session,
        assembled.tools,
        assembled.preferences,
      ].filter(Boolean);

      if (priorityContent) {
        const priorityParts: string[] = [];
        if (priorityContent.stackTraces) {
          priorityParts.push(`## Stack Traces\n${priorityContent.stackTraces}`);
        }
        if (priorityContent.conventions) {
          priorityParts.push(
            `## Coding Conventions\n${priorityContent.conventions}`
          );
        }
        if (priorityContent.dependencyGraph) {
          priorityParts.push(
            `## Dependency Graph\n${priorityContent.dependencyGraph}`
          );
        }
        if (priorityContent.errorLogs) {
          priorityParts.push(`## Error Logs\n${priorityContent.errorLogs}`);
        }
        if (priorityContent.testFiles) {
          priorityParts.push(`## Related Tests\n${priorityContent.testFiles}`);
        }
        if (priorityParts.length > 0) {
          contextParts.unshift(priorityParts.join("\n\n"));
        }
      }

      const prefetched: PrefetchedContext = {
        projectId,
        taskDescription,
        context: contextParts.join("\n\n"),
        tokenEstimate: assembled.totalTokensEstimate,
        assembledAt: new Date().toISOString(),
        taskType,
        priorityContent: priorityContent ?? undefined,
      };

      const cacheKey = this.buildKey(projectId, taskDescription);
      await this.redis.set(cacheKey, JSON.stringify(prefetched), {
        EX: CACHE_TTL_SECONDS,
      });

      logger.info(
        {
          projectId,
          taskType,
          tokens: assembled.totalTokensEstimate,
          hasPriorityContent: !!priorityContent,
          elapsed: Date.now() - startTime,
        },
        "Context pre-fetched and cached"
      );
    } catch (err) {
      logger.warn(
        { projectId, err },
        "Context pre-fetch failed, agent will assemble on demand"
      );
    }
  }

  private async prefetchPriorityContent(
    projectId: string,
    taskType: TaskType,
    taskDescription: string,
    priorityConfig: {
      includeStackTraces: boolean;
      includeConventions: boolean;
      includeDependencyGraph: boolean;
      includeErrorLogs: boolean;
      includeTestContext: boolean;
    }
  ): Promise<PrefetchedPriorityContent | null> {
    if (!this.contextAssembler) {
      return null;
    }
    const result: PrefetchedPriorityContent = {};
    let hasContent = false;

    try {
      if (
        priorityConfig.includeStackTraces &&
        this.contextAssembler.getStackTraces
      ) {
        const traces = await this.contextAssembler.getStackTraces(
          projectId,
          taskDescription
        );
        if (traces) {
          result.stackTraces = traces;
          hasContent = true;
        }
      }
      if (
        priorityConfig.includeConventions &&
        this.contextAssembler.getConventions
      ) {
        const conventions =
          await this.contextAssembler.getConventions(projectId);
        if (conventions) {
          result.conventions = conventions;
          hasContent = true;
        }
      }
      if (
        priorityConfig.includeDependencyGraph &&
        this.contextAssembler.getDependencyGraph
      ) {
        const graph = await this.contextAssembler.getDependencyGraph(
          projectId,
          taskDescription
        );
        if (graph) {
          result.dependencyGraph = graph;
          hasContent = true;
        }
      }
      if (
        priorityConfig.includeErrorLogs &&
        this.contextAssembler.getErrorLogs
      ) {
        const logs = await this.contextAssembler.getErrorLogs(projectId);
        if (logs) {
          result.errorLogs = logs;
          hasContent = true;
        }
      }
      if (
        priorityConfig.includeTestContext &&
        this.contextAssembler.getRelatedTests
      ) {
        const tests = await this.contextAssembler.getRelatedTests(
          projectId,
          taskDescription
        );
        if (tests) {
          result.testFiles = tests;
          hasContent = true;
        }
      }
    } catch (err) {
      logger.debug(
        { projectId, taskType, err },
        "Priority content prefetch partially failed"
      );
    }

    return hasContent ? result : null;
  }

  async getCached(
    projectId: string,
    taskDescription: string
  ): Promise<PrefetchedContext | null> {
    if (!this.redis) {
      return null;
    }
    try {
      const cacheKey = this.buildKey(projectId, taskDescription);
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        logger.debug({ projectId }, "Pre-fetched context cache hit");
        return JSON.parse(cached) as PrefetchedContext;
      }
    } catch {
      /* miss */
    }
    return null;
  }

  async invalidate(projectId: string, taskDescription?: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    if (taskDescription) {
      try {
        await this.redis.del(this.buildKey(projectId, taskDescription));
      } catch {
        /* ignore */
      }
    }
    logger.debug({ projectId }, "Context cache invalidated");
  }

  private buildKey(projectId: string, taskDescription: string): string {
    const input = `${projectId}:${taskDescription}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = Math.imul(31, hash) + input.charCodeAt(i);
    }
    return `${PREFETCH_PREFIX}${projectId}:${Math.abs(hash)}`;
  }
}

interface ContextAssemblerLike {
  assemble(request: {
    agentRole: string;
    maxTokens: number;
    projectId: string;
    sessionId?: string;
    taskDescription: string;
  }): Promise<{
    global: string;
    preferences: string;
    session: string;
    taskSpecific: string;
    tools: string;
    totalTokensEstimate: number;
  }>;
  getConventions?(projectId: string): Promise<string | null>;
  getDependencyGraph?(
    projectId: string,
    taskDescription: string
  ): Promise<string | null>;
  getErrorLogs?(projectId: string): Promise<string | null>;
  getRelatedTests?(
    projectId: string,
    taskDescription: string
  ): Promise<string | null>;
  getStackTraces?(
    projectId: string,
    taskDescription: string
  ): Promise<string | null>;
}
