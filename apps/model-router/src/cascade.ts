import { MODEL_REGISTRY } from "@prometheus/ai";
import { createLogger } from "@prometheus/logger";
import type { ModelRouterService, RouteRequest, RouteResponse } from "./router";

const logger = createLogger("model-router:cascade");

const HEDGING_PATTERNS =
  /\b(I'm not sure|I don't know|I cannot|unclear|might be|possibly)\b/i;
const REFUSAL_PATTERNS =
  /\b(I can't help|I'm unable|beyond my capabilities)\b/i;
const PLACEHOLDER_PATTERN = /\b(TODO|FIXME|placeholder|not implemented)\b/i;
const ABRUPT_ENDING_PATTERN = /[.!?`)\]}]$/;
const CONTRADICTION_PATTERN =
  /\b(however|but actually|wait|correction|I was wrong)\b/i;

// ─── Quality Assessment Types ───────────────────────────────────────────────

/**
 * Multi-signal quality assessment result.
 * Each signal is scored independently and combined into a final score.
 */
export interface QualityAssessment {
  /** Whether the response follows project conventions (naming, structure) */
  conventionCompliant: boolean;
  /** Whether the response includes test coverage */
  hasTests: boolean;
  /** Overall quality score (0-1) combining all signals */
  overallScore: number;
  /** Whether the response appears free of obvious security issues */
  securityClean: boolean;
  /** Individual signal scores for debugging/metrics */
  signals: {
    completeness: number;
    confidence: number;
    consistency: number;
    content: number;
    structural: number;
  };
  /** Whether the response contains valid syntax (matched brackets, etc.) */
  syntaxValid: boolean;
  /** Whether code in the response looks type-safe (no any, has type annotations) */
  typeCheckable: boolean;
}

// ─── Language-Aware Quality Patterns ────────────────────────────────────────

const SECURITY_PATTERNS = [
  /eval\s*\(/i,
  /document\.write\s*\(/i,
  /innerHTML\s*=/i,
  /exec\s*\(\s*['"`]/i,
  /child_process/i,
  /\bsudo\b/i,
  /password\s*=\s*['"][^'"]+['"]/i,
  /api[_-]?key\s*=\s*['"][^'"]+['"]/i,
];

const TEST_INDICATORS = [
  /\b(describe|it|test|expect|assert|should)\s*\(/,
  /\b(beforeEach|afterEach|beforeAll|afterAll)\s*\(/,
  /\b(jest|vitest|mocha|chai)\b/,
  /\.test\.|\.spec\./,
  /\bTestCase\b/,
];

const TYPE_ANNOTATION_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /:\s*(string|number|boolean|void|Promise|Record|Array|Map|Set)\b/,
    /interface\s+\w+/,
    /type\s+\w+=>/,
    /<[A-Z]\w*>/,
  ],
  python: [
    /def\s+\w+\([^)]*:\s*\w+/,
    /\)\s*->\s*\w+/,
    /:\s*(int|str|float|bool|list|dict|Optional)\b/,
  ],
  go: [/func\s+\w+\([^)]*\w+\s+\w+/, /\)\s+\w+\s*\{/],
};

const SYNTAX_BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

const CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const CODE_BLOCK_OPEN_STRIP = /^```\w*\n?/;
const CODE_BLOCK_CLOSE_STRIP = /\n?```$/;
const PYTHON_FUNC_REGEX = /def\s+(\w+)/g;
const JS_FUNC_REGEX = /(?:function|const|let|var)\s+(\w+)/g;
const SNAKE_CASE_REGEX = /^[a-z][a-z0-9_]*$/;
const CAMEL_CASE_REGEX = /^[a-z][a-zA-Z0-9]*$/;

interface CascadeConfig {
  confidenceThreshold: number;
  maxEscalations: number;
}

const DEFAULT_CASCADE_CONFIG: CascadeConfig = {
  confidenceThreshold: 0.3,
  maxEscalations: 2,
};

const SLOT_ESCALATION_CHAIN: Record<string, string[]> = {
  default: ["default", "review", "premium"],
  fastLoop: ["fastLoop", "default", "review"],
  background: ["background", "default"],
  think: ["think", "premium"],
  review: ["review", "premium"],
};

interface CascadeMetrics {
  costSavedUsd: number;
  escalations: number;
  qualityAssessments: number;
  requestsHandledCheap: number;
  totalRequests: number;
}

export class CascadeRouter {
  private readonly inner: ModelRouterService;
  private readonly config: CascadeConfig;
  private readonly metrics: CascadeMetrics = {
    totalRequests: 0,
    requestsHandledCheap: 0,
    escalations: 0,
    costSavedUsd: 0,
    qualityAssessments: 0,
  };

  constructor(inner: ModelRouterService, config?: Partial<CascadeConfig>) {
    this.inner = inner;
    this.config = { ...DEFAULT_CASCADE_CONFIG, ...config };
  }

  async route(request: RouteRequest): Promise<RouteResponse> {
    this.metrics.totalRequests++;

    const escalationChain = SLOT_ESCALATION_CHAIN[request.slot] ?? [
      request.slot,
    ];

    // Detect language hint from the request messages for quality assessment
    const languageHint = detectLanguageFromMessages(request.messages);

    for (let i = 0; i < escalationChain.length; i++) {
      const slot = escalationChain[i] as string;
      const escalatedRequest: RouteRequest = { ...request, slot };

      try {
        const response = await this.inner.route(escalatedRequest);

        const assessment = this.assessQuality(
          response.choices[0]?.message?.content ?? "",
          languageHint
        );
        const quality = assessment.overallScore;

        if (
          quality >= this.config.confidenceThreshold ||
          i === escalationChain.length - 1
        ) {
          if (i === 0) {
            this.metrics.requestsHandledCheap++;
            const premiumCost = this.estimatePremiumCost(request);
            this.metrics.costSavedUsd += premiumCost - response.usage.cost_usd;
          } else {
            this.metrics.escalations++;
          }

          logger.info(
            {
              originalSlot: request.slot,
              usedSlot: slot,
              escalationLevel: i,
              quality: quality.toFixed(3),
              syntaxValid: assessment.syntaxValid,
              typeCheckable: assessment.typeCheckable,
              hasTests: assessment.hasTests,
              securityClean: assessment.securityClean,
              costUsd: response.usage.cost_usd.toFixed(6),
            },
            "Cascade route completed"
          );

          return {
            ...response,
            routing: {
              ...response.routing,
              wasFallback:
                response.routing.wasFallback || slot !== request.slot,
            },
          };
        }

        logger.info(
          {
            slot,
            quality: quality.toFixed(3),
            threshold: this.config.confidenceThreshold,
            nextSlot: escalationChain[i + 1],
            signals: assessment.signals,
          },
          "Quality below threshold, escalating"
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { slot, error: msg },
          "Cascade slot failed, trying next level"
        );
      }
    }

    return this.inner.route(request);
  }

  /**
   * Multi-signal quality assessment of LLM response content.
   * Evaluates syntax validity, type-safety signals, test coverage,
   * security cleanliness, and convention compliance alongside the
   * original structural/confidence/completeness/consistency checks.
   *
   * @param response - The response text to assess
   * @param language - Optional language hint (e.g., "typescript", "python")
   */
  assessQuality(response: string, language?: string): QualityAssessment {
    this.metrics.qualityAssessments++;

    const content = response;
    if (!content || content.length === 0) {
      return {
        overallScore: 0,
        syntaxValid: false,
        typeCheckable: false,
        hasTests: false,
        securityClean: true,
        conventionCompliant: false,
        signals: {
          structural: 0,
          content: 0,
          confidence: 0,
          completeness: 0,
          consistency: 0,
        },
      };
    }

    // Signal 1: Structural completeness
    let structuralScore = 0;
    if (content.length > 50) {
      structuralScore += 0.3;
    }
    if (content.length > 200) {
      structuralScore += 0.3;
    }
    const codeBlocks = (content.match(/```/g) ?? []).length / 2;
    if (codeBlocks >= 1) {
      structuralScore += 0.2;
    }
    const hasStructuredOutput =
      content.includes("##") ||
      content.includes("- ") ||
      content.includes("1.");
    if (hasStructuredOutput) {
      structuralScore += 0.2;
    }

    // Signal 2: Content quality
    let contentScore = 0.5;
    if (codeBlocks >= 1) {
      contentScore += 0.2;
    }
    if (hasStructuredOutput) {
      contentScore += 0.15;
    }
    if (content.length < 20) {
      contentScore -= 0.3;
    }

    // Signal 3: Hedging/refusal detection
    let confidenceScore = 1.0;
    if (HEDGING_PATTERNS.test(content)) {
      confidenceScore -= 0.3;
    }
    if (REFUSAL_PATTERNS.test(content)) {
      confidenceScore -= 0.5;
    }
    if (PLACEHOLDER_PATTERN.test(content)) {
      confidenceScore -= 0.2;
    }

    // Signal 4: Completeness
    let completenessScore = 1.0;
    const lastLine = content.trim().split("\n").pop() ?? "";
    if (lastLine.length > 20 && !ABRUPT_ENDING_PATTERN.test(lastLine)) {
      completenessScore -= 0.2;
    }

    // Signal 5: Consistency
    let consistencyScore = 1.0;
    if (CONTRADICTION_PATTERN.test(content)) {
      consistencyScore -= 0.15;
    }

    // ─── Multi-Signal Quality Checks ──────────────────────────────

    const syntaxValid = checkSyntaxValidity(content);
    const typeCheckable = checkTypeAnnotations(content, language);
    const hasTests = TEST_INDICATORS.some((pattern) => pattern.test(content));
    const securityClean = !SECURITY_PATTERNS.some((pattern) =>
      pattern.test(content)
    );
    const conventionCompliant = checkConventionCompliance(content, language);

    // Bonus/penalties from multi-signal checks
    if (syntaxValid) {
      contentScore += 0.05;
    } else {
      contentScore -= 0.1;
    }

    if (typeCheckable) {
      contentScore += 0.05;
    }

    if (hasTests) {
      contentScore += 0.05;
    }

    if (!securityClean) {
      confidenceScore -= 0.15;
    }

    if (conventionCompliant) {
      contentScore += 0.05;
    }

    // Weighted combination
    const signals = {
      structural: Math.max(0, Math.min(1, structuralScore)),
      content: Math.max(0, Math.min(1, contentScore)),
      confidence: Math.max(0, confidenceScore),
      completeness: Math.max(0, completenessScore),
      consistency: Math.max(0, consistencyScore),
    };

    const overallScore = Math.max(
      0,
      Math.min(
        1,
        signals.structural * 0.25 +
          signals.content * 0.2 +
          signals.confidence * 0.25 +
          signals.completeness * 0.15 +
          signals.consistency * 0.15
      )
    );

    return {
      overallScore,
      syntaxValid,
      typeCheckable,
      hasTests,
      securityClean,
      conventionCompliant,
      signals,
    };
  }

  private estimatePremiumCost(request: RouteRequest): number {
    const premiumModel = MODEL_REGISTRY["anthropic/claude-opus-4-6"];
    if (!premiumModel) {
      return 0;
    }

    const estimatedInputTokens = request.messages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0
    );
    const estimatedOutputTokens = 2000;

    return (
      estimatedInputTokens * premiumModel.costPerInputToken +
      estimatedOutputTokens * premiumModel.costPerOutputToken
    );
  }

  getMetrics(): CascadeMetrics & { savingsPercentage: number } {
    const savingsPercentage =
      this.metrics.totalRequests > 0
        ? (this.metrics.requestsHandledCheap / this.metrics.totalRequests) * 100
        : 0;
    return { ...this.metrics, savingsPercentage };
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Detect programming language from message content.
 */
function detectLanguageFromMessages(
  messages: Array<{ role: string; content: string }>
): string | undefined {
  const combined = messages
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();

  if (
    combined.includes("typescript") ||
    combined.includes(".ts") ||
    combined.includes("interface ") ||
    combined.includes("type ")
  ) {
    return "typescript";
  }
  if (
    combined.includes("python") ||
    combined.includes(".py") ||
    combined.includes("def ")
  ) {
    return "python";
  }
  if (
    combined.includes("golang") ||
    combined.includes(".go") ||
    combined.includes("func ")
  ) {
    return "go";
  }
  return undefined;
}

/**
 * Check bracket matching in code blocks within the response.
 */
function checkSyntaxValidity(content: string): boolean {
  const codeBlocks = content.match(CODE_BLOCK_REGEX);
  if (!codeBlocks || codeBlocks.length === 0) {
    return true;
  }

  for (const block of codeBlocks) {
    const code = block
      .replace(CODE_BLOCK_OPEN_STRIP, "")
      .replace(CODE_BLOCK_CLOSE_STRIP, "");
    const stack: string[] = [];
    let inString = false;
    let stringChar = "";

    for (let i = 0; i < code.length; i++) {
      const char = code[i] as string;

      if (
        (char === '"' || char === "'" || char === "`") &&
        (i === 0 || code[i - 1] !== "\\")
      ) {
        if (inString && char === stringChar) {
          inString = false;
        } else if (!inString) {
          inString = true;
          stringChar = char;
        }
        continue;
      }

      if (inString) {
        continue;
      }

      const closing = SYNTAX_BRACKET_PAIRS[char];
      if (closing) {
        stack.push(closing);
      } else if (
        (char === ")" || char === "]" || char === "}") &&
        (stack.length === 0 || stack.pop() !== char)
      ) {
        return false;
      }
    }

    if (stack.length > 0) {
      return false;
    }
  }

  return true;
}

/**
 * Check for type annotations in the response content.
 */
function checkTypeAnnotations(content: string, language?: string): boolean {
  if (!language) {
    for (const patterns of Object.values(TYPE_ANNOTATION_PATTERNS)) {
      if (patterns.some((p) => p.test(content))) {
        return true;
      }
    }
    return false;
  }

  const patterns = TYPE_ANNOTATION_PATTERNS[language];
  if (!patterns) {
    return false;
  }
  return patterns.some((p) => p.test(content));
}

/**
 * Check for convention compliance (camelCase for JS/TS, snake_case for Python).
 */
function checkConventionCompliance(
  content: string,
  language?: string
): boolean {
  const codeBlocks = content.match(CODE_BLOCK_REGEX);
  if (!codeBlocks || codeBlocks.length === 0) {
    return true;
  }

  const code = codeBlocks
    .map((b) =>
      b.replace(CODE_BLOCK_OPEN_STRIP, "").replace(CODE_BLOCK_CLOSE_STRIP, "")
    )
    .join("\n");

  if (language === "python") {
    const funcNames = [...code.matchAll(PYTHON_FUNC_REGEX)].map(
      (m) => m[1] as string
    );
    if (funcNames.length === 0) {
      return true;
    }
    const snakeCaseCount = funcNames.filter((n) =>
      SNAKE_CASE_REGEX.test(n)
    ).length;
    return snakeCaseCount >= funcNames.length / 2;
  }

  const funcNames = [...code.matchAll(JS_FUNC_REGEX)].map(
    (m) => m[1] as string
  );
  if (funcNames.length === 0) {
    return true;
  }
  const camelCaseCount = funcNames.filter((n) =>
    CAMEL_CASE_REGEX.test(n)
  ).length;
  return camelCaseCount >= funcNames.length / 2;
}
