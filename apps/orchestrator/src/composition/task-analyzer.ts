import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:task-analyzer");

export interface CapabilityRequirement {
  capability:
    | "frontend"
    | "backend"
    | "database"
    | "test"
    | "deploy"
    | "security"
    | "documentation"
    | "infrastructure";
  complexity: "simple" | "medium" | "complex";
  description: string;
  estimatedTokens: number;
}

export interface TaskAnalysis {
  capabilities: CapabilityRequirement[];
  crossCuttingConcerns: string[];
  estimatedTotalComplexity: "low" | "medium" | "high";
  requiresArchitectureReview: boolean;
  suggestedMode: "single" | "sequential" | "parallel" | "fleet";
  taskSummary: string;
}

interface ProjectContext {
  frameworks?: string[];
  languages?: string[];
  relevantFiles?: string[];
}

interface ModelRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const CAPABILITY_KEYWORDS: Record<
  CapabilityRequirement["capability"],
  string[]
> = {
  backend: [
    "api",
    "route",
    "endpoint",
    "server",
    "handler",
    "middleware",
    "trpc",
    "rest",
    "graphql",
    "controller",
  ],
  database: [
    "database",
    "schema",
    "migration",
    "query",
    "table",
    "model",
    "drizzle",
    "sql",
    "index",
    "relation",
  ],
  deploy: [
    "deploy",
    "ci/cd",
    "pipeline",
    "release",
    "docker",
    "kubernetes",
    "k8s",
    "helm",
    "terraform",
  ],
  documentation: [
    "document",
    "readme",
    "docs",
    "jsdoc",
    "comment",
    "changelog",
    "wiki",
    "guide",
  ],
  frontend: [
    "component",
    "page",
    "ui",
    "css",
    "style",
    "layout",
    "react",
    "jsx",
    "tsx",
    "form",
    "button",
    "modal",
    "widget",
  ],
  infrastructure: [
    "infra",
    "monitoring",
    "logging",
    "alert",
    "metric",
    "redis",
    "queue",
    "cache",
    "nginx",
    "proxy",
  ],
  security: [
    "security",
    "auth",
    "permission",
    "rbac",
    "encryption",
    "vulnerability",
    "audit",
    "csrf",
    "xss",
    "cors",
  ],
  test: [
    "test",
    "spec",
    "coverage",
    "e2e",
    "integration",
    "unit",
    "mock",
    "fixture",
    "assert",
    "vitest",
    "jest",
  ],
};

const TOKEN_ESTIMATES: Record<CapabilityRequirement["complexity"], number> = {
  complex: 8000,
  medium: 4000,
  simple: 2000,
};

export class TaskAnalyzer {
  private readonly modelRouterUrl: string;

  constructor(modelRouterUrl?: string) {
    this.modelRouterUrl =
      modelRouterUrl ?? process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
  }

  async analyze(
    taskDescription: string,
    projectContext?: ProjectContext
  ): Promise<TaskAnalysis> {
    try {
      return await this.analyzeLLM(taskDescription, projectContext);
    } catch (error) {
      logger.warn(
        { error },
        "LLM analysis unavailable, falling back to heuristic analysis"
      );
      return this.analyzeHeuristic(taskDescription);
    }
  }

  private async analyzeLLM(
    taskDescription: string,
    projectContext?: ProjectContext
  ): Promise<TaskAnalysis> {
    const systemPrompt = `You are a task analysis engine. Given a software engineering task, decompose it into required capabilities.
Return ONLY valid JSON matching this schema:
{
  "taskSummary": "string",
  "capabilities": [{ "capability": "frontend|backend|database|test|deploy|security|documentation|infrastructure", "complexity": "simple|medium|complex", "description": "string", "estimatedTokens": number }],
  "crossCuttingConcerns": ["string"],
  "estimatedTotalComplexity": "low|medium|high",
  "requiresArchitectureReview": boolean,
  "suggestedMode": "single|sequential|parallel|fleet"
}`;

    const contextStr = projectContext
      ? `\nProject context: languages=${projectContext.languages?.join(", ") ?? "unknown"}, frameworks=${projectContext.frameworks?.join(", ") ?? "unknown"}, relevant files=${projectContext.relevantFiles?.join(", ") ?? "none"}`
      : "";

    const response = await fetch(`${this.modelRouterUrl}/route`, {
      body: JSON.stringify({
        messages: [
          { content: systemPrompt, role: "system" },
          {
            content: `Analyze this task:${contextStr}\n\nTask: ${taskDescription}`,
            role: "user",
          },
        ],
        slot: "default",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(
        `Model router returned ${response.status}: ${response.statusText}`
      );
    }

    const data = (await response.json()) as ModelRouterResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from model router");
    }

    const parsed = JSON.parse(content) as TaskAnalysis;

    logger.info(
      {
        capabilityCount: parsed.capabilities.length,
        complexity: parsed.estimatedTotalComplexity,
        mode: parsed.suggestedMode,
      },
      "LLM task analysis complete"
    );

    return parsed;
  }

  private analyzeHeuristic(taskDescription: string): TaskAnalysis {
    const lowerDesc = taskDescription.toLowerCase();
    const capabilities: CapabilityRequirement[] = [];

    for (const [capability, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
      const matchedKeywords = keywords.filter((kw) => lowerDesc.includes(kw));

      if (matchedKeywords.length > 0) {
        const complexity = this.estimateComplexity(
          lowerDesc,
          matchedKeywords.length
        );

        capabilities.push({
          capability: capability as CapabilityRequirement["capability"],
          complexity,
          description: `${capability} work detected from keywords: ${matchedKeywords.join(", ")}`,
          estimatedTokens: TOKEN_ESTIMATES[complexity],
        });
      }
    }

    if (capabilities.length === 0) {
      capabilities.push({
        capability: "backend",
        complexity: "medium",
        description:
          "Default capability assignment — task did not match specific keywords",
        estimatedTokens: TOKEN_ESTIMATES.medium,
      });
    }

    const crossCuttingConcerns = this.detectCrossCuttingConcerns(lowerDesc);
    const estimatedTotalComplexity =
      this.computeOverallComplexity(capabilities);
    const requiresArchitectureReview =
      capabilities.length >= 3 || estimatedTotalComplexity === "high";

    const suggestedMode = this.determineSuggestedMode(
      capabilities,
      requiresArchitectureReview
    );

    const analysis: TaskAnalysis = {
      capabilities,
      crossCuttingConcerns,
      estimatedTotalComplexity,
      requiresArchitectureReview,
      suggestedMode,
      taskSummary: taskDescription.slice(0, 200),
    };

    logger.info(
      {
        capabilityCount: analysis.capabilities.length,
        complexity: analysis.estimatedTotalComplexity,
        mode: analysis.suggestedMode,
      },
      "Heuristic task analysis complete"
    );

    return analysis;
  }

  private estimateComplexity(
    description: string,
    keywordMatchCount: number
  ): CapabilityRequirement["complexity"] {
    const complexIndicators = [
      "refactor",
      "migrate",
      "redesign",
      "overhaul",
      "rewrite",
      "scale",
    ];
    const simpleIndicators = [
      "fix",
      "tweak",
      "update",
      "rename",
      "typo",
      "bump",
    ];

    const hasComplexIndicator = complexIndicators.some((ind) =>
      description.includes(ind)
    );
    const hasSimpleIndicator = simpleIndicators.some((ind) =>
      description.includes(ind)
    );

    if (hasComplexIndicator || keywordMatchCount >= 4) {
      return "complex";
    }

    if (hasSimpleIndicator && keywordMatchCount <= 1) {
      return "simple";
    }

    return "medium";
  }

  private detectCrossCuttingConcerns(description: string): string[] {
    const concerns: string[] = [];
    const concernKeywords: Record<string, string[]> = {
      auth: ["auth", "login", "session", "token", "jwt", "oauth"],
      caching: ["cache", "redis", "memoize", "ttl"],
      error_handling: ["error", "exception", "catch", "retry", "fallback"],
      logging: ["log", "trace", "monitor", "observability"],
      validation: ["validate", "schema", "zod", "sanitize", "input"],
    };

    for (const [concern, keywords] of Object.entries(concernKeywords)) {
      if (keywords.some((kw) => description.includes(kw))) {
        concerns.push(concern);
      }
    }

    return concerns;
  }

  private computeOverallComplexity(
    capabilities: CapabilityRequirement[]
  ): TaskAnalysis["estimatedTotalComplexity"] {
    const complexCount = capabilities.filter(
      (c) => c.complexity === "complex"
    ).length;
    const totalCount = capabilities.length;

    if (complexCount >= 2 || totalCount >= 5) {
      return "high";
    }

    if (complexCount >= 1 || totalCount >= 3) {
      return "medium";
    }

    return "low";
  }

  private determineSuggestedMode(
    capabilities: CapabilityRequirement[],
    requiresArchitectureReview: boolean
  ): TaskAnalysis["suggestedMode"] {
    if (capabilities.length === 1 && !requiresArchitectureReview) {
      return "single";
    }

    if (capabilities.length <= 2) {
      return "sequential";
    }

    if (capabilities.length <= 4) {
      return "parallel";
    }

    return "fleet";
  }
}
